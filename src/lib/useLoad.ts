// Fetch something for the signed-in member: loading, error, pull to refresh,
// and a reload when the screen comes back into focus. Every screen needs the
// same four things, so none of them writes it out again.
//
// The fetch hangs off focus rather than off mount. Focus fires on the first
// mount too, so that is one code path instead of two -- and one request on
// open instead of the two a separate mount effect would send.

import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api, ApiError } from "./api";
import { useSession } from "./session";

export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const { session, signOut } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Whatever the caller says the query depends on, as one value: a dependency
  // array has to be a literal, so the list cannot be spread into it.
  const depKey = JSON.stringify(deps);
  // First time round the member sees a spinner; after that the screen already
  // has something on it, so a refresh happens quietly underneath.
  const loadedOnce = useRef(false);

  const run = useCallback(
    async (isRefresh = false) => {
      if (!path || !session) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        setData(await api<T>(path, { session, onUnauthorised: signOut }));
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        loadedOnce.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, session, signOut, depKey]
  );

  // Opening the screen loads it; coming back from booking a class shows the
  // class booked; changing what the query depends on re-runs it.
  useFocusEffect(
    useCallback(() => {
      run(loadedOnce.current);
    }, [run])
  );

  return { data, error, loading, refreshing, reload: () => run(true) };
}
