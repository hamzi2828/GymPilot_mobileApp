// The timetable, and booking yourself into it.
//
// The server decides everything that matters -- how far ahead you may book,
// when booking closes, whether a session costs a credit, what happens when
// it is full. The app shows what it is told and reports back what it says,
// under the class that was tapped.
//
// A few weeks of a busy gym's timetable is a couple of hundred classes, so
// they are drawn as they scroll into view (ScreenSectionList), not all at
// once when the tab opens.

import React, { useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen, ScreenSectionList } from "@/components/Screen";
import { Body, Caption, Card, Empty, GymClosed, LoadFailed, Loading, Notice, Pill } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { dayLabel, timeRange } from "@/lib/format";
import { usePalette, useSession } from "@/lib/session";
import { radius, space } from "@/lib/theme";
import { useGymClosed, useLoad } from "@/lib/useLoad";
import type { Session, TimetableResponse } from "@/lib/types";

/** Hours from now until a session starts. Read from the clock only when a member acts, never while drawing. */
function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

const keyOf = (s: Session) => `${s.class_id}-${s.date}-${s.start_time}`;

/** What the server said about the last booking or cancellation, and which class it was about. */
interface Answer {
  key: string;
  tone: "ok" | "error";
  text: string;
}

/** One day of the timetable, as the list draws it. */
interface Day {
  date: string;
  data: Session[];
}

