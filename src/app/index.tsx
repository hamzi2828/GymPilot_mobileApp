import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { usePalette, useSession } from "@/lib/session";

// The first frame: wait for the stored session to be read, then either the
// member's gym or the sign-in screen. Nothing else lives at "/".
export default function Index() {
  const { ready, session } = useSession();
  const p = usePalette();

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: p.base, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={p.accent} />
      </View>
    );
  }

  return <Redirect href={session ? "/(tabs)" : "/login"} />;
}
