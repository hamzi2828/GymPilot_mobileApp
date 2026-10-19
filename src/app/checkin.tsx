// Checking in: the member points the camera at the code on the screen at the
// gym's front desk, and their own phone checks them in (or out).
//
// The desk's screen shows a QR code that changes every minute (lib/deskCode).
// The phone sends what it read with the member's own sign-in, so the server
// knows who it is and -- from the desk the code belongs to -- where. Only the
// text inside the QR code leaves the phone, never a picture.
//
// The camera is asked for only once the member has been told why and taps to
// allow it. A member who said no is shown how to switch it on again, and that
// the desk can check them in another way.
//
// One scan is one attempt with its own request_id. When the answer is lost on
// the way back -- no signal at the door -- Try again sends the same attempt
// with the same id, and the server answers it again instead of taking it for
// a second scan, which a minute later would be the way out.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, AppState, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useRouter } from "expo-router";
import { GymMark, Screen } from "@/components/Screen";
import { Body, Button, Caption, Card, GymClosed, Heading, Loading, Notice, Title } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { NOT_CONFIGURED_MESSAGE } from "@/lib/config";
import { newRequestId, readDeskCode } from "@/lib/deskCode";
import { openPhoneSettings } from "@/lib/open";
import { usePalette, useSession } from "@/lib/session";
import { radius, space } from "@/lib/theme";
import { useGymClosed } from "@/lib/useLoad";
import { useRequireSession } from "@/lib/useRequireSession";
import type { CheckInAnswer } from "@/lib/types";

/** The palette has no blue; a check-out is neither good news nor bad, so it gets one of its own. */
const CHECKED_OUT = "#60a5fa";

/** The widest the viewfinder gets, so a big phone held close is not all camera. */
const MAX_VIEWFINDER = 420;

const WRONG_CODE = "That isn't your gym's check-in code.";

interface Outcome {
  tone: "in" | "out" | "ignored" | "refused";
  title: string;
  text: string;
  /** From the desk's receipt: money still owed on the membership. */
  note?: string | null;
  /** The attempt may never have reached the gym, so sending it again is worth it. */
  retry?: boolean;
}

type Phase =
  | { kind: "scanning" }
  // `before` is the answer still on screen while the same attempt is tried again.
  | { kind: "sending"; code: string; requestId: string; before?: Outcome }
  | { kind: "done"; code: string; requestId: string; outcome: Outcome };

/** What the server said, as the card on screen. */
function outcomeOf(answer: CheckInAnswer): Outcome {
  const d = answer.detail;
  // Money still owed is never a reason to turn a member away, always one to say so.
  const owed = d?.balance_due_label ? `${d.balance_due_label} — pay at the front desk.` : null;
  if (answer.success && d?.action === "check_out") {
    const time = d.check_out_time ? `At ${d.check_out_time}${d.worked_label ? `, after ${d.worked_label}` : ""}. ` : "";
    return { tone: "out", title: "Checked out", text: `${time}See you next time.`, note: owed };
  }
  if (answer.success) {
    const time = d?.check_in_time ? `At ${d.check_in_time}. ` : "";
    return { tone: "in", title: "Checked in", text: `${time}Have a good session.`, note: owed };
  }
  // A second scan within the minute: the gym already has the first one.
  if (answer.ignored) {
    return {
      tone: "ignored",
      title: (answer.message || "Already checked in a moment ago").replace(/\.$/, ""),
      text: "Your gym already has it, so there is nothing more to do.",
    };
  }
  // Turned away under the gym's rules (no membership, expired, unpaid), or
  // anything else the server would not record: its reason, as it gave it.
  return {
    tone: "refused",
    title: "Not checked in",
    text: `${answer.message || "Your gym did not record this check-in."} Please speak to the front desk.`,
  };
}

/** A check-in the server never answered, or answered with an error. */
function problemOf(e: unknown): Outcome {
  const failed = (text: string, retry = false): Outcome => ({ tone: "refused", title: "Not checked in", text, retry });
  if (!(e instanceof ApiError)) return failed("Something went wrong on this phone. Scan the code again.");

  switch (e.code) {
    case "CODE_EXPIRED":
      return failed("That code has changed. Scan the screen again.");
    case "CODE_INVALID":
      return failed(`${WRONG_CODE} Scan the code on the screen at the front desk.`);
    case "DESK_SIGNED_OUT":
      return failed("The check-in screen is signed out. Ask at the front desk.");
    case "CHECKIN_PAUSED":
      // The server's words say how many seconds to wait.
      return failed(e.message || "Too many check-ins in a short time. Wait a minute, then scan again.");
  }

  if (e.status === 0) {
    if (e.message === NOT_CONFIGURED_MESSAGE) return failed(e.message);
    // The check-in may have reached the gym and only the answer been lost,
    // so this does not say "you are not checked in" -- and sending it again
    // is safe, which the member is told.
    return {
      tone: "refused",
      title: "Could not reach your gym",
      text: "Your phone has no connection to the gym right now, so this may not have gone through. Check your signal or wifi, then try again. It will not count twice.",
      retry: true,
    };
  }
  // A server from before scanning existed.
  if (e.status === 404) return failed("Scanning to check in is not switched on at your gym yet. Ask at the front desk to check you in.");
  if (e.status >= 500 || e.status === 408) {
    return failed("Something went wrong at your gym's end. Try again in a moment. It will not count twice.", true);
  }
  return failed(e.message);
}

