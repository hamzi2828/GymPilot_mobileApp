// Who is signed in, which gym they belong to, and what that gym looks like.
//
// All three arrive together from one sign-in call and are kept together: a
// token without its gym slug is useless, and the branding is what stops the
// app looking like a generic app the moment it opens.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, login as loginRequest, type Session } from "./api";
import { getItem, removeItem, setItem } from "./storage";
import { paletteFrom, type Palette } from "./theme";
import type { Branding, Member } from "./types";

const KEY = "gympilot.session";

interface Stored {
  token: string;
  gymSlug: string;
  gymName: string;
  user: Member;
  branding: Branding | null;
}

interface SessionValue {
  /** null while the stored session is still being read. */
  ready: boolean;
  session: Session | null;
  user: Member | null;
  gymName: string;
  branding: Branding | null;
  palette: Palette;
  signIn: (username: string, password: string) => Promise<{ requires2fa?: boolean; message?: string }>;
  signOut: () => Promise<void>;
  /** Re-read the member and the gym's branding, e.g. after a colour change. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<Stored | null>(null);

  useEffect(() => {
    let cancelled = false;
    getItem(KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          setStored(JSON.parse(raw) as Stored);
        } catch {
          /* a corrupt session is no session */
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: Stored | null) => {
    setStored(next);
    if (next) await setItem(KEY, JSON.stringify(next));
    else await removeItem(KEY);
  }, []);

  const signOut = useCallback(async () => {
    await persist(null);
  }, [persist]);

  const signIn = useCallback<SessionValue["signIn"]>(
    async (username, password) => {
      const result = await loginRequest(username, password);
      if (result.requires2fa) {
        return { requires2fa: true, message: result.message };
      }
      if (!result.token || !result.user || !result.gym) {
        throw new Error(result.message || "Could not sign you in.");
      }
      await persist({
        token: result.token,
        gymSlug: result.gym.slug,
        gymName: result.gym.name,
        user: result.user,
        branding: result.branding || null,
      });
      return {};
    },
    [persist]
  );

  const session = useMemo<Session | null>(
    () => (stored ? { token: stored.token, gymSlug: stored.gymSlug } : null),
    [stored]
  );

  const refresh = useCallback(async () => {
    if (!stored) return;
    try {
      const res = await api<{ success: boolean; data: Branding }>(`/api/mobile/branding?gym=${encodeURIComponent(stored.gymSlug)}`);
      if (res.data) await persist({ ...stored, branding: res.data, gymName: res.data.gym?.name || stored.gymName });
    } catch {
      // Keep the colours we have: a member on a train should still see their
      // gym's app rather than a default one.
    }
  }, [stored, persist]);

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      session,
      user: stored?.user || null,
      gymName: stored?.gymName || "",
      branding: stored?.branding || null,
      palette: paletteFrom(stored?.branding?.themeTokens),
      signIn,
      signOut,
      refresh,
    }),
    [ready, session, stored, signIn, signOut, refresh]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

/** The palette on its own, which is what most components actually want. */
export function usePalette(): Palette {
  return useSession().palette;
}
