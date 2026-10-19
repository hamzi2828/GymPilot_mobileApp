// The member's own details: who the gym has them down as, the username they
// sign in with, their gym's contact details and opening hours, how they want
// to hear from the gym, a card they saved for automatic payments (and turning
// that off), and the two things they can change -- their details and their
// password. And the way out for good: deleting the account, which the app
// stores require of an app with sign-in.

import React, { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, Switch, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { GymMark, Screen } from "@/components/Screen";
import { Body, Button, Caption, Card, Divider, Field, GymClosed, Heading, LegalLinks, Line, Loading, Notice, Pill, RowLink, Title, WithSpinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { confirmAction, tellMember } from "@/lib/confirm";
import { initials, longDate } from "@/lib/format";
import { openApp, openPhoneSettings, openWeb } from "@/lib/open";
import { pushSupported, registerForPush, usePushState } from "@/lib/push";
import { usePalette, useSession } from "@/lib/session";
import { space } from "@/lib/theme";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { useClock } from "@/lib/useClock";
import { useGymClosed, useLoad } from "@/lib/useLoad";
import type { FaceStatus, NotificationPreferences, NotificationSettings, Profile as ProfileData, SavedMethod } from "@/lib/types";

const MIN_PASSWORD = 8;

const CARD_BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", unionpay: "UnionPay", paypak: "PayPak" };

/** "Visa •••• 4242", as the card is printed. */
function cardName(m: SavedMethod): string {
  const brand = String(m.brand || "").trim();
  const name = CARD_BRANDS[brand.toLowerCase()] || (brand ? brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase() : "Card");
  return m.last4 ? `${name} •••• ${m.last4}` : name;
}

/** The card's expiry as printed on it ("08/27"), and whether that month has gone by. */
function cardExpiry(m: SavedMethod, now: number): { label: string; expired: boolean } | null {
  const month = Number(m.exp_month);
  const printed = Number(m.exp_year);
  if (!month || !printed) return null;
  const year = printed < 100 ? 2000 + printed : printed;
  const today = new Date(now);
  return {
    label: `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`,
    expired: year < today.getFullYear() || (year === today.getFullYear() && month < today.getMonth() + 1),
  };
}

/**
 * Why a profile save failed, in words a member can act on. The server's
 * message is a generic "Error updating user"; the reason is in its `error`
 * -- a database duplicate or validation text, not for showing as it is.
 */
function saveProblem(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : "Could not save your details.";
  // Adding, changing or removing the email address is the one edit the
  // server wants the current password for: whoever holds the address can
  // reset the password.
  if (e.code === "PASSWORD_REQUIRED") return "Enter your current password to change or remove your email address.";
  if (e.code === "PASSWORD_INCORRECT") return "That password is not right, so nothing was changed. Check it and try again.";
  // An account that only ever signed in with Google on the website.
  if (e.code === "PASSWORD_NOT_SET") {
    return "Your account has no password yet, so nothing was changed. Sign out, set one with Forgot password on the sign-in screen, then try again.";
  }
  const detail = e.detail || "";
  if (/E11000|duplicate key/i.test(detail)) {
    return /email/i.test(detail)
      ? "That email address is already used by another account at your gym."
      : "Some of those details are already used by another account at your gym.";
  }
  if (/validation failed|cast to/i.test(detail)) return "Some of those details are not valid. Please check them and try again.";
  return e.message;
}

export default function Profile() {
  const { session, user, gymName, branding, signOut, refresh, updateUser } = useSession();
  const p = usePalette();
  const router = useRouter();

  const profile = useLoad<{ data: ProfileData }>("/userDetailForProfile");
  const me = profile.data?.data;
  const notifications = useLoad<{ data: NotificationSettings }>("/user/notification-preferences");
  const face = useLoad<{ data: FaceStatus }>("/api/attendance/me/face");
  // Cards saved for automatic payments. Most members have none, and a server
  // from before automatic payments answers 404: either way there is nothing
  // to show, so the section only appears with a card in it.
  const saved = useLoad<{ data: SavedMethod[] }>("/api/billing/me/saved-methods");
  const closed = useGymClosed(profile, notifications, face);
  const reload = () => {
    closed.clear();
    profile.reload();
    notifications.reload();
    face.reload();
    saved.reload();
  };
  const now = useClock();

  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  // Saving the details, changing the password, signing out, deleting the
  // account: one at a time, and the one under way shows the spinner.
  const account = useAsyncAction<"save" | "password" | "signOut" | "delete">();
  // What came of the last save, switch or deletion, shown beside the thing
  // that was tapped -- the details card, the notifications card, or under
  // Delete my account -- rather than at the top of a long screen.
  const [message, setMessage] = useState<{ at: "details" | "notifications" | "account"; tone: "ok" | "error"; text: string } | null>(null);
  const say = (at: "details" | "notifications" | "account", tone: "ok" | "error", text: string) => {
    setMessage({ at, tone, text });
    AccessibilityInfo.announceForAccessibility(text);
  };
  // Shown inside the password card, next to the fields it is about.
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // "Send the link again", for an email address not confirmed yet: whether
  // it is on its way, and what the server answered.
  const link = useAsyncAction();
  const sendingLink = !!link.busy;
  const [linkAnswer, setLinkAnswer] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // Removing their face data: whether it is on its way, and what came of it,
  // shown in the face check-in card rather than at the top of the screen.
  const faceRemoval = useAsyncAction();
  const [faceAnswer, setFaceAnswer] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // The status the removal answered. Until a fresh one arrives it is shown as
  // off, so a reload that cannot get through does not say "on" beside
  // "removed"; any later answer from the server replaces it.
  const [faceRemovedFrom, setFaceRemovedFrom] = useState<FaceStatus | null>(null);
  // Turning automatic payments off: which card is on its way, and what came
  // of it, shown under that card. A card turned off leaves the list at once,
  // before the reload says so, and its answer stays where it was until the
  // member leaves the tab.
  const autoPay = useAsyncAction();
  const [autoPayAnswer, setAutoPayAnswer] = useState<{ id: string; tone: "ok" | "error"; text: string } | null>(null);
  const [turnedOff, setTurnedOff] = useState<string[]>([]);
  useFocusEffect(useCallback(() => () => setAutoPayAnswer(null), []));

  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", goals: "", currentPassword: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });

  // The switches show what the server has, plus whatever the member has just
  // flipped: an optimistic layer over the loaded values, put back if the
  // save fails.
  const [flipped, setFlipped] = useState<Partial<NotificationPreferences>>({});
  // One switch saved at a time; the one being saved shows a spinner.
  const pref = useAsyncAction<keyof NotificationPreferences>();
  // Leaving the app for the dialler, mail, WhatsApp, a web page or the
  // phone's settings: the link shows a spinner until the other app is up.
  const leaving = useAsyncAction();
  const opens = (key: string, open: () => Promise<void>) => ({
    onPress: () => leaving.run(key, open),
    disabled: !!leaving.busy,
    accessibilityState: { disabled: !!leaving.busy, busy: leaving.busy === key },
  });

  // Filled in when Edit is pressed rather than whenever the fetch lands, so a
  // refresh arriving mid-edit cannot wipe what has been typed.
  const startEditing = () => {
    setForm({
      firstName: me?.firstName || "",
      lastName: me?.lastName || "",
      email: me?.email || "",
      phone: me?.phone || "",
      goals: me?.goals || "",
      currentPassword: "",
    });
    setMessage(null);
    setEditing(true);
  };

  // The gym's colours -- and the member's own record, which the front desk
  // can change -- can move under the member's feet; pick them up when they
  // open their profile rather than making them sign in again.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyUsername = async () => {
    const username = me?.username || user?.username;
    if (!username) return;
    try {
      await Clipboard.setStringAsync(username);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // The phone would not take it; it is on the screen to copy by hand.
      await tellMember("Could not copy that", `Your username is ${username}.`);
    }
  };

  // A new sign-up's address, or one just changed, is unconfirmed until the
  // link emailed to it is opened. The profile just loaded knows best; the
  // copy kept from sign-in stands in until it arrives.
  const emailUnconfirmed = me ? !!me.email && me.emailVerified === false : !!user?.email && user.emailVerified === false;

  const sendConfirmation = () =>
    link.run("send", async () => {
      setLinkAnswer(null);
      try {
        const res = await api<{ message?: string; alreadyVerified?: boolean }>("/user/verify-email/send", { method: "POST", session, onUnauthorised: signOut });
        setLinkAnswer({ tone: "ok", text: res.message || "We sent you a new link. Open it to confirm the address is yours." });
        // Confirmed in the meantime: read the profile again, and the line goes.
        if (res.alreadyVerified) {
          profile.reload();
          refresh();
        }
      } catch (e) {
        if (closed.caught(e)) return;
        // No address on the account, the email could not be sent, or too many
        // were asked for: the server says which, in its own words.
        setLinkAnswer({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "Could not send the link. Please try again later." });
      }
    });

  // Whether the email box now says something other than what the gym has
  // (a new address, a different one, or none). Only then is the address sent
  // at all, and the current password with it: the server asks for it for a
  // removal as much as for a change.
  const emailChanged = form.email.trim().toLowerCase() !== (me?.email || "").trim().toLowerCase();

  const save = () => {
    if (account.busy) return;
    const email = form.email.trim();
    const body = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      goals: form.goals.trim(),
      ...(emailChanged ? { email, currentPassword: form.currentPassword } : {}),
    };
    // What the server would refuse anyway, said before the round trip.
    if (!body.firstName || !body.lastName) {
      say("details", "error", "Your first and last name cannot be empty.");
      return;
    }
    // An email address is optional: plenty of members have none, and the gym
    // signs them in by username. Only one that has been typed is checked.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      say("details", "error", "That does not look like an email address. Leave it empty if you do not have one.");
      return;
    }
    return account.run("save", async () => {
      setMessage(null);
      try {
        const res = await api<{ message?: string; data?: ProfileData }>("/update/user", { method: "PUT", session, onUnauthorised: signOut, body });
        // Home greets the member by name: it should be the new one straight away.
        if (res.data) await updateUser(res.data);
        say("details", "ok", "Your details have been saved.");
        setEditing(false);
        profile.reload();
      } catch (e) {
        if (closed.caught(e)) return;
        say("details", "error", saveProblem(e));
      }
    });
  };

  const changePassword = () => {
    if (account.busy) return;
    if (passwords.newPassword.length < MIN_PASSWORD) {
      setPasswordError(`Your new password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (passwords.newPassword !== passwords.confirm) {
      setPasswordError("The two new passwords do not match.");
      return;
    }
    return account.run("password", async () => {
      setPasswordError(null);
      try {
        // A wrong current password comes back as a 401 with no session code,
        // so it lands here as a message rather than signing the member out.
        await api<{ message?: string }>("/user/change-password", {
          method: "PUT",
          session,
          onUnauthorised: signOut,
          body: { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword },
        });
        // Changing the password ended every session, this one included. Sign
        // out now -- which takes the phone off the gym's notification list
        // first -- and then say why, rather than leave a dead session behind
        // the dialog.
        await signOut();
        await tellMember("Password changed", "Please sign in again with your new password.");
      } catch (e) {
        if (closed.caught(e)) return;
        setPasswordError(e instanceof ApiError || e instanceof Error ? e.message : "Could not change your password.");
      }
    });
  };

  const savePreference = async (key: keyof NotificationPreferences, value: boolean) => {
    setFlipped((f) => ({ ...f, [key]: value }));
    try {
      await api<{ message?: string }>("/user/notification-preferences", {
        method: "PUT",
        session,
        onUnauthorised: signOut,
        body: { [key]: value },
      });
    } catch (e) {
      setFlipped((f) => ({ ...f, [key]: !value }));
      if (closed.caught(e)) return;
      say("notifications", "error", e instanceof ApiError || e instanceof Error ? e.message : "Could not save that.");
    }
  };
  const setPreference = (key: keyof NotificationPreferences, value: boolean) => pref.run(key, () => savePreference(key, value));

  const confirmSignOut = () =>
    account.run(
      "signOut",
      () => signOut(),
      () =>
        confirmAction({
          title: "Sign out?",
          message: "You will need your username and password to get back in.",
          confirm: "Sign out",
          cancel: "Stay signed in",
          destructive: true,
        })
    );

  // Deleting the account is final: the server removes it and releases the
  // username, so there is nothing to sign back in to. A membership that
  // renews by card is cancelled by the server as part of it -- nobody could
  // sign in to stop it afterwards -- and the member is told so before they
  // confirm. If the card company cannot be reached the server refuses (409
  // SUBSCRIPTION_ACTIVE) and nothing is deleted.
  const deleteAccount = () =>
    account.run(
      "delete",
      async () => {
        setMessage(null);
        try {
          await api<{ message?: string }>("/user", { method: "DELETE", session, onUnauthorised: signOut });
          // The account is gone, and this session with it. Sign-out takes the
          // phone off the gym's notification list before it clears anything.
          await signOut();
          await tellMember("Account deleted", "Your account has been deleted.");
        } catch (e) {
          if (closed.caught(e)) return;
          say(
            "account",
            "error",
            e instanceof ApiError && e.code === "SUBSCRIPTION_ACTIVE"
              ? "Your account has not been deleted. Your membership renews by card and it could not be cancelled just now. Please try again in a few minutes, or ask the front desk to cancel the membership first."
              : e instanceof ApiError || e instanceof Error
                ? e.message
                : "Could not delete your account."
          );
        }
      },
      () =>
        confirmAction({
          title: "Delete your account?",
          message:
            `This permanently deletes your account at ${gymName || "your gym"} and your sign-in username. It cannot be undone.\n\n` +
            "If your membership renews by card, it is cancelled as part of this, so you will not be charged again.",
          confirm: "Delete my account",
          cancel: "Keep my account",
          destructive: true,
        })
    );

  // The member withdrawing their consent to face check-in. The server deletes
  // the face template outright; the desk can add it again, with consent, if
  // they change their mind.
  const removeFace = () =>
    faceRemoval.run(
      "remove",
      async () => {
        setFaceAnswer(null);
        try {
          await api<{ success: boolean; removed: number }>("/api/attendance/me/face", { method: "DELETE", session, onUnauthorised: signOut });
          setFaceAnswer({ tone: "ok", text: "Your face data has been removed. The front desk can no longer check you in by face." });
          setFaceRemovedFrom(face.data?.data ?? null);
          face.reload();
        } catch (e) {
          if (closed.caught(e)) return;
          setFaceAnswer({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "Could not remove your face data. Please try again." });
        }
      },
      () =>
        confirmAction({
          title: "Remove your face data?",
          message:
            "The front desk will no longer recognise your face. You can still check in by scanning the code at the desk, or ask the desk to add your face again later.",
          confirm: "Remove",
          cancel: "Keep it",
          destructive: true,
        })
    );

  // Withdrawing consent to automatic payments. The server removes the saved
  // card (the gym only ever held the payment provider's reference to it) and
  // stops charging it straight away; from then on the member pays each
  // renewal from the payment link the gym sends before it is due.
  const turnOffAutoPay = (m: SavedMethod) => {
    const card = cardName(m);
    const tell = (tone: "ok" | "error", text: string) => {
      setAutoPayAnswer({ id: m.id, tone, text });
      AccessibilityInfo.announceForAccessibility(text);
    };
    const gone = () => {
      setTurnedOff((ids) => [...ids, m.id]);
      saved.reload();
    };
    return autoPay.run(
      m.id,
      async () => {
        setAutoPayAnswer(null);
        try {
          await api<{ success: boolean }>(`/api/billing/me/saved-methods/${encodeURIComponent(m.id)}`, { method: "DELETE", session, onUnauthorised: signOut });
          gone();
          tell("ok", m.auto_pay ? `Automatic payments are off and ${card} has been removed. Before each due date you will get a payment link to pay yourself.` : `${card} has been removed.`);
        } catch (e) {
          if (closed.caught(e)) return;
          // Removed already -- on the website, or by the gym.
          if (e instanceof ApiError && e.status === 404) {
            gone();
            tell("ok", `${card} had already been removed, so it will not be charged.`);
            return;
          }
          tell("error", e instanceof ApiError || e instanceof Error ? e.message : "Could not turn automatic payments off. Please try again.");
        }
      },
      () =>
        confirmAction({
          title: m.auto_pay ? "Turn off automatic payments?" : "Remove this card?",
          message: m.auto_pay
            ? `Your gym will no longer charge ${card} by itself, and the card is removed from your account. Before each due date you will get a payment link to pay yourself.`
            : `${card} is removed from your account.`,
          confirm: m.auto_pay ? "Turn off" : "Remove",
          cancel: "Keep it",
          destructive: true,
        })
    );
  };

  /** The last answer, if it belongs here. */
  const answerAt = (at: "details" | "notifications" | "account") =>
    message?.at === at ? (
      <Notice tone={message.tone} style={{ marginTop: space.sm, marginBottom: 0 }}>
        {message.text}
      </Notice>
    ) : null;

  // The cards still saved. When the list cannot be fetched there is none to
  // show; the last one fetched stays until a new one arrives.
  const methods = (saved.data?.data || []).filter((m) => !turnedOff.includes(m.id));
  const answerUnder = (id: string) =>
    autoPayAnswer?.id === id ? (
      <Notice tone={autoPayAnswer.tone} style={{ marginTop: space.sm, marginBottom: 0 }}>
        {autoPayAnswer.text}
      </Notice>
    ) : null;

  const loadedFace = face.data?.data;
  const faceStatus: FaceStatus | undefined =
    loadedFace && loadedFace === faceRemovedFrom ? { enrolled: false, enrolled_at: null } : loadedFace;

  const username = me?.username || user?.username || "";
  const contact = branding?.contact;
  const phone = branding?.phone || contact?.phone || "";
  const email = branding?.supportEmail || contact?.email || "";
  const siteUrl = branding?.siteUrl || "";
  const hours = branding?.openingHours || [];

  const settings = notifications.data?.data;
  const prefs: NotificationPreferences | null = settings ? { ...settings.preferences, ...flipped } : null;
  const channels = settings?.channels;
  const canPush = pushSupported();
  const pushState = usePushState();

  const preferenceRow = (key: keyof NotificationPreferences, label: string, hint?: string) =>
    prefs ? (
      <View key={key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, gap: space.lg }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 14 }}>{label}</Body>
          {hint ? <Caption>{hint}</Caption> : null}
        </View>
        {pref.busy === key ? <ActivityIndicator size="small" color={p.accent} /> : null}
        <Switch
          value={!!prefs[key]}
          onValueChange={(v) => setPreference(key, v)}
          disabled={!!pref.busy}
          accessibilityState={{ busy: pref.busy === key }}
          trackColor={{ true: p.accent, false: p.border }}
          thumbColor="#ffffff"
          accessibilityLabel={label}
        />
      </View>
    ) : null;

  // "On this phone" is two things at once: the member's preference, which
  // the server keeps, and whether the gym can reach this phone at all, which
  // only the phone knows (lib/push). The switch is on only when both are --
  // a phone that refused permission, or could not be registered, must not
  // look as if it will buzz. Switching it on tries the registration again.
  const pushOn = canPush && pushState === "on" && !!prefs?.push;
  const togglePush = (value: boolean) =>
    pref.run("push", async () => {
      if (!value) return savePreference("push", false);
      if (pushState !== "on") {
        if (!session) return;
        const now = await registerForPush(session).catch(() => "failed" as const);
        // Still not reachable: the row's own words say why, and what to do.
        if (now !== "on") return;
      }
      if (!prefs?.push) await savePreference("push", true);
    });
  const pushRow = () =>
    prefs ? (
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, gap: space.lg }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 14 }}>On this phone</Body>
          {!canPush ? (
            <Caption>Needs the app from the store, on a real phone.</Caption>
          ) : pushState === "blocked" ? (
            <>
              <Caption>Notifications are switched off for this app in your phone&apos;s settings. Switch them on there, then switch this on.</Caption>
              <Pressable {...opens("settings", () => openPhoneSettings("notifications"))} hitSlop={8} accessibilityRole="link" style={{ marginTop: 4, alignSelf: "flex-start" }}>
                <WithSpinner busy={leaving.busy === "settings"} colour={p.accent}>
                  <Body style={{ color: p.accent, fontWeight: "700", fontSize: 13 }}>Open phone settings ›</Body>
                </WithSpinner>
              </Pressable>
            </>
          ) : pushState === "failed" ? (
            <Caption>Notifications could not be set up on this phone. Switch this on to try again.</Caption>
          ) : null}
        </View>
        {pref.busy === "push" ? <ActivityIndicator size="small" color={p.accent} /> : null}
        <Switch
          value={pushOn}
          onValueChange={togglePush}
          disabled={!canPush || !!pref.busy}
          accessibilityState={{ busy: pref.busy === "push" }}
          trackColor={{ true: p.accent, false: p.border }}
          thumbColor="#ffffff"
          accessibilityLabel="Notifications on this phone"
        />
      </View>
    ) : null;

  if (closed.message) {
    return (
      <Screen title="Profile" refreshing={profile.refreshing} onRefresh={reload}>
        <GymClosed message={closed.message} gone={closed.gone} />
      </Screen>
    );
  }

  return (
    <Screen refreshing={profile.refreshing} onRefresh={reload}>
      {/* Who they are */}
      <View style={{ alignItems: "center", marginBottom: space.xl }}>
        <View
          style={{
            width: 76,
            height: 76,
            borderRadius: 38,
            backgroundColor: p.accent,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: space.md,
          }}
        >
          <Title style={{ color: p.onAccent, fontSize: 28 }}>{initials(me?.firstName || user?.firstName, me?.lastName || user?.lastName)}</Title>
        </View>
        <Title>{[me?.firstName || user?.firstName, me?.lastName || user?.lastName].filter(Boolean).join(" ")}</Title>
        <Caption style={{ marginTop: 4 }}>{gymName}</Caption>
      </View>

      {profile.error ? <Notice tone="error">{profile.error}</Notice> : null}

      {/* The username the gym gave them, which is how they get back in. */}
      {username ? (
        <Pressable
          onPress={copyUsername}
          accessibilityRole="button"
          accessibilityLabel={`Your sign-in username, ${username}${copied ? ". Copied." : ""}`}
          accessibilityHint="Copies your username"
        >
          <Card style={{ marginBottom: space.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Caption>Your sign-in username</Caption>
                <Body style={{ fontWeight: "800", fontSize: 18, marginTop: 2, letterSpacing: 0.3 }}>{username}</Body>
              </View>
              <Pill label={copied ? "copied" : "tap to copy"} tone={copied ? "good" : "neutral"} />
            </View>
          </Card>
        </Pressable>
      ) : null}

      {/* Their details */}
      {profile.loading && !me ? (
        <Loading />
      ) : editing ? (
        <Card style={{ marginBottom: space.lg }}>
          <Heading>Your details</Heading>
          <Field label="First name" value={form.firstName} onChangeText={(v) => setForm({ ...form, firstName: v })} />
          <Field label="Last name" value={form.lastName} onChangeText={(v) => setForm({ ...form, lastName: v })} />
          <Field
            label="Email (optional)"
            value={form.email}
            onChangeText={(v) => setForm({ ...form, email: v })}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            hint="Leave it empty if you do not have one. You sign in with your username either way."
          />
          {emailChanged ? (
            <Field
              label="Current password"
              value={form.currentPassword}
              onChangeText={(v) => setForm({ ...form, currentPassword: v })}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              hint={form.email.trim() ? "Needed because you are changing your email address." : "Needed because you are removing your email address."}
            />
          ) : null}
          <Field label="Phone" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
          <Field
            label="What you are training for"
            value={form.goals}
            onChangeText={(v) => setForm({ ...form, goals: v })}
            multiline
            hint="Your trainer sees this."
          />
          <Button label="Save" onPress={save} busy={account.busy === "save"} disabled={!!account.busy} />
          {answerAt("details")}
          <Button label="Cancel" variant="quiet" onPress={() => setEditing(false)} style={{ marginTop: space.sm }} />
        </Card>
      ) : (
        <Card style={{ marginBottom: space.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Heading>Your details</Heading>
            <Pressable onPress={startEditing} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit your details" style={{ marginBottom: space.md }}>
              <Body style={{ color: p.accent, fontWeight: "700", fontSize: 14 }}>Edit</Body>
            </Pressable>
          </View>
          <Line label="Email" value={me?.email || user?.email || "—"} />
          {emailUnconfirmed ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 6, marginBottom: 4 }}>
              <Caption>Email not confirmed.</Caption>
              <Pressable
                onPress={sendConfirmation}
                disabled={sendingLink}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ busy: sendingLink, disabled: sendingLink }}
              >
                <WithSpinner busy={sendingLink} colour={p.accent}>
                  <Body style={{ color: p.accent, fontWeight: "700", fontSize: 13 }}>{sendingLink ? "Sending…" : "Send the link again"}</Body>
                </WithSpinner>
              </Pressable>
            </View>
          ) : null}
          {linkAnswer ? <Caption style={{ color: linkAnswer.tone === "ok" ? p.success : p.danger, textAlign: "right", marginBottom: 4 }}>{linkAnswer.text}</Caption> : null}
          <Line label="Phone" value={me?.phone || user?.phone || "—"} />
          {me?.dateOfBirth ? <Line label="Date of birth" value={longDate(me.dateOfBirth)} /> : null}
          {me?.goals ? <Line label="Training for" value={me.goals} /> : null}
          {me?.emergencyContact?.name ? (
            <Line label="Emergency contact" value={`${me.emergencyContact.name}${me.emergencyContact.phone ? ` · ${me.emergencyContact.phone}` : ""}`} />
          ) : null}
          {me?.createdAt ? <Line label="Member since" value={longDate(me.createdAt)} /> : null}
          {answerAt("details")}
        </Card>
      )}

      {/* How they want to hear from the gym */}
      <Card style={{ marginBottom: space.lg }}>
        <Heading>Notifications</Heading>
        {notifications.loading && !settings ? (
          <Loading />
        ) : notifications.error ? (
          <Caption>{notifications.error}</Caption>
        ) : (
          <>
            {pushRow()}
            {preferenceRow("email", "By email")}
            {channels?.sms ? preferenceRow("sms", "By text message") : null}
            {channels?.whatsapp ? preferenceRow("whatsapp", "On WhatsApp") : null}
            {preferenceRow("marketing", "Offers and news", "Bookings, payments and reminders always reach you.")}
            {answerAt("notifications")}
          </>
        )}
      </Card>

      {/* A card the gym charges by itself on each due date, and the way to
          stop that. Once the last one is turned off, its answer keeps the
          section up until the member leaves the tab. */}
      {methods.length > 0 || autoPayAnswer ? (
        <Card style={{ marginBottom: space.lg }}>
          <Heading>Automatic payments</Heading>
          {methods.map((m, i) => {
            const expiry = cardExpiry(m, now);
            return (
              <View key={m.id}>
                {i > 0 ? <Divider /> : null}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{cardName(m)}</Body>
                    {expiry ? (
                      <Caption style={expiry.expired ? { marginTop: 2, color: p.danger } : { marginTop: 2 }}>
                        {expiry.expired ? `Expired ${expiry.label} — you will get a payment link instead` : `Expires ${expiry.label}`}
                      </Caption>
                    ) : null}
                    {m.consent_at ? <Caption>{m.auto_pay ? "Turned on" : "Saved"} {longDate(m.consent_at)}</Caption> : null}
                  </View>
                  <Pill label={m.auto_pay ? "on" : "off"} tone={m.auto_pay ? "good" : "neutral"} />
                </View>
                <Button
                  label={m.auto_pay ? "Turn off" : "Remove card"}
                  variant="secondary"
                  onPress={() => turnOffAutoPay(m)}
                  busy={autoPay.busy === m.id}
                  disabled={!!autoPay.busy}
                  style={{ marginTop: space.md }}
                />
                {answerUnder(m.id)}
              </View>
            );
          })}
          {/* The card just turned off has left the list; what came of it stays in its place. */}
          {autoPayAnswer && !methods.some((m) => m.id === autoPayAnswer.id) ? answerUnder(autoPayAnswer.id) : null}
          {methods.length > 0 ? (
            <Caption style={{ marginTop: space.md }}>
              Your gym charges your saved card on each due date, as you agreed when you saved it. Turn it off and you will get a payment link before each due
              date instead. The card itself is kept by the payment provider, not by your gym or GymsPilotPro.
            </Caption>
          ) : null}
        </Card>
      ) : null}

      {/* Whether the desk's webcam knows their face, and a way to take that back. */}
      <Card style={{ marginBottom: space.lg }}>
        <Heading>Face check-in</Heading>
        {face.loading && !faceStatus ? (
          <Loading />
        ) : face.error && !faceStatus ? (
          // A server from before face check-in has nothing to say about it.
          <Caption>{face.errorStatus === 404 ? "Face check-in is not available at your gym yet." : face.error}</Caption>
        ) : faceStatus ? (
          <>
            <Line label="Status" value={<Pill label={faceStatus.enrolled ? "on" : "off"} tone={faceStatus.enrolled ? "good" : "neutral"} />} />
            {faceStatus.enrolled && faceStatus.enrolled_at ? <Line label="Added" value={longDate(faceStatus.enrolled_at)} /> : null}
          </>
        ) : null}
        {faceStatus ? (
          <Caption style={{ marginTop: space.sm }}>
            Faces are added at the front desk, only with your consent; the gym keeps an encrypted face template, never a photo.
          </Caption>
        ) : null}
        {faceStatus?.enrolled ? (
          <Button label="Remove my face data" variant="danger" onPress={removeFace} busy={!!faceRemoval.busy} style={{ marginTop: space.lg }} />
        ) : null}
        {faceAnswer ? (
          <Caption style={{ color: faceAnswer.tone === "ok" ? p.success : p.danger, marginTop: space.sm }}>{faceAnswer.text}</Caption>
        ) : null}
      </Card>

      {/* Where they train */}
      <Card style={{ marginBottom: space.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.md }}>
          <Body style={{ fontWeight: "700", fontSize: 17 }}>Your gym</Body>
          <GymMark size={28} />
        </View>
        {phone ? (
          <Pressable
            {...opens("phone", () => openApp(`tel:${phone.replace(/[^\d+]/g, "")}`, `This phone cannot make calls. Your gym's number is ${phone}.`))}
            accessibilityRole="link"
            accessibilityLabel={`Call your gym on ${phone}`}
          >
            <Line
              label="Phone"
              value={
                <WithSpinner busy={leaving.busy === "phone"} colour={p.accent}>
                  <Body style={{ color: p.accent, fontWeight: "600" }}>{phone}</Body>
                </WithSpinner>
              }
            />
          </Pressable>
        ) : null}
        {email ? (
          <Pressable
            {...opens("email", () => openApp(`mailto:${email}`, `There is no email app set up on this phone. Your gym's address is ${email}.`))}
            accessibilityRole="link"
            accessibilityLabel={`Email your gym at ${email}`}
          >
            <Line
              label="Email"
              value={
                <WithSpinner busy={leaving.busy === "email"} colour={p.accent}>
                  <Body style={{ color: p.accent, fontWeight: "600" }}>{email}</Body>
                </WithSpinner>
              }
            />
          </Pressable>
        ) : null}
        {contact?.address ? <Line label="Address" value={contact.address} /> : null}
        {branding?.whatsapp ? (
          <Pressable
            {...opens("whatsapp", () =>
              openApp(`https://wa.me/${branding.whatsapp.replace(/[^0-9]/g, "")}`, `WhatsApp could not be opened on this phone. Your gym's WhatsApp number is ${branding.whatsapp}.`)
            )}
            accessibilityRole="link"
            accessibilityLabel="Message your gym on WhatsApp"
          >
            <Line
              label="WhatsApp"
              value={
                <WithSpinner busy={leaving.busy === "whatsapp"} colour={p.accent}>
                  <Body style={{ color: p.accent, fontWeight: "600" }}>Message the gym</Body>
                </WithSpinner>
              }
            />
          </Pressable>
        ) : null}
        {siteUrl ? (
          <Pressable {...opens("website", () => openWeb(siteUrl))} accessibilityRole="link" accessibilityLabel="Open your gym's website">
            <Line
              label="Website"
              value={
                <WithSpinner busy={leaving.busy === "website"} colour={p.accent}>
                  <Body style={{ color: p.accent, fontWeight: "600" }}>{siteUrl.replace(/^https?:\/\//, "")}</Body>
                </WithSpinner>
              }
            />
          </Pressable>
        ) : null}
        {!phone && !email && !contact?.address && !branding?.whatsapp && !siteUrl ? (
          <Caption>Your gym has not added its contact details yet.</Caption>
        ) : null}

        {hours.length > 0 ? (
          <>
            <Divider />
            <Caption style={{ marginBottom: space.sm, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" }}>Opening hours</Caption>
            {hours.map((h) => (
              <View key={h.day} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                <Caption style={{ fontSize: 13.5 }}>{h.day}</Caption>
                <Caption style={{ fontSize: 13.5, color: h.closed ? p.textFaint : p.textMuted }}>{h.closed ? "closed" : `${h.open} – ${h.close}`}</Caption>
              </View>
            ))}
          </>
        ) : null}
      </Card>

      {/* Everything else */}
      <View style={{ gap: space.sm }}>
        <RowLink label="Your visits" onPress={() => router.push("/attendance")} />
        <RowLink label="Your past bookings" onPress={() => router.push("/bookings")} />
        <RowLink label="Scan to check in" onPress={() => router.push("/checkin")} />

        {changingPassword ? (
          <Card>
            <Heading>Change your password</Heading>
            {passwordError ? <Notice tone="error">{passwordError}</Notice> : null}
            <Field
              label="Current password"
              value={passwords.currentPassword}
              onChangeText={(v) => setPasswords({ ...passwords, currentPassword: v })}
              secureTextEntry
              autoCapitalize="none"
            />
            <Field
              label="New password"
              value={passwords.newPassword}
              onChangeText={(v) => setPasswords({ ...passwords, newPassword: v })}
              secureTextEntry
              autoCapitalize="none"
              hint={`At least ${MIN_PASSWORD} characters.`}
            />
            <Field
              label="New password again"
              value={passwords.confirm}
              onChangeText={(v) => setPasswords({ ...passwords, confirm: v })}
              secureTextEntry
              autoCapitalize="none"
            />
            <Button label="Change password" onPress={changePassword} busy={account.busy === "password"} disabled={!!account.busy} />
            <Button
              label="Cancel"
              variant="quiet"
              onPress={() => {
                setChangingPassword(false);
                setPasswordError(null);
              }}
              style={{ marginTop: space.sm }}
            />
          </Card>
        ) : (
          <RowLink label="Change your password" onPress={() => setChangingPassword(true)} />
        )}

        <Button label="Sign out" variant="danger" onPress={confirmSignOut} busy={account.busy === "signOut"} disabled={!!account.busy} style={{ marginTop: space.md }} />
        <Button label="Delete my account" variant="quiet" onPress={deleteAccount} busy={account.busy === "delete"} disabled={!!account.busy} />
        {answerAt("account")}

        <View style={{ alignItems: "center", marginTop: space.lg, gap: 2 }}>
          <Caption style={{ fontSize: 11 }}>{branding?.siteName || gymName}</Caption>
          <Caption style={{ fontSize: 11 }}>Powered by GymsPilotPro</Caption>
        </View>
        <View style={{ marginTop: space.sm }}>
          <LegalLinks />
        </View>
      </View>
    </Screen>
  );
}
