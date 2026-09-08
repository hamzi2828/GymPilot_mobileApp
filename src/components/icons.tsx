// Four line icons for the tab bar, drawn rather than installed: a whole icon
// pack for four glyphs is weight the member downloads for nothing.

import React from "react";
import type { ColorValue } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

// The tab bar hands its icons a ColorValue rather than a plain string, so the
// icons take one too and react-native-svg is given it as-is.
type Props = { color: ColorValue; size?: number };

const stroke = { strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

export function HomeIcon({ color, size = 24 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 10.5 12 3l9 7.5" stroke={color} {...stroke} />
      <Path d="M5.5 9.5V20h13V9.5" stroke={color} {...stroke} />
      <Path d="M9.5 20v-5.5h5V20" stroke={color} {...stroke} />
    </Svg>
  );
}

export function CalendarIcon({ color, size = 24 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={color} {...stroke} />
      <Path d="M3.5 10h17M8 3v4M16 3v4" stroke={color} {...stroke} />
    </Svg>
  );
}

export function CardIcon({ color, size = 24 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="2.5" y="5.5" width="19" height="13" rx="3" stroke={color} {...stroke} />
      <Path d="M2.5 10h19M6.5 14.5h4" stroke={color} {...stroke} />
    </Svg>
  );
}

export function PersonIcon({ color, size = 24 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="8" r="4" stroke={color} {...stroke} />
      <Path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" stroke={color} {...stroke} />
    </Svg>
  );
}

export function QrIcon({ color, size = 24 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke={color} {...stroke} />
      <Rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke={color} {...stroke} />
      <Rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke={color} {...stroke} />
      <Path d="M13.5 13.5h3v3h-3zM20.5 13.5v3M17.5 20.5h3M13.5 20.5h1" stroke={color} {...stroke} />
    </Svg>
  );
}
