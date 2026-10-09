// Sign in.
//
// Username and password, both handed over by the gym. There is deliberately
// no "create an account": a member exists because a gym put them on its
// books, and letting anyone sign themselves up would put strangers inside
// somebody's gym.
//
// Accounts that switched on two-factor sign-in get a second step here: the
// six-digit code the server emailed them. A wrong code costs one of five
// tries and sends nothing; "Send a new code" is the first step again.
//
// A build made without a real server address cannot sign anyone in, and
// says so here rather than failing with "cannot reach your gym".

import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GymPilotMark } from "@/components/icons";
import { Body, Button, Caption, Field, LegalLinks, Notice, Title } from "@/components/ui";
import { API_CONFIGURED, API_HINT, NOT_CONFIGURED_MESSAGE } from "@/lib/config";
import { usePalette, useSession } from "@/lib/session";
import { space } from "@/lib/theme";

export default function Login() {
  const { signIn, completeTwoFactor, signOutReason } = useSession();
  const router = useRouter();
  const p = usePalette();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The second step, when there is one. The gym slug travels with the
  // challenge: it tells the server which gym's database holds it.
  const [challenge, setChallenge] = useState<{ id: string; gymSlug: string } | null>(null);
  const [code, setCode] = useState("");

  const submit = async () => {
    if (!username.trim() || !password) {
      setError("Enter the username and password your gym gave you.");
      return;
    }
    // Sign-in is by username only, and no username has an @ in it: say so
    // rather than let an email address come back as "wrong password".
    if (username.includes("@")) {
      setError("That looks like an email address. Sign in with the username your gym gave you instead, for example saramalik284.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await signIn(username, password);
      if (result.requires2fa) {
        if (!result.challengeId || !result.gymSlug) {
          throw new Error("Your gym asks for a code by email, but the sign-in could not be started. Please try again.");
        }
        setChallenge({ id: result.challengeId, gymSlug: result.gymSlug });
        setCode("");
        setNotice(result.message || "We emailed you a 6-digit code.");
        return;
      }
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign you in.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!challenge) return;
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeTwoFactor(challenge.id, digits, challenge.gymSlug);
      router.replace("/(tabs)");
    } catch (e) {
      const message = e instanceof Error ? e.message : "That code did not work.";
      setError(message);
      // A challenge that has expired, or died of too many wrong codes, cannot
      // be retried: the server says so in as many words, and the member
      // starts again from the password.
      if (/sign in again/i.test(message)) {
        setChallenge(null);
        setNotice(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const backToPassword = () => {
    setChallenge(null);
    setCode("");
    setError(null);
    setNotice(null);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.base }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: space.xl, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", marginBottom: space.xxl }}>
          <GymPilotMark />
          <Title style={{ marginTop: space.lg }}>{challenge ? "Check your email" : "GymPilot"}</Title>
          <Caption style={{ marginTop: 6, textAlign: "center", fontSize: 14 }}>
            {challenge ? "Type the 6-digit code we sent you to finish signing in." : "Sign in with the username and password your gym gave you."}
          </Caption>
        </View>

        {!API_CONFIGURED ? <Notice tone="error">{NOT_CONFIGURED_MESSAGE}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="warn">{notice}</Notice> : null}
        {!challenge && !error && signOutReason ? <Notice tone="warn">{signOutReason}</Notice> : null}

        {challenge ? (
          <>
            <Field
              label="Sign-in code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              placeholder="123456"
              returnKeyType="go"
              onSubmitEditing={verify}
              style={{ letterSpacing: 6, fontSize: 22, textAlign: "center" }}
            />
            <Button label="Verify" onPress={verify} busy={busy} />
            <Button label="Send a new code" variant="secondary" onPress={submit} disabled={busy} style={{ marginTop: space.sm }} />
            <Button label="Back" variant="quiet" onPress={backToPassword} disabled={busy} style={{ marginTop: space.sm }} />
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
              returnKeyType="next"
              hint="The username your gym gave you, not your email address."
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              placeholder="••••••••"
              returnKeyType="go"
              onSubmitEditing={submit}
            />

            <Button label="Sign in" onPress={submit} busy={busy} disabled={!API_CONFIGURED} />

            <Pressable
              onPress={() => router.push("/forgot")}
              hitSlop={10}
              style={{ alignSelf: "center", marginTop: space.lg }}
              disabled={busy || !API_CONFIGURED}
            >
              <Body style={{ color: p.accent, fontWeight: "700", fontSize: 14 }}>Forgot password?</Body>
            </Pressable>
            {/* An account made with Google on the website has no password
                until the member sets one through the reset link. */}
            <Caption style={{ marginTop: space.sm, textAlign: "center", fontSize: 12.5 }}>
              Joined with Google? Use Forgot password to set one.
            </Caption>
          </>
        )}

        <View style={{ marginTop: space.xl, alignItems: "center", gap: 6 }}>
          <Body muted style={{ fontSize: 13.5, textAlign: "center" }}>
            Cannot find your username? Your gym gave it to you with your password. The front desk can look it up, and issues one if you have none yet.
          </Body>
          {API_HINT ? <Caption style={{ fontSize: 11 }}>{API_HINT}</Caption> : null}
        </View>

        <View style={{ marginTop: space.xl }}>
          <LegalLinks />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
