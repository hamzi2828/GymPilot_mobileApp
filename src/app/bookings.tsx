// Every class the member has booked in the past: attended, missed, or
// cancelled -- and whether a cancellation was a late one, which is what the
// gym's no-show rules count.

import React, { useMemo } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Body, Button, Caption, Card, Empty, GymClosed, LoadFailed, Loading, Notice, Pill, Stat } from "@/components/ui";
import { dayLabel, timeRange } from "@/lib/format";
import { space } from "@/lib/theme";
import { useGymClosed, useLoad } from "@/lib/useLoad";
import { useRequireSession } from "@/lib/useRequireSession";
import type { BookingRecord, BookingsResponse } from "@/lib/types";

type Tone = "neutral" | "good" | "warn" | "bad";

/** What each status is called to a member, and how loudly. */
function statusOf(b: BookingRecord): { label: string; tone: Tone } {
  if (b.status === "cancelled") return b.late_cancel ? { label: "cancelled late", tone: "bad" } : { label: "cancelled", tone: "neutral" };
  switch (b.status) {
    case "attended":
      return { label: "attended", tone: "good" };
    case "no_show":
      return { label: "missed", tone: "bad" };
    case "waitlisted":
      return { label: "waitlist", tone: "warn" };
    case "booked":
      return { label: "booked", tone: "neutral" };
    default:
      return { label: String(b.status || "").replace(/_/g, " "), tone: "neutral" };
  }
}

export default function Bookings() {
  useRequireSession();
  const router = useRouter();

  // Past only: what is still to come lives on the Classes tab.
  const history = useLoad<BookingsResponse>("/api/gymfolio/bookings/me?scope=past");
  const rows = useMemo(() => history.data?.data || [], [history.data]);
  const closed = useGymClosed(history);

  const attended = rows.filter((b) => b.status === "attended").length;
  const missed = rows.filter((b) => b.status === "no_show").length;
  const late = rows.filter((b) => b.status === "cancelled" && b.late_cancel).length;

  return (
    <Screen title="Your bookings" subtitle="Classes you booked before today" refreshing={history.refreshing} onRefresh={history.reload}>
      {closed.message ? <GymClosed message={closed.message} /> : history.error && history.data ? <Notice tone="error">{history.error}</Notice> : null}

      {closed.message ? null : history.loading && !history.data ? (
        <Loading />
      ) : history.error && !history.data ? (
        // The list never arrived: say that, not "no past bookings".
        <LoadFailed message={history.error} onRetry={history.reload} />
      ) : rows.length === 0 ? (
        <Empty title="No past bookings" hint="Once you have been to a class, it shows up here." />
      ) : (
        <>
          <Card style={{ marginBottom: space.lg }}>
            <View style={{ flexDirection: "row", gap: space.md }}>
              <Stat value={attended} label="attended" />
              <Stat value={missed} label="missed" />
              <Stat value={late} label="cancelled late" />
            </View>
          </Card>

          <View style={{ gap: space.sm }}>
            {rows.map((b) => {
              const status = statusOf(b);
              return (
                <Card key={b.id}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
                    <View style={{ minWidth: 56 }}>
                      <Body style={{ fontWeight: "800", fontSize: 15 }}>{b.start_time}</Body>
                      <Caption>{dayLabel(b.date)}</Caption>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontWeight: "700" }}>{b.class_name}</Body>
                      <Caption style={{ marginTop: 2 }}>
                        {[b.instructor_name, timeRange(b.start_time, b.end_time)].filter(Boolean).join(" · ")}
                      </Caption>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Pill label={status.label} tone={status.tone} />
                      {b.credit_used ? <Caption>1 credit</Caption> : null}
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        </>
      )}

      <Button label="Back" variant="secondary" onPress={() => router.back()} style={{ marginTop: space.xl }} />
    </Screen>
  );
}
