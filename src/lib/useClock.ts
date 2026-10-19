// The time, for a screen that compares things with it: "is this class still
// to come", "was this receipt turned down in the last month".
//
// Read when the screen comes into view and again every minute while it is in
// view -- never while drawing, where one screen could say two different
// things from one draw to the next.

import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

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

  return now;
}
