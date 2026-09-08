// The member's own details: who the gym has them down as, the username they
// sign in with, their gym's contact details and opening hours, and the two
// things they can change -- their details and their password.

import React, { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { GymMark, Screen } from "@/components/Screen";
import { Body, Button, Caption, Card, Divider, Field, Heading, Line, Loading, Notice, Pill, Title } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { confirmAction, tellMember } from "@/lib/confirm";
import { initials, longDate } from "@/lib/format";
import { usePalette, useSession } from "@/lib/session";
import { space } from "@/lib/theme";
import { useLoad } from "@/lib/useLoad";
import type { Profile as ProfileData } from "@/lib/types";

const MIN_PASSWORD = 8;

export default function Profile() {
  const { session, user, gymName, branding, signOut, refresh } = useSession();
  const p = usePalette();
  const router = useRouter();

  const profile = useLoad<{ data: ProfileData }>("/userDetailForProfile");
  const me = profile.data?.data;

  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", goals: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });

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

  // The gym's colours can change under the member's feet; pick them up when
  // they open their profile rather than making them sign in again.
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
    setBusy(true);
    setMessage(null);
    try {
      await api<{ message?: string }>("/update/user", { method: "PUT", session, onUnauthorised: signOut, body: form });
      setMessage({ tone: "ok", text: "Your details have been saved." });
      setEditing(false);
      profile.reload();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "Could not save your details." });
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (passwords.newPassword.length < MIN_PASSWORD) {
      setMessage({ tone: "error", text: `Your new password needs at least ${MIN_PASSWORD} characters.` });
      return;
    }
    if (passwords.newPassword !== passwords.confirm) {
      setMessage({ tone: "error", text: "The two new passwords do not match." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api<{ message?: string }>("/user/change-password", {
        method: "PUT",
        session,
        onUnauthorised: signOut,
        body: { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword },
      });
      // Changing the password ends every session, this one included.
      await tellMember("Password changed", "Please sign in again with your new password.");
      await signOut();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "Could not change your password." });
    } finally {
      setBusy(false);
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

  const username = me?.username || user?.username || "";
  const contact = branding?.contact;
  const hours = branding?.openingHours || [];

  return (
    <Screen refreshing={profile.refreshing} onRefresh={profile.reload}>
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

      {/* Where they train */}
      <Card style={{ marginBottom: space.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.md }}>
          <Body style={{ fontWeight: "700", fontSize: 17 }}>Your gym</Body>
          <GymMark size={28} />
        </View>
        {contact?.phone ? (
          <Pressable onPress={() => Linking.openURL(`tel:${contact.phone}`)}>
            <Line label="Phone" value={<Body style={{ color: p.accent, fontWeight: "600" }}>{contact.phone}</Body>} />
          </Pressable>
        ) : null}
        {contact?.email ? (
          <Pressable onPress={() => Linking.openURL(`mailto:${contact.email}`)}>
            <Line label="Email" value={<Body style={{ color: p.accent, fontWeight: "600" }}>{contact.email}</Body>} />
          </Pressable>
        ) : null}
        {contact?.address ? <Line label="Address" value={contact.address} /> : null}
        {branding?.whatsapp ? (
          <Pressable onPress={() => Linking.openURL(`https://wa.me/${branding.whatsapp.replace(/[^0-9]/g, "")}`)}>
            <Line label="WhatsApp" value={<Body style={{ color: p.accent, fontWeight: "600" }}>Message the gym</Body>} />
          </Pressable>
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

        <Pressable onPress={() => router.push("/checkin")} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Body style={{ fontWeight: "600" }}>Your check-in code</Body>
            <Body style={{ color: p.textFaint }}>›</Body>
          </Card>
        </Pressable>

        {changingPassword ? (
          <Card>
            <Heading>Change your password</Heading>
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
            <Button label="Cancel" variant="quiet" onPress={() => setChangingPassword(false)} style={{ marginTop: space.sm }} />
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

        <View style={{ alignItems: "center", marginTop: space.lg, gap: 2 }}>
          <Caption style={{ fontSize: 11 }}>{branding?.siteName || gymName}</Caption>
          <Caption style={{ fontSize: 11 }}>Powered by GymPilot</Caption>
        </View>
      </View>
    </Screen>
  );
}
