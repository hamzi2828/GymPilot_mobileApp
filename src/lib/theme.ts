// The gym's colours, turned into everything the app needs to paint itself.
//
// The server sends six tokens, chosen by the gym under Settings → Colour
// Scheme. Every scheme is dark-based, so the rest of the palette is derived
// from them rather than sent: white text on the gym's own background, and
// borders and muted text as washes of it.

import type { ThemeTokens } from "./types";

export const DEFAULT_TOKENS: ThemeTokens = {
  accent: "#bee304",
  accentDark: "#6c8704",
  accentSoft: "#e8f7a0",
  onAccent: "#0a0a0a",
  base: "#000000",
  surface: "#141414",
};

export interface Palette extends ThemeTokens {
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  card: string;
  cardRaised: string;
  danger: string;
  warning: string;
  success: string;
}

export function paletteFrom(tokens: ThemeTokens | undefined | null): Palette {
  const t = tokens && tokens.accent ? tokens : DEFAULT_TOKENS;
  return {
    ...t,
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.66)",
    textFaint: "rgba(255,255,255,0.42)",
    border: "rgba(255,255,255,0.10)",
    card: t.surface,
    cardRaised: "rgba(255,255,255,0.06)",
    danger: "#f87171",
    warning: "#fbbf24",
    success: "#34d399",
  };
}

/** Shared spacing and radii, so screens do not each invent their own. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };
