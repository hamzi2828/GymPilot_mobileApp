// Every visit the gym has recorded for this member, month by month.
//
// The front desk records these on the reader; nothing here is entered by the
// member, so the screen only ever reads.

import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Body, Button, Caption, Card, Divider, Empty, Heading, Line, Loading, Notice, Pill, Stat } from "@/components/ui";
import { usePalette } from "@/lib/session";
import { radius, space } from "@/lib/theme";
import { useLoad } from "@/lib/useLoad";
import type { AttendanceResponse } from "@/lib/types";

export default function Attendance() {
  const p = usePalette();
  const router = useRouter();
  const [month, setMonth] = useState<string | null>(null);

  // `month` narrows the visit list; without it the server sends the most
  // recent ones across every month.
  const attendance = useLoad<AttendanceResponse>(
    `/api/attendance/me?limit=60${month ? `&month=${month}` : ""}`,
    [month]
  );

  const data = attendance.data;
  const summary = data?.summary;
  const months = data?.months || [];
  const visits = data?.visits || [];

  return (
    <Screen title="Your visits" refreshing={attendance.refreshing} onRefresh={attendance.reload}>
      {attendance.error ? <Notice tone="error">{attendance.error}</Notice> : null}

      {attendance.loading && !data ? (
        <Loading />
      ) : (
        <>
          {summary ? (
            <Card style={{ marginBottom: space.lg }}>
              <View style={{ flexDirection: "row", gap: space.md }}>
                <Stat value={summary.visits} label="visits" />
                <Stat value={summary.total_label} label="time trained" />
                <Stat value={summary.streak_days} label="day streak" />
              </View>
              <Divider />
              {summary.checked_in_now ? <Line label="Right now" value={<Pill label="you are inside" tone="good" />} /> : null}
              <Line label="This month" value={`${summary.this_month?.visits ?? 0} visits · ${summary.this_month?.total_label || "0 m"}`} />
              {summary.average_label ? <Line label="Average visit" value={summary.average_label} /> : null}
              {summary.first_visit_label ? <Line label="First visit" value={summary.first_visit_label} /> : null}
              {summary.last_visit_label ? <Line label="Last visit" value={summary.last_visit_label} /> : null}
            </Card>
          ) : null}

          {months.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.lg }}>
              {[{ key: "", label: "All" }, ...months.map((m) => ({ key: m.key, label: `${m.label} · ${m.visits}` }))].map((chip) => {
                const on = (month || "") === chip.key;
                return (
                  <Pressable
                    key={chip.key || "all"}
                    onPress={() => setMonth(chip.key || null)}
                    style={{
                      backgroundColor: on ? p.accent : p.cardRaised,
                      borderRadius: radius.pill,
                      paddingHorizontal: space.lg,
                      paddingVertical: 8,
                    }}
                  >
                    <Body style={{ color: on ? p.onAccent : p.textMuted, fontWeight: "700", fontSize: 13 }}>{chip.label}</Body>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <Heading>{month ? data?.selected_month?.label || "Visits" : "Recent visits"}</Heading>

          {visits.length === 0 ? (
            <Empty title="No visits recorded" hint={data?.note || "Visits appear here once the front desk records them on the reader."} />
          ) : (
            <View style={{ gap: space.sm }}>
              {visits.map((v) => (
                <Card key={v.id}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
                    <View style={{ minWidth: 56 }}>
                      <Body style={{ fontWeight: "800", fontSize: 15 }}>{v.day_name}</Body>
                      <Caption>{v.date_label}</Caption>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontWeight: "600" }}>
                        {v.check_in_time}
                        {v.check_out_time ? ` – ${v.check_out_time}` : ""}
                      </Body>
                      {v.package_name ? <Caption style={{ marginTop: 2 }}>{v.package_name}</Caption> : null}
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      {v.still_in ? <Pill label="inside" tone="good" /> : <Body style={{ fontWeight: "700", fontSize: 14 }}>{v.duration_label || "—"}</Body>}
                      {v.status_label ? <Caption>{v.status_label}</Caption> : null}
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          )}
        </>
      )}

      <Button label="Back" variant="secondary" onPress={() => router.back()} style={{ marginTop: space.xl }} />
    </Screen>
  );
}
