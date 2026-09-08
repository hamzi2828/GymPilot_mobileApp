// The code the member holds up at the front desk.
//
// The server issues a signed token tied to this gym and this member, good for
// two days, and hands out a new one every time it is asked -- so a code
// quietly rotates rather than being a permanent key to the door. The screen
// asks for one each time it opens, and swaps in a fresh one if it is ever
// left open long enough for this one to run out.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { GymMark, Screen } from "@/components/Screen";
import { Body, Button, Caption, Card, Loading, Notice, Title } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { timeLeft } from "@/lib/format";
import { usePalette, useSession } from "@/lib/session";
import { radius, space } from "@/lib/theme";
import type { CheckInCode } from "@/lib/types";

/** Swap in a new code once this one has under a minute left. */
const REFRESH_UNDER_MS = 60_000;
/** How often to look; the code lives for days, so this is not a countdown. */
const CHECK_EVERY_MS = 30_000;

export default function CheckIn() {
  const { session, signOut, gymName } = useSession();
  const p = usePalette();
  const router = useRouter();

  const [code, setCode] = useState<CheckInCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [validFor, setValidFor] = useState("");
  const fetching = useRef(false);

  const load = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const res = await api<{ data: CheckInCode }>("/api/attendance/me/qr", { session, onUnauthorised: signOut });
      setCode(res.data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Could not get your check-in code.");
    } finally {
      setLoading(false);
      fetching.current = false;
    }
  }, [session, signOut]);

  // On focus rather than on mount: a member who backs out and comes straight
  // back gets a live code, not the expired one they left behind.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // One ticker, doing both jobs: what the member is told, and asking for a
  // new code before this one dies under them.
  useEffect(() => {
    if (!code?.expires_at) return;
    const tick = () => {
      setValidFor(timeLeft(code.expires_at));
      if (new Date(code.expires_at).getTime() - Date.now() <= REFRESH_UNDER_MS) load();
    };
    tick();
    const timer = setInterval(tick, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [code, load]);

  const expired = !validFor;

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.xl }}>
        <View style={{ flex: 1 }}>
          <Caption>{gymName}</Caption>
          <Title style={{ marginTop: 2 }}>Check in</Title>
        </View>
        <GymMark />
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {loading && !code ? (
        <Loading label="Getting your code" />
      ) : !code ? (
        <Button label="Try again" onPress={load} />
      ) : (
        <>
          {/* White plate on purpose: a scanner reads a QR far better off white
              than off the gym's dark background. */}
          <Card style={{ alignItems: "center", paddingVertical: space.xl }}>
            <View style={{ backgroundColor: "#ffffff", padding: space.lg, borderRadius: radius.lg, opacity: expired ? 0.25 : 1 }}>
              <QRCode value={code.token} size={220} backgroundColor="#ffffff" color="#000000" />
            </View>

            <Title style={{ marginTop: space.xl, fontSize: 22 }}>{code.name}</Title>
            <Caption style={{ marginTop: 4, fontSize: 14 }}>
              {code.person_type === "staff" ? "Staff" : "Member"} · {code.code}
            </Caption>

            <View
              style={{
                marginTop: space.lg,
                backgroundColor: expired ? "rgba(248,113,113,0.15)" : p.cardRaised,
                borderRadius: radius.pill,
                paddingHorizontal: space.lg,
                paddingVertical: 8,
              }}
            >
              <Body style={{ color: expired ? p.danger : p.textMuted, fontSize: 13, fontWeight: "600" }}>
                {expired ? "Getting a new code…" : `Works for the next ${validFor}`}
              </Body>
            </View>
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
