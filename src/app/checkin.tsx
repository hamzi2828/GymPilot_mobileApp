// The code the member holds up at the front desk.
//
// The server issues a signed token tied to this gym and this member, good for
// two days, and hands out a new one every time it is asked -- so a code
// quietly rotates rather than being a permanent key to the door. The screen
// asks for one each time it opens, and swaps in a fresh one if it is ever
// left open long enough for this one to run out.
//
// The front door is where a phone has no signal, so the last code is also
// kept on the phone (lib/checkinCode): it is on screen at once while a newer
// one is fetched, and stays there, marked as saved, when the server cannot
// be reached. A code past its expiry is never shown, saved or not.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { GymMark, Screen } from "@/components/Screen";
import { Body, Button, Caption, Card, GymClosed, Loading, Notice, Title } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { clearSavedCode, codeOwner, saveCode, savedCode } from "@/lib/checkinCode";
import { timeLeft } from "@/lib/format";
import { usePalette, useSession } from "@/lib/session";
import { radius, space } from "@/lib/theme";
import { useGymClosed } from "@/lib/useLoad";
import { useRequireSession } from "@/lib/useRequireSession";
import type { CheckInCode } from "@/lib/types";

/** Swap in a new code once this one has under a minute left. */
const REFRESH_UNDER_MS = 60_000;
/** How often to look; the code lives for days, so this is not a countdown. */
const CHECK_EVERY_MS = 30_000;

export default function CheckIn() {
  const { session } = useRequireSession();
  const { signOut, gymName, user } = useSession();
  const p = usePalette();
  const router = useRouter();

  const [code, setCode] = useState<CheckInCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [validFor, setValidFor] = useState("");
  // The code on screen is the saved one, and a newer one could not be fetched.
  const [offline, setOffline] = useState(false);
  const fetching = useRef(false);
  const closed = useGymClosed();
  const { caught, clear } = closed;

  // Whose code this is. Read through a ref after every wait, so an answer
  // that lands after a sign-out is not shown, and not saved for the next
  // person to pick this phone up.
  const owner = codeOwner(session?.gymSlug, user?.id);
  const ownerNow = useRef(owner);
  useEffect(() => {
    ownerNow.current = owner;
  }, [owner]);

  const show = useCallback((next: CheckInCode) => {
    setCode(next);
    setValidFor(timeLeft(next.expires_at));
  }, []);

  // Off the screen and off the phone.
  const drop = useCallback(() => {
    setCode(null);
    setValidFor("");
    void clearSavedCode();
  }, []);

  const load = useCallback(async () => {
    // Signed out under us: nothing to ask for, and the screen is on its way
    // to the sign-in page anyway.
    if (!session || fetching.current) return;
    fetching.current = true;
    try {
      const res = await api<{ data: CheckInCode }>("/api/attendance/me/qr", { session, onUnauthorised: signOut });
      if (ownerNow.current !== owner) return;
      show(res.data);
      setOffline(false);
      setError(null);
      clear();
      void saveCode(owner, res.data);
    } catch (e) {
      if (ownerNow.current !== owner) return;
      // A gym closed to its members gets the one notice, and no code.
      if (caught(e)) {
        drop();
        return;
      }
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Could not get your check-in code.");
      // The server answered, and the answer was no: the saved code goes too.
      // No answer at all, or a server having a bad moment, is exactly what
      // the saved code is for.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) drop();
      else setOffline(true);
    } finally {
      setLoading(false);
      fetching.current = false;
    }
  }, [session, signOut, caught, clear, owner, show, drop]);

  // On focus rather than on mount: a member who backs out and comes straight
  // back gets a live code, not the expired one they left behind. The saved
  // code goes up first -- reading the phone is quicker than asking the
  // server -- unless the server has somehow answered already.
  useFocusEffect(
    useCallback(() => {
      let left = false;
      savedCode(owner).then((saved) => {
        if (left || !saved || ownerNow.current !== owner) return;
        setCode((now) => now ?? saved);
        setValidFor((now) => now || timeLeft(saved.expires_at));
      });
      load();
      return () => {
        left = true;
      };
    }, [load, owner])
  );

  // One ticker, doing both jobs: what the member is told, and asking for a
  // new code before this one dies under them. It stops with the session:
  // a phone that has been signed out must not keep asking for codes.
  useEffect(() => {
    if (!session || !code?.expires_at) return;
    const tick = () => {
      const left = new Date(code.expires_at).getTime() - Date.now();
      // Run out, with no newer one to be had: it comes off the screen. A
      // code the desk would refuse is worse than no code.
      if (!(left > 0)) {
        drop();
        setLoading(true);
        load();
        return;
      }
      setValidFor(timeLeft(code.expires_at));
      if (left <= REFRESH_UNDER_MS) load();
    };
    tick();
    const timer = setInterval(tick, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [code, load, drop, session]);

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.xl }}>
        <View style={{ flex: 1 }}>
          <Caption>{gymName}</Caption>
          <Title style={{ marginTop: 2 }}>Check in</Title>
        </View>
        <GymMark />
      </View>

      {/* With the saved code on screen, "cannot reach your gym" is said as a
          small note under it rather than as a failure above it. */}
      {closed.message ? <GymClosed message={closed.message} /> : error && !(code && offline) ? <Notice tone="error">{error}</Notice> : null}

      {closed.message ? null : loading && !code ? (
        <Loading label="Getting your code" />
      ) : !code ? (
        <Button label="Try again" onPress={load} />
      ) : (
        <>
          {/* White plate on purpose: a scanner reads a QR far better off white
              than off the gym's dark background. */}
          <Card style={{ alignItems: "center", paddingVertical: space.xl }}>
            <View style={{ backgroundColor: "#ffffff", padding: space.lg, borderRadius: radius.lg }}>
              <QRCode value={code.token} size={220} backgroundColor="#ffffff" color="#000000" />
            </View>

            <Title style={{ marginTop: space.xl, fontSize: 22 }}>{code.name}</Title>
            <Caption style={{ marginTop: 4, fontSize: 14 }}>
              {code.person_type === "staff" ? "Staff" : "Member"} · {code.code}
            </Caption>

            {validFor ? (
              <View
                style={{
                  marginTop: space.lg,
                  backgroundColor: p.cardRaised,
                  borderRadius: radius.pill,
                  paddingHorizontal: space.lg,
                  paddingVertical: 8,
                }}
              >
                <Body style={{ color: p.textMuted, fontSize: 13, fontWeight: "600" }}>Works for the next {validFor}</Body>
              </View>
            ) : null}
            {offline ? (
              <Caption style={{ marginTop: space.md, textAlign: "center" }}>
                Saved code. Your phone cannot reach the gym right now, but the desk can still scan this.
              </Caption>
            ) : null}
          </Card>

          {/* The desk can type this in if the scanner is having a bad day. */}
          <Card style={{ marginTop: space.lg, alignItems: "center" }}>
            <Caption>If the scanner will not read it, give the desk this number</Caption>
            <Title style={{ marginTop: 6, fontSize: 30, letterSpacing: 4 }}>{code.code}</Title>
          </Card>

          <Pressable onPress={load} style={{ marginTop: space.lg, alignItems: "center" }} hitSlop={10}>
            <Body style={{ color: p.accent, fontWeight: "700", fontSize: 14 }}>Get a new code</Body>
          </Pressable>
        </>
      )}

      <Button label="Done" variant="secondary" onPress={() => router.back()} style={{ marginTop: space.xl }} />
    </Screen>
  );
}
