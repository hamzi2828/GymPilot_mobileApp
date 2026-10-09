// Forgot password.
//
// The member types their username; the server finds their gym from it and
// emails the same reset link the gym's website sends. The link opens on the
// website, where the new password is chosen -- the app has no page of its
// own for that, and does not need one.
//
// The answer is the same whether or not the username exists. A form that
// said "no such member" would be a way to check who trains where.
//
// Plenty of members have no email address at all -- the desk made their
// account and handed them a username -- and for them the server sends
// nothing. So the screen never says "we emailed you": it says a link is on
// its way if the account has an address, and that the front desk can reset
// the password when it has not, which is true for everyone and gives nothing
// away.
//
// It is also how a member who joined with Google on the website gets a
// password for the app: their account has none until they set one here.

import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Body, Button, Caption, Field, Notice, Title } from "@/components/ui";
import { forgotPassword } from "@/lib/api";
import { usePalette } from "@/lib/session";
import { space } from "@/lib/theme";

export default function Forgot() {
  const router = useRouter();
  const p = usePalette();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!username.trim()) {
      setError("Enter the username your gym gave you.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The server's own sentence ("we emailed a reset link") is not shown:
      // it is not true for an account with no address.
      await forgotPassword(username);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send a reset link right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.base }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: space.xl, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", marginBottom: space.xxl }}>
          <Title>Forgot your password?</Title>
          {sent ? null : (
            <>
              <Caption style={{ marginTop: 6, textAlign: "center", fontSize: 14 }}>
                Type your username. If your gym has an email address for you, we will send it a link to choose a new password.
              </Caption>
              <Caption style={{ marginTop: 6, textAlign: "center", fontSize: 13 }}>
                Joined with Google? This is how you set a password for the app.
              </Caption>
            </>
          )}
        </View>

        {error ? <Notice tone="error">{error}</Notice> : null}

        {sent ? (
          <>
            <Notice tone="ok">If this account has an email address, a link to choose a new password is on its way to it.</Notice>
            <Body muted style={{ fontSize: 13.5, textAlign: "center", marginBottom: space.lg }}>
              The link opens on your gym&apos;s website and works for an hour. Once you have chosen a new password, come back here and sign in with it.
            </Body>
            {/* The way out for a member with no address on file, said to
                everyone so that it says nothing about this account. */}
            <Notice tone="warn">
              No email after a few minutes, or you never gave your gym an email address? Ask the front desk. They can set a new password for you on the spot.
            </Notice>
            <Button label="Back to sign in" onPress={() => router.back()} />
          </>
        ) : (
          <>
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              placeholder="e.g. saramalik284"
              returnKeyType="send"
              onSubmitEditing={submit}
              hint="The username your gym gave you, not your email address."
            />
            <Button label="Send a reset link" onPress={submit} busy={busy} />
            <Button label="Back" variant="quiet" onPress={() => router.back()} disabled={busy} style={{ marginTop: space.sm }} />
          </>
        )}

        {sent ? null : (
          <View style={{ marginTop: space.xl, alignItems: "center" }}>
            <Body muted style={{ fontSize: 13.5, textAlign: "center" }}>
              Not sure of your username, or no email address? The front desk can look up your username and set a new password for you.
            </Body>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
