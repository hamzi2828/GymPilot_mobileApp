// The few pieces every screen is built from, all painted in the gym's
// colours rather than the app's.

import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { usePalette } from "@/lib/session";
import { radius, space } from "@/lib/theme";

export function Title({ children, style }: { children: React.ReactNode; style?: object }) {
  const p = usePalette();
  return <Text style={[{ color: p.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 }, style]}>{children}</Text>;
}

export function Heading({ children }: { children: React.ReactNode }) {
  const p = usePalette();
  return <Text style={{ color: p.text, fontSize: 17, fontWeight: "700", marginBottom: space.md }}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  const p = usePalette();
  return <Text style={[{ color: muted ? p.textMuted : p.text, fontSize: 15, lineHeight: 22 }, style]}>{children}</Text>;
}

export function Caption({ children, style }: { children: React.ReactNode; style?: object }) {
  const p = usePalette();
  return <Text style={[{ color: p.textFaint, fontSize: 12.5, lineHeight: 18 }, style]}>{children}</Text>;
}

export function Card({ children, style, tone }: { children: React.ReactNode; style?: ViewStyle; tone?: "accent" }) {
  const p = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: tone === "accent" ? p.accent : p.card,
          borderRadius: radius.lg,
          borderWidth: tone === "accent" ? 0 : 1,
          borderColor: p.border,
          padding: space.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const p = usePalette();
  const background = variant === "primary" ? p.accent : variant === "quiet" ? "transparent" : p.cardRaised;
  const colour = variant === "primary" ? p.onAccent : variant === "danger" ? p.danger : p.text;
  const off = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          backgroundColor: background,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
          borderRadius: radius.pill,
          paddingVertical: 14,
          paddingHorizontal: space.xl,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: variant === "secondary" || variant === "danger" ? 1 : 0,
          borderColor: variant === "danger" ? "rgba(248,113,113,0.4)" : p.border,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={colour} /> : <Text style={{ color: colour, fontWeight: "700", fontSize: 15 }}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: { label: string; hint?: string } & TextInputProps) {
  const p = usePalette();
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={{ color: p.textMuted, fontSize: 13, fontWeight: "600", marginBottom: 6 }}>{label}</Text>
      <TextInput
        placeholderTextColor={p.textFaint}
        {...props}
        style={[
          {
            backgroundColor: p.cardRaised,
            borderWidth: 1,
            borderColor: p.border,
            borderRadius: radius.md,
            paddingHorizontal: space.lg,
            paddingVertical: 14,
            color: p.text,
            fontSize: 16,
          },
          props.style,
        ]}
      />
      {hint ? <Caption style={{ marginTop: 6 }}>{hint}</Caption> : null}
    </View>
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "good" | "warn" | "bad" | "accent" }) {
  const p = usePalette();
  const colours: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: p.cardRaised, fg: p.textMuted },
    good: { bg: "rgba(52,211,153,0.15)", fg: p.success },
    warn: { bg: "rgba(251,191,36,0.15)", fg: p.warning },
    bad: { bg: "rgba(248,113,113,0.15)", fg: p.danger },
    accent: { bg: p.accent, fg: p.onAccent },
  };
  const c = colours[tone] || colours.neutral;
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={{ color: c.fg, fontSize: 11.5, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

export function Stat({ value, label }: { value: string | number; label: string }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: p.text, fontSize: 22, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: p.textFaint, fontSize: 12, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const p = usePalette();
  return (
    <View style={{ paddingVertical: 60, alignItems: "center", gap: space.md }}>
      <ActivityIndicator color={p.accent} />
      {label ? <Caption>{label}</Caption> : null}
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  const p = usePalette();
  return (
    <View style={{ paddingVertical: 44, paddingHorizontal: space.lg, alignItems: "center", borderRadius: radius.lg, borderWidth: 1, borderColor: p.border, borderStyle: "dashed" }}>
      <Text style={{ color: p.text, fontWeight: "700", fontSize: 15, textAlign: "center" }}>{title}</Text>
      {hint ? <Caption style={{ marginTop: 6, textAlign: "center" }}>{hint}</Caption> : null}
    </View>
  );
}

export function Notice({ tone, children }: { tone: "error" | "ok" | "warn"; children: React.ReactNode }) {
  const p = usePalette();
  const colour = tone === "error" ? p.danger : tone === "warn" ? p.warning : p.success;
  return (
    <View style={{ backgroundColor: `${colour}22`, borderRadius: radius.md, padding: space.md, marginBottom: space.lg }}>
      <Text style={{ color: colour, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Divider() {
  const p = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border, marginVertical: space.md }} />;
}

/** A label on the left, a value on the right — the shape of every detail row. */
export function Line({ label, value }: { label: string; value: React.ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, gap: space.lg }}>
      <Text style={{ color: p.textMuted, fontSize: 14 }}>{label}</Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text style={{ color: p.text, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" }}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}