export default function Classes() {
  const { session, signOut } = useSession();
  const p = usePalette();
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);

  const timetable = useLoad<TimetableResponse>("/api/gymfolio/timetable");
  const sessions = useMemo(() => timetable.data?.data || [], [timetable.data]);
  // The timetable is public, so a closed gym usually shows up only when a
  // member tries to book or cancel.
  const closed = useGymClosed(timetable);
  const reload = () => {
    closed.clear();
    return timetable.reload();
  };

  const visible = useMemo(
    () => (onlyMine ? sessions.filter((s) => s.my_booking && s.my_booking.status !== "cancelled") : sessions),
    [onlyMine, sessions]
  );

  // The timetable comes back flat; a member reads it a day at a time.
  const days = useMemo<Day[]>(() => {
    const map = new Map<string, Session[]>();
    for (const s of visible) {
      const list = map.get(s.date) || [];
      list.push(s);
      map.set(s.date, list);
    }
    // Sorted twice: the days in order, and the sessions inside a day in
    // clock order -- the API returns them class by class, not hour by hour.
    for (const list of map.values()) list.sort((a, b) => String(a.start_time || "").localeCompare(String(b.start_time || "")));
    return [...map.entries()].sort(([a], [b]) => String(a || "").localeCompare(String(b || ""))).map(([date, data]) => ({ date, data }));
  }, [visible]);

  const rules = timetable.data?.rules;
  const cancelWindow = rules?.cancel_hours ?? 0;

  // The answer goes under the class it is about, and is read out: the member
  // tapped a card halfway down the list, not the top of the screen.
  const tell = (s: Session, tone: Answer["tone"], text: string) => {
    setAnswer({ key: keyOf(s), tone, text });
    AccessibilityInfo.announceForAccessibility(text);
  };
  // A class no longer in the list -- cancelled from "Only mine", which then
  // leaves it out -- has its answer said above the list instead.
  const answerInList = !!answer && visible.some((s) => keyOf(s) === answer.key);
  const showOnlyMine = (value: boolean) => {
    setOnlyMine(value);
    setAnswer(null);
  };

  // One booking or cancellation at a time. `busyKey` says which card shows
  // as working, but it only changes on the next draw and used to be cleared
  // by whichever request finished first -- so the ref is what a second tap
  // meets, from the first tap (the "are you sure?" included) to the answer.
  const acting = useRef(false);

  const book = async (s: Session) => {
    if (acting.current) return;
    acting.current = true;
    setBusyKey(keyOf(s));
    setAnswer(null);
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
      tell(
        s,
        "ok",
        [res.message || (s.is_full ? `You are on the waitlist for ${s.class_name}.` : `Booked into ${s.class_name}.`), res.membership_warning]
          .filter(Boolean)
          .join(" ")
      );
      timetable.reload();
    } catch (e) {
      // Only a gym closed as a whole takes the screen over. A refusal about
      // the member's own membership -- none, lapsed, no sessions left (402)
      // -- or a full or closed class is the answer to this tap.
      if (closed.caught(e)) return;
      tell(s, "error", e instanceof ApiError || e instanceof Error ? e.message : "Could not book that class.");
    } finally {
      acting.current = false;
      setBusyKey(null);
    }
  };

  const cancel = async (s: Session) => {
    if (!s.my_booking || acting.current) return;

    // Inside the gym's cancellation window a cancel is a late one, and the
    // gym may keep the credit. The server decides that; the member is told
    // before they confirm, not after.
    const hoursLeft = hoursUntil(s.starts_at);
    const late = cancelWindow > 0 && hoursLeft < cancelWindow && s.my_booking.status !== "waitlisted";
    const when = `${s.class_name}, ${dayLabel(s.date)} at ${s.start_time}`;
    acting.current = true;
    try {
      const sure = await confirmAction({
        title: late ? "Cancel late?" : "Cancel this booking?",
        message: late
          ? `${when} ${hoursLeft <= 0 ? "has already started" : `starts in under ${cancelWindow} hours`}. Your gym counts this as a late cancellation${rules?.use_credits ? ", so the session credit may not come back" : ""}.`
          : `${when}.`,
        confirm: late ? "Cancel anyway" : "Cancel booking",
        cancel: "Keep it",
        destructive: true,
      });
      if (!sure) return;

      setBusyKey(keyOf(s));
      setAnswer(null);
      const res = await api<{ message?: string }>(`/api/gymfolio/bookings/${s.my_booking.id}`, {
        method: "DELETE",
        session,
        onUnauthorised: signOut,
      });
      tell(s, "ok", res.message || "Booking cancelled.");
      timetable.reload();
    } catch (e) {
      if (closed.caught(e)) return;
      tell(s, "error", e instanceof ApiError || e instanceof Error ? e.message : "Could not cancel that booking.");
    } finally {
      acting.current = false;
      setBusyKey(null);
    }
  };

  if (closed.message) {
    return (
      <Screen title="Classes" refreshing={timetable.refreshing} onRefresh={reload}>
        <GymClosed message={closed.message} gone={closed.gone} />
      </Screen>
    );
  }

  const filters = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.lg }}>
      {[
        { label: "Everything", value: false },
        { label: "Only mine", value: true },
      ].map((tab) => (
        <Pressable
          key={tab.label}
          onPress={() => showOnlyMine(tab.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: onlyMine === tab.value }}
          accessibilityLabel={tab.value ? "Only the classes I booked" : "Every class"}
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
      <Pressable onPress={() => router.push("/bookings")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Your past bookings">
        <Body style={{ color: p.accent, fontWeight: "700", fontSize: 13.5 }}>History ›</Body>
      </Pressable>
    </View>
  );

  return (
    <ScreenSectionList<Session, Day>
      title="Classes"
      subtitle={rules ? `Book up to ${rules.horizon_days} days ahead · cancel at least ${rules.cancel_hours}h before` : undefined}
      refreshing={timetable.refreshing}
      onRefresh={reload}
      top={
        <>
          {filters}
          {answer && !answerInList ? <Notice tone={answer.tone}>{answer.text}</Notice> : null}
          {timetable.error && timetable.data ? <Notice tone="error">{timetable.error}</Notice> : null}
        </>
      }
      // Nothing to draw until the timetable has arrived. Until then, and when
      // it has nothing in it, the empty state below says which it is.
      sections={timetable.loading || !timetable.data ? [] : days}
      keyExtractor={keyOf}
      // A card shows the spinner and the answer as well as its class.
      extraData={`${busyKey}|${answer?.key}|${answer?.text}`}
      initialNumToRender={12}
      renderSectionHeader={({ section }) => (
        <Caption style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: space.sm, fontWeight: "700" }}>{dayLabel(section.date)}</Caption>
      )}
      renderSectionFooter={DayEnd}
      ItemSeparatorComponent={Gap}
      renderItem={({ item }) => (
        <ClassCard
          s={item}
          busy={busyKey === keyOf(item)}
          locked={busyKey !== null}
          answer={answer?.key === keyOf(item) ? answer : null}
          onPress={() => (item.my_booking && item.my_booking.status !== "cancelled" ? cancel(item) : book(item))}
        />
      )}
      ListEmptyComponent={
        timetable.loading ? (
          <Loading label="Loading the timetable" />
        ) : timetable.error && !timetable.data ? (
          // The timetable never arrived: say that, not "no classes".
          <LoadFailed message={timetable.error} onRetry={reload} />
        ) : (
          <Empty
            title={onlyMine ? "You have not booked anything" : "No classes on the timetable"}
            hint={onlyMine ? "Switch to Everything to see what is on." : "Your gym has not published any classes for the next few weeks."}
          />
        )
      }
    />
  );
}

