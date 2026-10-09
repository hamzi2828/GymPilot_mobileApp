// Fetch something for the signed-in member: loading, error, pull to refresh,
// and a quiet reload when the screen comes back into focus. Every screen
// needs the same four things, so none of them writes it out again.
//
// The fetch hangs off focus rather than off mount. Focus fires on the first
// mount too, so that is one code path instead of two -- and one request on
// open instead of the two a separate mount effect would send.

import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api, ApiError, isGymClosed } from "./api";
import { useSession } from "./session";

export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const { session, signOut } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The server's name for what went wrong, and the status it came with, for
  // the few screens that treat one failure differently from the rest.
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Whatever the caller says the query depends on, as one value: a dependency
  // array has to be a literal, so the list cannot be spread into it.
  const depKey = JSON.stringify(deps);
  // First time round the member sees a spinner; after that the screen already
  // has something on it.
  const loadedOnce = useRef(false);
  // Which request is the latest. Answers come back in whatever order the
  // network likes: tap two month chips quickly and the first month's visits
  // can arrive after the second's. Only the latest request may touch the
  // screen; an older one is dropped when it lands.
  const latest = useRef(0);
  // The query the last request was for, so that coming back to a screen can
  // be told apart from asking it for something else.
  const asked = useRef<string | null>(null);
  const query = `${path}|${depKey}`;

  // Three ways to ask, and what the member sees while waiting:
  //   first  -- nothing on screen yet: the loading spinner
  //   pull   -- they pulled down, or asked for something else (another
  //             month): the pull-to-refresh spinner
  //   quiet  -- the screen came back into focus: nothing, the new data just
  //             replaces the old
  const run = useCallback(
    async (how: "first" | "pull" | "quiet") => {
      const mine = ++latest.current;
      if (!path || !session) {
        // Nothing to ask for -- and nothing to wait for either, so no spinner
        // is left running over an empty screen.
        setLoading(false);
        setRefreshing(false);
        return;
      }
      asked.current = query;
      if (how === "pull") setRefreshing(true);
      else if (how === "first") setLoading(true);
      try {
        const result = await api<T>(path, { session, onUnauthorised: signOut });
        if (mine !== latest.current) return;
        setData(result);
        setError(null);
        setErrorCode(null);
        setErrorStatus(null);
      } catch (e) {
        if (mine !== latest.current) return;
        setError(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong.");
        setErrorCode(e instanceof ApiError ? e.code || null : null);
        setErrorStatus(e instanceof ApiError ? e.status : null);
      } finally {
        // A newer request owns the spinners now, and will put them away.
        if (mine === latest.current) {
          loadedOnce.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, session, signOut, depKey]
  );

  // Opening the screen loads it; coming back from booking a class shows the
  // class booked, without a spinner; changing what the query depends on
  // re-runs it.
  useFocusEffect(
    useCallback(() => {
      run(!loadedOnce.current ? "first" : asked.current === query ? "quiet" : "pull");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run])
  );

  return {
    data,
    error,
    errorCode,
    errorStatus,
    /** The gym as a whole is closed to its members; see useGymClosed. */
    closed: isGymClosed(errorStatus, errorCode),
    loading,
    refreshing,
    reload: () => run("pull"),
  };
}

/**
 * "Your gym is closed to its members right now" -- suspended, its GymPilot
 * subscription lapsed, or the member app switched off for it. Every request
 * fails the same way then, so a screen shows one notice (<GymClosed />) in
 * place of an error under every section.
 *
 * Pass the screen's loads. `caught` is for the errors the screen's own
 * buttons get back: it returns true when it took one, and the screen then
 * shows the notice instead of the error. `clear` goes in pull-to-refresh, so
 * a gym that is open again gets its screen back.
 */
export function useGymClosed(...loads: { closed: boolean; error: string | null }[]) {
  const [fromAction, setFromAction] = useState<string | null>(null);
  const load = loads.find((l) => l.closed);
  const caught = useCallback((e: unknown) => {
    if (!(e instanceof ApiError) || !isGymClosed(e.status, e.code)) return false;
    setFromAction(e.message);
    return true;
  }, []);
  const clear = useCallback(() => setFromAction(null), []);
  return { message: (load && load.error) || fromAction, caught, clear };
}
