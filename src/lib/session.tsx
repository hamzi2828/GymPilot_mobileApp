// Who is signed in, which gym they belong to, and what that gym looks like.
//
// All three arrive together from one sign-in call and are kept together: a
// token without its gym slug is useless, and the branding is what stops the
// app looking like a generic app the moment it opens.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, login as loginRequest, loginTwoFactor as twoFactorRequest, type Session } from "./api";
import { registerForPush, unregisterPush } from "./push";
import { getItem, removeItem, setItem } from "./storage";
import { paletteFrom, type Palette } from "./theme";
import type { Branding, LoginResponse, Member } from "./types";

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

export interface SignInResult {
  /** The account signs in with an emailed code; finish with completeTwoFactor. */
  requires2fa?: boolean;
  challengeId?: string;
  gymSlug?: string;
  message?: string;
}

interface SessionValue {
  /** false while the stored session is still being read. */
  ready: boolean;
  session: Session | null;
  user: Member | null;
  gymName: string;
  branding: Branding | null;
  palette: Palette;
  /**
   * Why the last session ended, in the server's words, for the sign-in
   * screen to show. null after a sign-out the member asked for.
   */
  signOutReason: string | null;
  signIn: (username: string, password: string) => Promise<SignInResult>;
  completeTwoFactor: (challengeId: string, code: string, gymSlug: string) => Promise<void>;
  signOut: (reason?: string) => Promise<void>;
  /** Re-read the member and the gym's branding, e.g. after a colour change. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<Stored | null>(null);
  const [signOutReason, setSignOutReason] = useState<string | null>(null);

  // The latest session, readable from callbacks that must stay stable.
  const storedRef = useRef<Stored | null>(null);
  useEffect(() => {
    storedRef.current = stored;
  }, [stored]);

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

  const signOut = useCallback<SessionValue["signOut"]>(
    async (reason) => {
      // Take the phone off the gym's notification list first, while the
      // token is still to hand. Not awaited: a sign-out must not wait on
      // the network, and if the token is already dead this simply fails.
      const before = storedRef.current;
      if (before) void unregisterPush({ token: before.token, gymSlug: before.gymSlug });
      setSignOutReason(reason || null);
      await persist(null);
    },
    [persist]
  );

  // A successful sign-in, whichever route produced it.
  const adopt = useCallback(
    async (result: LoginResponse) => {
      if (!result.token || !result.user || !result.gym) {
        throw new Error(result.message || "Could not sign you in.");
      }
      setSignOutReason(null);
      await persist({
        token: result.token,
        gymSlug: result.gym.slug,
        gymName: result.gym.name,
        user: result.user,
        branding: result.branding || null,
      });
    },
    [persist]
  );

  const signIn = useCallback<SessionValue["signIn"]>(
    async (username, password) => {
      const result = await loginRequest(username, password);
      if (result.requires2fa) {
        return { requires2fa: true, challengeId: result.challengeId, gymSlug: result.gym?.slug, message: result.message };
      }
      await adopt(result);
      return {};
    },
    [adopt]
  );

  const completeTwoFactor = useCallback<SessionValue["completeTwoFactor"]>(
    async (challengeId, code, gymSlug) => {
      await adopt(await twoFactorRequest(challengeId, code, gymSlug));
    },
    [adopt]
  );

  // Only the token and the slug: a branding refresh must not look like a
  // new session to every screen holding this.
  const token = stored?.token ?? null;
  const gymSlug = stored?.gymSlug ?? null;
  const session = useMemo<Session | null>(() => (token && gymSlug ? { token, gymSlug } : null), [token, gymSlug]);

  // Once there is a session -- restored on launch, or just signed in -- tell
  // the gym how to reach this phone. Nothing to show if it cannot be done.
  useEffect(() => {
    if (!session) return;
    registerForPush(session).catch(() => {});
  }, [session]);

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
      signOutReason,
      signIn,
      completeTwoFactor,
      signOut,
      refresh,
    }),
    [ready, session, stored, signOutReason, signIn, completeTwoFactor, signOut, refresh]
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
