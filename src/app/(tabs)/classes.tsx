// The timetable, and booking yourself into it.
//
// The server decides everything that matters -- how far ahead you may book,
// when booking closes, whether a session costs a credit, what happens when
// it is full. The app shows what it is told and reports back what it says.

import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Body, Caption, Card, Empty, Loading, Notice, Pill } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { dayLabel, timeRange } from "@/lib/format";
import { usePalette, useSession } from "@/lib/session";
import { radius, space } from "@/lib/theme";
import { useLoad } from "@/lib/useLoad";
import type { Session, TimetableResponse } from "@/lib/types";

/** Hours from now until a session starts. Read from the clock only when a member acts, never while drawing. */
function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

export default function Classes() {
  const { session, signOut } = useSession();
  const p = usePalette();
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);

  const timetable = useLoad<TimetableResponse>("/api/gymfolio/timetable");
  const sessions = useMemo(() => timetable.data?.data || [], [timetable.data]);

  const visible = useMemo(
    () => (onlyMine ? sessions.filter((s) => s.my_booking && s.my_booking.status !== "cancelled") : sessions),
    [onlyMine, sessions]
  );

  // The timetable comes back flat; a member reads it a day at a time.
  const days = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of visible) {
      const list = map.get(s.date) || [];
      list.push(s);
      map.set(s.date, list);
    }
    // Sorted twice: the days in order, and the sessions inside a day in
    // clock order -- the API returns them class by class, not hour by hour.
    for (const list of map.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const rules = timetable.data?.rules;
  const cancelWindow = rules?.cancel_hours ?? 0;

  const keyOf = (s: Session) => `${s.class_id}-${s.date}-${s.start_time}`;

  const book = async (s: Session) => {
    setBusyKey(keyOf(s));
    setMessage(null);
    try {
      // The server names these fields, and it says it better than the app
      // could -- including whether a place became a waitlist spot, and whether
      // there is money owing on the membership.
      const res = await api<{ message?: string; membership_warning?: string | null }>("/api/gymfolio/bookings", {
        method: "POST",
        session,
        onUnauthorised: signOut,
        body: { classId: s.class_id, date: s.date, startTime: s.start_time },
      });
      setMessage({
        tone: "ok",
        text: [res.message || (s.is_full ? `You are on the waitlist for ${s.class_name}.` : `Booked into ${s.class_name}.`), res.membership_warning]
          .filter(Boolean)
          .join(" "),
      });
      timetable.reload();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "Could not book that class." });
    } finally {
      setBusyKey(null);
    }
  };

  const cancel = async (s: Session) => {
    if (!s.my_booking) return;

    // Inside the gym's cancellation window a cancel is a late one, and the
    // gym may keep the credit. The server decides that; the member is told
    // before they confirm, not after.
    const hoursLeft = hoursUntil(s.starts_at);
    const late = cancelWindow > 0 && hoursLeft < cancelWindow && s.my_booking.status !== "waitlisted";
    const when = `${s.class_name}, ${dayLabel(s.date)} at ${s.start_time}`;
    const sure = await confirmAction({
      title: late ? "Cancel late?" : "Cancel this booking?",
      message: late
        ? `${when} starts in under ${cancelWindow} hours. Your gym counts this as a late cancellation${rules?.use_credits ? ", so the session credit may not come back" : ""}.`
        : `${when}.`,
      confirm: late ? "Cancel anyway" : "Cancel booking",
      cancel: "Keep it",
      destructive: true,
    });
    if (!sure) return;

    setBusyKey(keyOf(s));
    setMessage(null);
    try {
      const res = await api<{ message?: string }>(`/api/gymfolio/bookings/${s.my_booking.id}`, {
        method: "DELETE",
        session,
        onUnauthorised: signOut,
      });
      setMessage({ tone: "ok", text: res.message || "Booking cancelled." });
      timetable.reload();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "Could not cancel that booking." });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Screen
      title="Classes"
      subtitle={rules ? `Book up to ${rules.horizon_days} days ahead · cancel at least ${rules.cancel_hours}h before` : undefined}
      refreshing={timetable.refreshing}
      onRefresh={timetable.reload}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.lg }}>
        {[
          { label: "Everything", value: false },
          { label: "Only mine", value: true },
        ].map((tab) => (
          <Pressable
            key={tab.label}
            onPress={() => setOnlyMine(tab.value)}
            style={{
              backgroundColor: onlyMine === tab.value ? p.accent : p.cardRaised,
              borderRadius: radius.pill,
              paddingHorizontal: space.lg,
              paddingVertical: 8,
            }}
          >
            <Body style={{ color: onlyMine === tab.value ? p.onAccent : p.textMuted, fontWeight: "700", fontSize: 13 }}>{tab.label}</Body>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.push("/bookings")} hitSlop={10}>
          <Body style={{ color: p.accent, fontWeight: "700", fontSize: 13.5 }}>History ›</Body>
        </Pressable>
      </View>

      {message ? <Notice tone={message.tone === "ok" ? "ok" : "error"}>{message.text}</Notice> : null}
      {timetable.error ? <Notice tone="error">{timetable.error}</Notice> : null}

      {timetable.loading ? (
        <Loading label="Loading the timetable" />
      ) : days.length === 0 ? (
        <Empty
          title={onlyMine ? "You have not booked anything" : "No classes on the timetable"}
          hint={onlyMine ? "Switch to Everything to see what is on." : "Your gym has not published any classes for the next few weeks."}
        />
      ) : (
        days.map(([date, list]) => (
          <View key={date} style={{ marginBottom: space.xl }}>
            <Caption style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: space.sm, fontWeight: "700" }}>{dayLabel(date)}</Caption>
            <View style={{ gap: space.sm }}>
              {list.map((s) => {
                const booked = !!s.my_booking && s.my_booking.status !== "cancelled";
                const waitlisted = s.my_booking?.status === "waitlisted";
                const busy = busyKey === keyOf(s);
                const actionable = booked ? !s.is_closed : s.can_book;

                return (
                  <Pressable
                    key={keyOf(s)}
                    disabled={!actionable || busy}
                    onPress={() => (booked ? cancel(s) : book(s))}
                    style={({ pressed }) => ({ opacity: pressed ? 0.85 : s.is_closed && !booked ? 0.45 : 1 })}
                  >
                    <Card>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
                        <View style={{ minWidth: 52 }}>
                          <Body style={{ fontWeight: "800", fontSize: 15 }}>{s.start_time}</Body>
                          <Caption>{s.duration_minutes} min</Caption>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Body style={{ fontWeight: "700" }}>{s.class_name}</Body>
                          <Caption style={{ marginTop: 2 }}>
                            {[s.instructor_name, s.room, timeRange(s.start_time, s.end_time)].filter(Boolean).join(" · ")}
                          </Caption>
                          {s.is_cancelled ? (
                            <Caption style={{ marginTop: 4, color: p.danger }}>Cancelled{s.change_note ? ` — ${s.change_note}` : ""}</Caption>
                          ) : s.is_substitute ? (
                            <Caption style={{ marginTop: 4, color: p.warning }}>Cover instructor{s.change_note ? ` — ${s.change_note}` : ""}</Caption>
                          ) : null}
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 4 }}>
                          {busy ? (
                            <Caption>…</Caption>
                          ) : booked ? (
                            <Pill label={waitlisted ? `waitlist ${s.my_booking?.waitlist_position ?? ""}`.trim() : "booked"} tone={waitlisted ? "warn" : "good"} />
                          ) : s.is_cancelled ? (
                            <Pill label="off" tone="bad" />
                          ) : s.is_full ? (
                            // A full session can still be joined -- as a place in
                            // the queue, which is what the server hands out for it.
                            <Pill label={s.can_book ? "join waitlist" : "full"} tone="warn" />
                          ) : s.is_closed ? (
                            <Pill label="closed" />
                          ) : (
                            <Pill label="book" tone="accent" />
                          )}
                          {!s.is_cancelled && !booked ? (
                            <Caption>{s.is_full ? `${s.waitlist_count} waiting` : `${s.spots_left} left`}</Caption>
                          ) : null}
                        </View>
                      </View>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}
