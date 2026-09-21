// Every screen sits on the gym's own background, inside the safe area, and
// pulls to refresh.

import React, { useState } from "react";
import { Image, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette, useSession } from "@/lib/session";
import { space } from "@/lib/theme";
import { Caption, Title } from "./ui";

export function Screen({
  children,
  title,
  subtitle,
  refreshing,
  onRefresh,
  scroll = true,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();

  const header =
    title || subtitle ? (
      <View style={{ marginBottom: space.xl }}>
        {title ? <Title>{title}</Title> : null}
        {subtitle ? <Caption style={{ marginTop: 4, fontSize: 14 }}>{subtitle}</Caption> : null}
      </View>
    ) : null;

  const padding = {
    paddingTop: insets.top + space.lg,
    paddingBottom: insets.bottom + space.xxl,
    paddingHorizontal: space.lg,
  };

  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: p.base, ...padding }}>
        {header}
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.base }}
      contentContainerStyle={padding}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={p.accent} colors={[p.accent]} /> : undefined
      }
    >
      {header}
      {children}
    </ScrollView>
  );
}

/**
 * The gym's logo if it has one, its name if it does not -- and its name
 * again if the logo will not load, rather than a blank where a logo should
 * be. A logo that fails once (the gym's site is down, the path is stale)
 * stays swapped out until the screen is next mounted.
 */
export function GymMark({ size = 34 }: { size?: number }) {
  const { branding, gymName } = useSession();
  const p = usePalette();
  const logo = branding?.logoUrl;
  const [broken, setBroken] = useState(false);

  if (logo && !broken) {
    const width = branding?.logoWidth || 160;
    const height = branding?.logoHeight || 56;
    const scaled = Math.min(size / height, 1) * 1.6;
    return (
      <Image
        source={{ uri: logo }}
        resizeMode="contain"
        style={{ width: width * scaled, height: size }}
        accessibilityLabel={gymName}
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <View style={{ width: size, height: size, borderRadius: size / 3, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" }}>
        <Title style={{ color: p.onAccent, fontSize: size * 0.5 }}>{(gymName || "G").charAt(0)}</Title>
      </View>
    </View>
  );
}
