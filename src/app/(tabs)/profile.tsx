// The member's own details: who the gym has them down as, the username they
// sign in with, their gym's contact details and opening hours, how they want
// to hear from the gym, and the two things they can change -- their details
// and their password. And the way out for good: deleting the account, which
// the app stores require of an app with sign-in.

import React, { useEffect, useState } from "react";
import { Linking, Pressable, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { GymMark, Screen } from "@/components/Screen";
import { Body, Button, Caption, Card, Divider, Field, GymClosed, Heading, LegalLinks, Line, Loading, Notice, Pill, Title } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { confirmAction, tellMember } from "@/lib/confirm";
import { initials, longDate } from "@/lib/format";
import { pushSupported } from "@/lib/push";
import { usePalette, useSession } from "@/lib/session";
import { space } from "@/lib/theme";
import { useGymClosed, useLoad } from "@/lib/useLoad";
import type { NotificationPreferences, NotificationSettings, Profile as ProfileData } from "@/lib/types";

const MIN_PASSWORD = 8;

/**
 * Why a profile save failed, in words a member can act on. The server's
 * message is a generic "Error updating user"; the reason is in its `error`
 * -- a database duplicate or validation text, not for showing as it is.
 */
function saveProblem(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : "Could not save your details.";
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
  const closed = useGymClosed(profile, notifications);
  const reload = () => {
    closed.clear();
    profile.reload();
    notifications.reload();
  };

  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // Shown inside the password card, next to the fields it is about.
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", goals: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });

  // The switches show what the server has, plus whatever the member has just
  // flipped: an optimistic layer over the loaded values, put back if the
  // save fails.
  const [flipped, setFlipped] = useState<Partial<NotificationPreferences>>({});
  const [savingPref, setSavingPref] = useState<keyof NotificationPreferences | null>(null);

  // Filled in when Edit is pressed rather than whenever the fetch lands, so a
  // refresh arriving mid-edit cannot wipe what has been typed.
  const startEditing = () => {
    setForm({
      firstName: me?.firstName || "",
      lastName: me?.lastName || "",
      email: me?.email || "",
      phone: me?.phone || "",
      goals: me?.goals || "",
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
    await Clipboard.setStringAsync(username);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const save = async () => {
    const body = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      goals: form.goals.trim(),
    };
    // What the server would refuse anyway, said before the round trip.
    if (!body.firstName || !body.lastName) {
      setMessage({ tone: "error", text: "Your first and last name cannot be empty." });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      setMessage({ tone: "error", text: "That does not look like an email address." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ message?: string; data?: ProfileData }>("/update/user", { method: "PUT", session, onUnauthorised: signOut, body });
      // Home greets the member by name: it should be the new one straight away.
      if (res.data) await updateUser(res.data);
      setMessage({ tone: "ok", text: "Your details have been saved." });
      setEditing(false);
      profile.reload();
    } catch (e) {
      if (closed.caught(e)) return;
      setMessage({ tone: "error", text: saveProblem(e) });
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (passwords.newPassword.length < MIN_PASSWORD) {
      setPasswordError(`Your new password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (passwords.newPassword !== passwords.confirm) {
      setPasswordError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  };

  const setPreference = async (key: keyof NotificationPreferences, value: boolean) => {
    setFlipped((f) => ({ ...f, [key]: value }));
    setSavingPref(key);
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
      setMessage({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "Could not save that." });
    } finally {
      setSavingPref(null);
    }
  };

  const confirmSignOut = async () => {
    const sure = await confirmAction({
      title: "Sign out?",
      message: "You will need your username and password to get back in.",
      confirm: "Sign out",
      cancel: "Stay signed in",
      destructive: true,
    });
    if (sure) await signOut();
  };

  // Deleting the account is final: the server removes it and releases the
  // username, so there is nothing to sign back in to. A membership is a
  // separate thing the gym bills for, and deleting the account does not stop
  // it -- the member is told so before they confirm.
  const deleteAccount = async () => {
    const sure = await confirmAction({
      title: "Delete your account?",
      message:
        `This permanently deletes your account at ${gymName || "your gym"} and your sign-in username. It cannot be undone.\n\n` +
        "It does not cancel a membership that renews automatically: cancel that first on the Membership tab, or ask your gym.",
      confirm: "Delete my account",
      cancel: "Keep my account",
      destructive: true,
    });
    if (!sure) return;
    setDeleting(true);
    setMessage(null);
    try {
      await api<{ message?: string }>("/user", { method: "DELETE", session, onUnauthorised: signOut });
      // The account is gone, and this session with it. Sign-out takes the
      // phone off the gym's notification list before it clears anything.
      await signOut();
      await tellMember("Account deleted", "Your account has been deleted.");
    } catch (e) {
      if (closed.caught(e)) return;
      setMessage({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "Could not delete your account." });
    } finally {
      setDeleting(false);
    }
  };

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

  const preferenceRow = (key: keyof NotificationPreferences, label: string, hint?: string) =>
    prefs ? (
      <View key={key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, gap: space.lg }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 14 }}>{label}</Body>
          {hint ? <Caption>{hint}</Caption> : null}
        </View>
        <Switch
          value={!!prefs[key]}
          onValueChange={(v) => setPreference(key, v)}
          disabled={savingPref === key}
          trackColor={{ true: p.accent, false: p.border }}
          thumbColor="#ffffff"
          accessibilityLabel={label}
        />
      </View>
    ) : null;

  if (closed.message) {
    return (
      <Screen title="Profile" refreshing={profile.refreshing} onRefresh={reload}>
        <GymClosed message={closed.message} />
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

      {message ? <Notice tone={message.tone === "ok" ? "ok" : "error"}>{message.text}</Notice> : null}
      {profile.error ? <Notice tone="error">{profile.error}</Notice> : null}

      {/* The username the gym gave them, which is how they get back in. */}
      {username ? (
        <Pressable onPress={copyUsername}>
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
          <Field label="Email" value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Phone" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
          <Field
            label="What you are training for"
            value={form.goals}
            onChangeText={(v) => setForm({ ...form, goals: v })}
            multiline
            hint="Your trainer sees this."
          />
          <Button label="Save" onPress={save} busy={busy} />
          <Button label="Cancel" variant="quiet" onPress={() => setEditing(false)} style={{ marginTop: space.sm }} />
        </Card>
      ) : (
        <Card style={{ marginBottom: space.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Heading>Your details</Heading>
            <Pressable onPress={startEditing} hitSlop={10} style={{ marginBottom: space.md }}>
              <Body style={{ color: p.accent, fontWeight: "700", fontSize: 14 }}>Edit</Body>
            </Pressable>
          </View>
          <Line label="Email" value={me?.email || user?.email || "—"} />
          <Line label="Phone" value={me?.phone || user?.phone || "—"} />
          {me?.dateOfBirth ? <Line label="Date of birth" value={longDate(me.dateOfBirth)} /> : null}
          {me?.goals ? <Line label="Training for" value={me.goals} /> : null}
          {me?.emergencyContact?.name ? (
            <Line label="Emergency contact" value={`${me.emergencyContact.name}${me.emergencyContact.phone ? ` · ${me.emergencyContact.phone}` : ""}`} />
          ) : null}
          {me?.createdAt ? <Line label="Member since" value={longDate(me.createdAt)} /> : null}
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
            {preferenceRow("push", "On this phone", canPush ? undefined : "Needs the app from the store, on a real phone.")}
            {preferenceRow("email", "By email")}
            {channels?.sms ? preferenceRow("sms", "By text message") : null}
            {channels?.whatsapp ? preferenceRow("whatsapp", "On WhatsApp") : null}
            {preferenceRow("marketing", "Offers and news", "Bookings, payments and reminders always reach you.")}
          </>
        )}
      </Card>

      {/* Where they train */}
      <Card style={{ marginBottom: space.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.md }}>
          <Body style={{ fontWeight: "700", fontSize: 17 }}>Your gym</Body>
          <GymMark size={28} />
        </View>
        {phone ? (
          <Pressable onPress={() => Linking.openURL(`tel:${phone}`)}>
            <Line label="Phone" value={<Body style={{ color: p.accent, fontWeight: "600" }}>{phone}</Body>} />
          </Pressable>
        ) : null}
        {email ? (
          <Pressable onPress={() => Linking.openURL(`mailto:${email}`)}>
            <Line label="Email" value={<Body style={{ color: p.accent, fontWeight: "600" }}>{email}</Body>} />
          </Pressable>
        ) : null}
        {contact?.address ? <Line label="Address" value={contact.address} /> : null}
        {branding?.whatsapp ? (
          <Pressable onPress={() => Linking.openURL(`https://wa.me/${branding.whatsapp.replace(/[^0-9]/g, "")}`)}>
            <Line label="WhatsApp" value={<Body style={{ color: p.accent, fontWeight: "600" }}>Message the gym</Body>} />
          </Pressable>
        ) : null}
        {siteUrl ? (
          <Pressable onPress={() => WebBrowser.openBrowserAsync(siteUrl)}>
            <Line label="Website" value={<Body style={{ color: p.accent, fontWeight: "600" }}>{siteUrl.replace(/^https?:\/\//, "")}</Body>} />
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
        <Pressable
          onPress={() => router.push("/attendance")}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Body style={{ fontWeight: "600" }}>Your visits</Body>
            <Body style={{ color: p.textFaint }}>›</Body>
          </Card>
        </Pressable>

        <Pressable onPress={() => router.push("/bookings")} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Body style={{ fontWeight: "600" }}>Your past bookings</Body>
            <Body style={{ color: p.textFaint }}>›</Body>
          </Card>
        </Pressable>

        <Pressable onPress={() => router.push("/checkin")} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Body style={{ fontWeight: "600" }}>Your check-in code</Body>
            <Body style={{ color: p.textFaint }}>›</Body>
          </Card>
        </Pressable>

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
            <Button label="Change password" onPress={changePassword} busy={busy} />
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
          <Pressable onPress={() => setChangingPassword(true)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Body style={{ fontWeight: "600" }}>Change your password</Body>
              <Body style={{ color: p.textFaint }}>›</Body>
            </Card>
          </Pressable>
        )}

        <Button label="Sign out" variant="danger" onPress={confirmSignOut} style={{ marginTop: space.md }} />
        <Button label="Delete my account" variant="quiet" onPress={deleteAccount} busy={deleting} disabled={busy} />

        <View style={{ alignItems: "center", marginTop: space.lg, gap: 2 }}>
          <Caption style={{ fontSize: 11 }}>{branding?.siteName || gymName}</Caption>
          <Caption style={{ fontSize: 11 }}>Powered by GymPilot</Caption>
        </View>
        <View style={{ marginTop: space.sm }}>
          <LegalLinks />
        </View>
      </View>
    </Screen>
  );
}
