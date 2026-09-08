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

// Kept as two records rather than one. Secure Store is a keychain, not a
// database: Android warns above 2048 bytes per value and can refuse to write
// one. The token and its gym are tiny and must survive; the member and the
// gym's branding are larger, and if they are ever lost the app simply asks
// the API for them again.
const AUTH_KEY = "gympilot.auth";
const LOOK_KEY = "gympilot.gym";

interface Stored {
  token: string;
  gymSlug: string;
  gymName: string;
  user: Member | null;
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
    Promise.all([getItem(AUTH_KEY), getItem(LOOK_KEY)])
      .then(([authRaw, lookRaw]) => {
        if (cancelled || !authRaw) return;
        try {
          const auth = JSON.parse(authRaw) as Pick<Stored, "token" | "gymSlug" | "gymName">;
          if (!auth.token || !auth.gymSlug) return;
          // The second half is a convenience: without it the member is still
          // signed in, and the next refresh puts their gym's colours back.
          let look: Partial<Stored> = {};
          try {
            look = lookRaw ? (JSON.parse(lookRaw) as Partial<Stored>) : {};
          } catch {
            /* keep the session, lose the decoration */
          }
          setStored({
            token: auth.token,
            gymSlug: auth.gymSlug,
            gymName: auth.gymName || "",
            user: look.user || null,
            branding: look.branding || null,
          });
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
    if (!next) {
      await Promise.all([removeItem(AUTH_KEY), removeItem(LOOK_KEY)]);
      return;
    }
    await Promise.all([
      setItem(AUTH_KEY, JSON.stringify({ token: next.token, gymSlug: next.gymSlug, gymName: next.gymName })),
      setItem(LOOK_KEY, JSON.stringify({ user: next.user, branding: next.branding })),
    ]);
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