export default function CheckIn() {
  const { session } = useRequireSession();
  const { signOut, gymName } = useSession();
  const p = usePalette();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const closed = useGymClosed();
  const { caught, clear } = closed;

  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [asking, setAsking] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });
  // A QR code that is not a desk code is in front of the camera.
  const [wrongCode, setWrongCode] = useState(false);
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  // Bumped to start the camera afresh after it failed to start.
  const [cameraKey, setCameraKey] = useState(0);
  // The camera reports the same code many times a second, faster than the
  // screen can re-render to stop listening: this takes the first one only.
  const reading = useRef(false);

  // Coming back from the phone's settings with the camera switched on: pick
  // that up without making the member close the screen and open it again.
  const granted = !!permission?.granted;
  useEffect(() => {
    if (granted) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") getPermission().catch(() => {});
    });
    return () => subscription.remove();
  }, [granted, getPermission]);

  const ask = async () => {
    if (asking) return;
    setAsking(true);
    try {
      await requestPermission();
    } catch {
      /* the hook is left saying not granted, which the screen already explains */
    } finally {
      setAsking(false);
    }
  };

  const send = useCallback(
    async (code: string, requestId: string, before?: Outcome) => {
      if (!session) return;
      setPhase({ kind: "sending", code, requestId, before });
      let outcome: Outcome;
      try {
        const answer = await api<CheckInAnswer>("/api/attendance/me/checkin", {
          method: "POST",
          body: { code, request_id: requestId },
          session,
          onUnauthorised: signOut,
        });
        outcome = outcomeOf(answer);
      } catch (e) {
        // A gym closed to its members: the one notice, in place of the screen.
        if (caught(e)) {
          reading.current = false;
          setPhase({ kind: "scanning" });
          return;
        }
        outcome = problemOf(e);
      }
      setPhase({ kind: "done", code, requestId, outcome });
      // Said out loud too: the card replaces the camera, and a screen reader
      // would otherwise stay silent about whether the member got in.
      AccessibilityInfo.announceForAccessibility(`${outcome.title}. ${outcome.text}`);
    },
    [session, signOut, caught]
  );

  const onScan = useCallback(
    (scan: BarcodeScanningResult) => {
      if (reading.current) return;
      const code = readDeskCode(scan.data);
      if (!code) {
        setWrongCode(true);
        return;
      }
      reading.current = true;
      setWrongCode(false);
      void send(code, newRequestId());
    },
    [send]
  );

  // The same attempt, with the same id: see the top of the file.
  const retry = () => {
    if (phase.kind === "done") void send(phase.code, phase.requestId, phase.outcome);
  };

  const scanAgain = () => {
    reading.current = false;
    setWrongCode(false);
    setPhase({ kind: "scanning" });
  };

  // What the gym-closed notice tells the member to do once it is sorted out.
  const refresh = () => {
    clear();
    scanAgain();
  };

  const restartCamera = () => {
    setCameraProblem(null);
    setCameraKey((k) => k + 1);
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)"));

  const size = Math.min(width - space.lg * 2, MAX_VIEWFINDER);

  const body = () => {
    if (closed.message) return <GymClosed message={closed.message} />;
    if (!permission) return <Loading label="Getting the camera ready" />;

    // Not allowed yet. Before the phone's own question, and in place of it
    // once the member has said no.
    if (!permission.granted) {
      const askedBefore = permission.status === "denied";
      return (
        <Card>
          <Heading>{askedBefore ? "The camera is off for GymsPilotPro" : "Scan the code at the front desk"}</Heading>
          <Body muted>
            To check in, point your camera at the code on the screen at your gym&apos;s front desk. GymsPilotPro uses the camera only on this screen, only to
            read that code, and keeps no pictures.
          </Body>
          {askedBefore && !permission.canAskAgain ? (
            <>
              <Body muted style={{ marginTop: space.md }}>
                Your phone will not ask again, so switch the camera on for GymsPilotPro in its settings, then come back here.
              </Body>
              <Button label="Open phone settings" onPress={() => openPhoneSettings("the camera")} style={{ marginTop: space.lg }} />
            </>
          ) : (
            <>
              <Button label="Allow the camera" onPress={ask} busy={asking} style={{ marginTop: space.lg }} />
              {askedBefore ? (
                <Button label="Open phone settings" variant="quiet" onPress={() => openPhoneSettings("the camera")} style={{ marginTop: space.sm }} />
              ) : null}
            </>
          )}
          <Caption style={{ marginTop: space.lg }}>Rather not use the camera? The front desk can check you in another way.</Caption>
        </Card>
      );
    }

    if (phase.kind === "done") return <Result outcome={phase.outcome} onRetry={retry} onScanAgain={scanAgain} />;
    // Trying the same attempt again: its answer stays up, with the button busy.
    if (phase.kind === "sending" && phase.before) return <Result outcome={phase.before} busy onRetry={retry} onScanAgain={scanAgain} />;

    const sending = phase.kind === "sending";
    return (
      <>
        {cameraProblem ? (
          <>
            <Notice tone="error">{cameraProblem}</Notice>
            <Button label="Start the camera again" onPress={restartCamera} />
          </>
        ) : (
          <View
            accessible
            accessibilityLabel={sending ? "Checking with your gym" : "Camera. Point it at the check-in code on the screen at the front desk."}
            accessibilityState={{ busy: sending }}
            style={{ width: size, height: size, alignSelf: "center", borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#000000" }}
          >
            <CameraView
              key={cameraKey}
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={phase.kind === "scanning" ? onScan : undefined}
              onMountError={() => setCameraProblem("The camera would not start. Close any other app using it, then try again.")}
            />
            {/* Where to put the code. Drawn over the picture, not part of it. */}
            <View
              style={{
                position: "absolute",
                top: "14%",
                left: "14%",
                right: "14%",
                bottom: "14%",
                borderWidth: 3,
                borderColor: p.accent,
                borderRadius: radius.lg,
                pointerEvents: "none",
              }}
            />
            {sending ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", gap: space.md, padding: space.lg }]}>
                <ActivityIndicator color="#ffffff" size="large" />
                <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "700", textAlign: "center" }}>Checking with your gym…</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Right under the camera, where the member is looking. */}
        <Body muted style={{ textAlign: "center", marginTop: space.lg }}>
          Point your camera at the code on the screen at the front desk.
        </Body>
        {wrongCode && !sending ? (
          <View style={{ marginTop: space.md }}>
            <Notice tone="warn">{WRONG_CODE} Look for the code on the screen at the front desk.</Notice>
          </View>
        ) : null}
        <Caption style={{ textAlign: "center", marginTop: wrongCode && !sending ? 0 : space.md }}>
          Camera not working? The front desk can check you in another way.
        </Caption>
      </>
    );
  };

  return (
    <Screen refreshing={false} onRefresh={closed.message ? refresh : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, marginBottom: space.xl }}>
        <View style={{ flex: 1 }}>
          <Caption>{gymName}</Caption>
          <Title style={{ marginTop: 2 }}>Check in</Title>
        </View>
        <GymMark />
      </View>

      {body()}

      <Button label="Done" variant="secondary" onPress={close} style={{ marginTop: space.xl }} />
    </Screen>
  );
}