/** The space between two classes on the same day. */
function Gap() {
  return <View style={{ height: space.sm }} />;
}

/** The space after a day's last class, before the next day's heading. */
function DayEnd() {
  return <View style={{ height: space.xl }} />;
}

/**
 * One class on the timetable. The whole card is the button: a tap books it
 * (or joins its waitlist), or cancels the member's booking. What the server
 * said about that tap is shown just under it.
 */
function ClassCard({ s, busy, locked, answer, onPress }: { s: Session; busy: boolean; locked: boolean; answer: Answer | null; onPress: () => void }) {
  const p = usePalette();
  const booked = !!s.my_booking && s.my_booking.status !== "cancelled";
  const waitlisted = s.my_booking?.status === "waitlisted";
  // The booking cutoff closes booking, not cancelling: the server takes a
  // cancel at any time (inside the gym's window it counts as a late one,
  // which the confirm says first).
  const actionable = booked || s.can_book;

  // The whole card is the button, so a screen reader is told what the card
  // is, how it stands, and what a tap will do -- the same three things the
  // pill and the colours say by eye.
  const standing = booked
    ? waitlisted
      ? `You are on the waitlist${s.my_booking?.waitlist_position ? `, number ${s.my_booking.waitlist_position}` : ""}`
      : "You are booked"
    : s.is_cancelled
      ? "Cancelled"
      : s.is_full
        ? `Full, ${s.waitlist_count} waiting`
        : s.is_closed
          ? "Booking closed"
          : `${s.spots_left} places left`;
  const tapDoes = booked ? "Cancels your booking" : !s.can_book ? undefined : s.is_full ? "Joins the waitlist" : "Books this class";

  return (
    <View>
      <Pressable
        disabled={!actionable || locked}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${s.class_name}, ${dayLabel(s.date)} at ${s.start_time}${s.instructor_name ? `, with ${s.instructor_name}` : ""}. ${standing}.`}
        accessibilityHint={tapDoes}
        accessibilityState={{ disabled: !actionable || locked, busy }}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : s.is_closed && !booked ? 0.45 : 1 })}
      >
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
            <View style={{ minWidth: 52 }}>
              <Body style={{ fontWeight: "800", fontSize: 15 }}>{s.start_time}</Body>
              {s.duration_minutes ? <Caption>{s.duration_minutes} min</Caption> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: "700" }}>{s.class_name}</Body>
              <Caption style={{ marginTop: 2 }}>{[s.instructor_name, s.room, timeRange(s.start_time, s.end_time)].filter(Boolean).join(" · ")}</Caption>
              {s.is_cancelled ? (
                <Caption style={{ marginTop: 4, color: p.danger }}>Cancelled{s.change_note ? ` — ${s.change_note}` : ""}</Caption>
              ) : s.is_substitute ? (
                <Caption style={{ marginTop: 4, color: p.warning }}>Cover instructor{s.change_note ? ` — ${s.change_note}` : ""}</Caption>
              ) : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              {busy ? (
                <ActivityIndicator size="small" color={p.accent} />
              ) : booked ? (
                <Pill label={waitlisted ? `waitlist ${s.my_booking?.waitlist_position ?? ""}`.trim() : "booked"} tone={waitlisted ? "warn" : "good"} />
              ) : s.is_cancelled ? (
                <Pill label="off" tone="bad" />
              ) : s.is_full ? (
                // A full session can still be joined -- as a place in the
                // queue, which is what the server hands out for it.
                <Pill label={s.can_book ? "join waitlist" : "full"} tone="warn" />
              ) : s.is_closed ? (
                <Pill label="closed" />
              ) : (
                <Pill label="book" tone="accent" />
              )}
              {!s.is_cancelled && !booked ? <Caption>{s.is_full ? `${s.waitlist_count} waiting` : `${s.spots_left} left`}</Caption> : null}
            </View>
          </View>
        </Card>
      </Pressable>
      {answer ? (
        <Notice tone={answer.tone} style={{ marginTop: space.sm, marginBottom: 0 }}>
          {answer.text}
        </Notice>
      ) : null}
    </View>
  );
}
