import React from "react";
import { Tabs } from "expo-router";
import { CalendarIcon, CardIcon, HomeIcon, PersonIcon } from "@/components/icons";
import { usePalette } from "@/lib/session";
import { useRequireSession } from "@/lib/useRequireSession";

export default function TabsLayout() {
  // Nothing behind the tabs is public. The hook sends a signed-out member
  // to the sign-in screen; until then, nothing of theirs is drawn.
  const { session } = useRequireSession();
  const p = usePalette();

  if (!session) return null;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.accent,
        tabBarInactiveTintColor: p.textFaint,
        tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.border, borderTopWidth: 1 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: p.base },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color }) => <HomeIcon color={color} /> }} />
      <Tabs.Screen name="classes" options={{ title: "Classes", tabBarIcon: ({ color }) => <CalendarIcon color={color} /> }} />
      <Tabs.Screen name="membership" options={{ title: "Membership", tabBarIcon: ({ color }) => <CardIcon color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color }) => <PersonIcon color={color} /> }} />
    </Tabs>
  );
}
