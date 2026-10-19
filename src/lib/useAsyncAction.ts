// What a button does while the work it started is under way: it goes grey,
// shows its spinner, and a second tap does nothing until the work has
// finished or failed.
//
// `busy` is state, so it only changes on the next draw. A quick second tap
// can land before then; the ref is what that tap meets, so the same request
// is never sent twice.

import { useCallback, useRef, useState } from "react";

export function useAsyncAction<K extends string = string>() {
  const running = useRef(false);
  // Which button is working, so that one shows the spinner. Every button
  // wired to the same hook waits while any of them is.
  const [busy, setBusy] = useState<K | null>(null);

  /**
   * Does `work` unless something here already is. With `confirm`, the "are
   * you sure?" comes first: taps are held off while it is up, but the button
   * only shows as working once the member has said yes.
   */
  const run = useCallback(async (key: K, work: () => Promise<unknown>, confirm?: () => Promise<boolean>): Promise<void> => {
    if (running.current) return;
    running.current = true;
    try {
      if (confirm && !(await confirm())) return;
      setBusy(key);
      await work();
    } finally {
      running.current = false;
      setBusy(null);
    }
  }, []);

  return { busy, run };
}
