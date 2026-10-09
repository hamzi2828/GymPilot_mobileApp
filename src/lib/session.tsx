// Who is signed in, which gym they belong to, and what that gym looks like.
//
// All three arrive together from one sign-in call and are kept together: a
// token without its gym slug is useless, and the branding is what stops the
// app looking like a generic app the moment it opens.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, login as loginRequest, loginTwoFactor as twoFactorRequest, type Session } from "./api";
import { clearSavedCode } from "./checkinCode";
import { registerForPush, unregisterPush } from "./push";
import { getItem, removeItem, setItem } from "./storage";
import { paletteFrom, type Palette } from "./theme";
import type { Branding, LoginResponse, Member, Profile } from "./types";

// Kept as three records rather than one. Secure Store is a keychain, not a
// database: Android warns above 2048 bytes per value and can refuse to write
// one. The token and its gym are tiny and must survive. The member is small;
// the gym's branding (opening hours, contact details) is the one that can
// outgrow a keychain entry -- so it lives on its own, and a write it fails
// cannot take the member's name down with it. Either is asked of the API
// again if it is ever lost.
const AUTH_KEY = "gympilot.auth";
const USER_KEY = "gympilot.user";
// Named for when it held the member too; still read that way from phones
// that stored it before the split.
const LOOK_KEY = "gympilot.gym";
// Where an earlier build kept everything in one record. Nothing reads it
// now; it is only deleted, so an old token does not sit in the keychain.
const LEGACY_KEY = "gympilot.session";

/** The member's own record, in the shape sign-in hands back. */
function memberFrom(p: Profile, before: Member | null): Member {
  return {
    id: String(p._id || before?.id || ""),
    username: p.username || before?.username || "",
    firstName: p.firstName || "",
    lastName: p.lastName || "",
    email: p.email || "",
    emailVerified: p.emailVerified !== false,
    phone: p.phone || "",
    role: p.role || before?.role || "",
    avatarUrl: p.avatarUrl || "",
    dateOfBirth: p.dateOfBirth || null,
    isStaff: p.employment ? !!p.employment.isStaff : !!before?.isStaff,
  };
}

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
  /** The member's record as the server just returned it, e.g. after a profile edit. */
  updateUser: (profile: Profile) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<Stored | null>(null);
  const [signOutReason, setSignOutReason] = useState<string | null>(null);

  // The current session, readable from callbacks that must stay stable. Set
  // in the same breath as the state (never a render later), so a request
  // that comes back after a sign-out can tell straight away that the
  // session it was made for is gone.
  const storedRef = useRef<Stored | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Once per launch; harmless when it is already gone.
    void removeItem(LEGACY_KEY);
    Promise.all([getItem(AUTH_KEY), getItem(USER_KEY), getItem(LOOK_KEY)])
      .then(([authRaw, userRaw, lookRaw]) => {
        if (cancelled) return;
        if (!authRaw) {
          // Nobody signed in. A phone whose last sign-out could not reach the
          // server is still on that gym's list; this takes it off.
          void unregisterPush();
          return;
        }
        // Somebody signed in while this was being read: theirs wins.
        if (storedRef.current) return;
        try {
          const auth = JSON.parse(authRaw) as Pick<Stored, "token" | "gymSlug" | "gymName">;
          if (!auth.token || !auth.gymSlug) return;
          // The other two are a convenience: without them the member is
          // still signed in, and the next refresh puts them back.
          const parse = <T,>(raw: string | null): T | null => {
            try {
              return raw ? (JSON.parse(raw) as T) : null;
            } catch {
              return null;
            }
          };
          const look = parse<{ user?: Member | null; branding?: Branding | null }>(lookRaw);
          const next: Stored = {
            token: auth.token,
            gymSlug: auth.gymSlug,
            gymName: auth.gymName || "",
            user: parse<Member>(userRaw) || look?.user || null,
            branding: look?.branding || null,
          };
          storedRef.current = next;
          setStored(next);
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

  // Storage writes run one after another, in the order they were asked
  // for, so a sign-out's removal can never be overtaken by a slower write
  // from just before it and leave the old member's token on the phone.
  const writes = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback((next: Stored | null) => {
    storedRef.current = next;
    setStored(next);
    // Each record on its own: one the keychain refuses (branding, when it
    // is too big) does not take the others with it.
    const write = async () => {
      if (!next) {
        await Promise.all([removeItem(AUTH_KEY), removeItem(USER_KEY), removeItem(LOOK_KEY)]);
        return;
      }
      await Promise.all([
        setItem(AUTH_KEY, JSON.stringify({ token: next.token, gymSlug: next.gymSlug, gymName: next.gymName })),
        setItem(USER_KEY, JSON.stringify(next.user)),
        setItem(LOOK_KEY, JSON.stringify({ branding: next.branding })),
      ]);
    };
    writes.current = writes.current.then(write, write);
    return writes.current;
  }, []);

  const signOut = useCallback<SessionValue["signOut"]>(
    async (reason) => {
      // Off the gym's notification list before anything else is cleared.
      // The removal names this phone's push token and the gym, not the
      // member's sign-in, so it works even when the server has already
      // ended the session. Not awaited: a sign-out must not wait on the
      // network, and one that cannot get through is retried later.
      void unregisterPush();
      setSignOutReason(reason || null);
      // The saved check-in code goes with the session: it is the member's
      // way through the door, and must not outlive their sign-in here.
      await Promise.all([persist(null), clearSavedCode()]);
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
    const at = storedRef.current;
    if (!at) return;
    // Either may fail on its own. Keep what we have for whichever does: a
    // member on a train should still see their gym's app, and their name.
    const [look, me] = await Promise.all([
      api<{ success: boolean; data: Branding }>(`/api/mobile/branding?gym=${encodeURIComponent(at.gymSlug)}`).catch(() => null),
      api<{ data: Profile }>("/userDetailForProfile", {
        session: { token: at.token, gymSlug: at.gymSlug },
        onUnauthorised: signOut,
      }).catch(() => null),
    ]);
    // Signed out -- or somebody else signed in -- while those were on their
    // way: what came back belongs to a session that no longer exists, and
    // writing it would put the old token back on the phone.
    const now = storedRef.current;
    if (!now || now.token !== at.token) return;
    if (!look?.data && !me?.data) return;
    await persist({
      ...now,
      branding: look?.data || now.branding,
      gymName: look?.data?.gym?.name || now.gymName,
      user: me?.data ? memberFrom(me.data, now.user) : now.user,
    });
  }, [persist, signOut]);

  const updateUser = useCallback<SessionValue["updateUser"]>(
    async (profile) => {
      const now = storedRef.current;
      if (!now) return;
      await persist({ ...now, user: memberFrom(profile, now.user) });
    },
    [persist]
  );

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
      updateUser,
    }),
    [ready, session, stored, signOutReason, signIn, completeTwoFactor, signOut, refresh, updateUser]
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
