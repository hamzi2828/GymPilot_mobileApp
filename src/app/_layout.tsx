import React from "react";
import { Pressable, Text, View } from "react-native";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useNotificationTaps } from "@/lib/push";
import { SessionProvider, usePalette, useSession } from "@/lib/session";
import { paletteFrom, radius, space } from "@/lib/theme";

// Screens paint their own background, so the stack's is only ever seen for a
// frame — but on the gym's colour rather than white, so that frame does not
// flash.
function Navigator() {
  const p = usePalette();
  const { ready, session } = useSession();
  // A tapped notification opens the screen it is about. Here because this is
  // the one component that is always mounted and can navigate.
  useNotificationTaps(ready, !!session);
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: p.base },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="forgot" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="checkin" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="attendance" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="bookings" options={{ animation: "slide_from_right" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Navigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * What the member sees when a screen throws while drawing -- a reply from the
 * server in a shape nothing expected, say. Without this a release build simply
 * closes. expo-router wraps this layout in whatever it exports under this
 * name, and "Try again" draws the app afresh: the session is read back from
 * the phone, so the member stays signed in.
 *
 * It stands in for the whole layout, so the session and the gym's colours are
 * not there to be used; it is painted in the app's own.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const p = paletteFrom(null);
  return (
    <View style={{ flex: 1, backgroundColor: p.base, alignItems: "center", justifyContent: "center", padding: space.xl }}>
      <StatusBar style="light" />
      <Text style={{ color: p.text, fontSize: 22, fontWeight: "800", textAlign: "center" }} accessibilityRole="header">
        Something went wrong
      </Text>
      <Text style={{ color: p.textMuted, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: space.sm }}>
        The app could not show that screen. Your account and your membership are not affected.
      </Text>
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        style={({ pressed }) => ({
          backgroundColor: p.accent,
          opacity: pressed ? 0.85 : 1,
          borderRadius: radius.pill,
          paddingVertical: 14,
          paddingHorizontal: space.xxl,
          marginTop: space.xl,
        })}
      >
        <Text style={{ color: p.onAccent, fontWeight: "700", fontSize: 15 }}>Try again</Text>
      </Pressable>
      <Text style={{ color: p.textFaint, fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: space.lg }}>
        If this keeps happening, close the app and open it again, or let your gym know.
      </Text>
      {/* For whoever is building the app; a member has no use for it. */}
      {__DEV__ && error?.message ? (
        <Text style={{ color: p.textFaint, fontSize: 11, textAlign: "center", marginTop: space.lg }}>{error.message}</Text>
      ) : null}
    </View>
  );
}
