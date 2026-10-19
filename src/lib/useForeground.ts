// Coming back to the app after being away from it: the member switched to
// another app or locked the phone -- or, on Android, changed their card in
// the browser, which leaves the app the same way. Whatever was on screen may
// be out of date by then.
//
// Only the screen in view listens, so coming back refreshes what the member
// is looking at, not every tab behind it (those catch up when they are next
// opened, as they always have). Only a real trip away counts: iOS also
// passes through "inactive" for the control centre or an incoming call
// banner, which is not leaving the app. And the phone can report the return
// more than once in quick succession, so it is acted on once, a moment after
// it settles.

import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

/** How long the app has to stay in the foreground before it counts as back. */
const SETTLE_MS = 400;

export function useOnForeground(onForeground: () => void) {
  // The latest callback, so the listener need not be put up again every
  // time the screen draws.
  const latest = useRef(onForeground);
  useEffect(() => {
    latest.current = onForeground;
  });

  useFocusEffect(
    useCallback(() => {
      let away = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const stop = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "background") {
          away = true;
          stop();
        } else if (state === "active" && away) {
          away = false;
          stop();
          timer = setTimeout(() => {
            timer = null;
            latest.current();
          }, SETTLE_MS);
        }
      });
      return () => {
        subscription.remove();
        stop();
      };
    }, [])
  );
}
