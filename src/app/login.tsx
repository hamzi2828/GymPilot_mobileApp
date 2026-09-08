// Sign in.
//
// Username and password, both handed over by the gym. There is deliberately
// no "create an account": a member exists because a gym put them on its
// books, and letting anyone sign themselves up would put strangers inside
// somebody's gym.

import React, { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Body, Button, Caption, Field, Notice, Title } from "@/components/ui";
import { API_HINT } from "@/lib/config";
import { usePalette, useSession } from "@/lib/session";
import { space } from "@/lib/theme";

export default function Login() {
  const { signIn } = useSession();
  const router = useRouter();
  const p = usePalette();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    if (!username.trim() || !password) {
      setError("Enter the username and password your gym gave you.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await signIn(username, password);
      if (result.requires2fa) {
        // Rare, and only for accounts that switched it on. Finishing it needs
        // the emailed code, which the website handles today.
        setNotice(result.message || "Your gym asks for a code by email. Please sign in on the website this time.");
        return;
      }
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign you in.");
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
          <Image source={require("../../assets/images/icon.png")} style={{ width: 68, height: 68, borderRadius: 20 }} accessibilityLabel="GymPilot" />
          <Title style={{ marginTop: space.lg }}>GymPilot</Title>
          <Caption style={{ marginTop: 6, textAlign: "center", fontSize: 14 }}>
            Sign in with the username and password your gym gave you.
          </Caption>
        </View>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="warn">{notice}</Notice> : null}

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

        <Button label="Sign in" onPress={submit} busy={busy} />

        <View style={{ marginTop: space.xl, alignItems: "center", gap: 6 }}>
          <Body muted style={{ fontSize: 13.5, textAlign: "center" }}>
            No username yet? Ask at the front desk — your gym issues it.
          </Body>
          <Caption style={{ fontSize: 11 }}>{API_HINT}</Caption>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