/**
 * The answer, where the camera was: green for in, blue for out, amber for a
 * scan the gym already had, red for anything that did not go through.
 */
function Result({ outcome, busy, onRetry, onScanAgain }: { outcome: Outcome; busy?: boolean; onRetry: () => void; onScanAgain: () => void }) {
  const p = usePalette();
  const colour = { in: p.success, out: CHECKED_OUT, ignored: p.warning, refused: p.danger }[outcome.tone];
  const mark = outcome.tone === "refused" ? "✕" : outcome.tone === "ignored" ? "!" : "✓";

  return (
    <>
      <Card style={{ alignItems: "center", paddingVertical: space.xl, borderColor: `${colour}66` }}>
        {/* Decoration: the title says the same in words. */}
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: `${colour}22`,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: space.lg,
          }}
        >
          <Text style={{ color: colour, fontSize: 30, fontWeight: "800" }}>{mark}</Text>
        </View>
        <Text accessibilityRole="header" style={{ color: colour, fontSize: 24, fontWeight: "800", textAlign: "center" }}>
          {outcome.title}
        </Text>
        <Body style={{ textAlign: "center", marginTop: space.sm }}>{outcome.text}</Body>
        {outcome.note ? <Body style={{ textAlign: "center", marginTop: space.md, color: p.warning, fontWeight: "600" }}>{outcome.note}</Body> : null}
      </Card>

      {outcome.retry ? <Button label="Try again" onPress={onRetry} busy={busy} style={{ marginTop: space.lg }} /> : null}
      <Button
        label="Scan again"
        variant={outcome.retry ? "secondary" : "primary"}
        onPress={onScanAgain}
        disabled={busy}
        style={{ marginTop: outcome.retry ? space.sm : space.lg }}
      />
    </>
  );
}
