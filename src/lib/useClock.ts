// The time, for a screen that compares things with it: "is this class still
// to come", "was this receipt turned down in the last month".
//
// Read when the screen comes into view, again every minute while it is in
// view, and again the moment the app comes back from the background (a
// phone's timers stop while it is away) -- never while drawing, where one
// screen could say two different things from one draw to the next.

import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useOnForeground } from "./useForeground";

/** How often a screen in view reads the clock again. */
const EVERY_MS = 60_000;

export function useClock(): number {
  const [now, setNow] = useState(() => Date.now());

  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      const timer = setInterval(() => setNow(Date.now()), EVERY_MS);
      return () => clearInterval(timer);
    }, [])
  );
  useOnForeground(() => setNow(Date.now()));

  return now;
}
