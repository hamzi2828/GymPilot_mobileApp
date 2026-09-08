import React from "react";
import { Redirect, Tabs } from "expo-router";
import { CalendarIcon, CardIcon, HomeIcon, PersonIcon } from "@/components/icons";
import { usePalette, useSession } from "@/lib/session";

export default function TabsLayout() {
  const { ready, session } = useSession();
  const p = usePalette();

  // Nothing behind the tabs is public.
  if (ready && !session) return <Redirect href="/login" />;

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
