import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, usePalette } from "@/lib/session";

// Screens paint their own background, so the stack's is only ever seen for a
// frame — but on the gym's colour rather than white, so that frame does not
// flash.
function Navigator() {
  const p = usePalette();
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
