// Home: what a member wants at the door — am I paid up, when is my next
// class, and the code that opens it. And whatever the gym has to say today.

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { GymMark, Screen } from "@/components/Screen";
import { QrIcon } from "@/components/icons";
import { Body, Button, Caption, Card, Divider, Empty, GymClosed, Heading, Line, Loading, Notice, Pill, Stat, Title } from "@/components/ui";
import { dayLabel, longDate, money, relativeDays, timeRange } from "@/lib/format";
import { awaitingPayment, balanceOwing, currentMembership, endDateLabel, isLive, SITE_ACCOUNT_HISTORY, SITE_PACKAGES, statusPill } from "@/lib/membership";
import { usePalette, useSession } from "@/lib/session";
import { radius, space } from "@/lib/theme";
import { useGymClosed, useLoad } from "@/lib/useLoad";
import type { Announcement, AttendanceSummary, MembershipOrder, TimetableResponse } from "@/lib/types";

export default function Home() {
  const { user, gymName, branding } = useSession();
  const p = usePalette();
  const router = useRouter();

  const attendance = useLoad<{ summary: AttendanceSummary }>("/api/attendance/me?limit=1");
  // The same page the Membership tab asks for. Orders come newest first, and
  // checkouts opened and never paid are orders too: a short page could be
  // all of those, with the membership itself on the next one.
  const memberships = useLoad<{ data: MembershipOrder[] }>("/api/gymfolio/package-orders/me?limit=20");
  const timetable = useLoad<TimetableResponse>("/api/gymfolio/timetable");
  const announcements = useLoad<{ data: Announcement[] }>("/announcements/active");

  // A gym closed to its members fails every request the same way: say it
  // once, with a way out, rather than under every section.
  const closed = useGymClosed(memberships, timetable, attendance);

  // Only a paid, live order is "your membership" (see lib/membership).
  const active = currentMembership(memberships.data?.data || []);
  const waiting = awaitingPayment(memberships.data?.data || []);
  // Everything still owed on what they hold now, a session pack alongside
  // the membership included.
  const owing = (memberships.data?.data || []).filter(isLive).reduce((sum, o) => sum + balanceOwing(o), 0);
  const siteUrl = branding?.siteUrl || "";
  const openSite = (path: string) => {
    if (siteUrl) WebBrowser.openBrowserAsync(`${siteUrl}${path}`);
  };
  // The clock, read when the screen opens rather than on every render.
  const [openedAt, setOpenedAt] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setOpenedAt(Date.now());
    }, [])
  );

  // Soonest first, and only what is still to come: "your next classes" is a
  // promise about the future.
  const mine = useMemo(
    () =>
      (timetable.data?.data || [])
        .filter((s) => s.my_booking && s.my_booking.status !== "cancelled" && new Date(s.starts_at).getTime() >= openedAt)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .slice(0, 3),
    [timetable.data, openedAt]
  );
  const summary = attendance.data?.summary;
  const notices = announcements.data?.data || [];

  const refreshing = attendance.refreshing || memberships.refreshing || timetable.refreshing;
  const reload = () => {
    attendance.reload();
    memberships.reload();
    timetable.reload();
    announcements.reload();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.xl }}>
        <View style={{ flex: 1 }}>
          <Caption>{gymName}</Caption>
          <Title style={{ marginTop: 2 }}>Hi {user?.firstName || "there"}</Title>
        </View>
        <GymMark />
      </View>

      {closed.message ? (
        <GymClosed message={closed.message} />
      ) : (
        <>
          {/* What the gym has to say. */}
          {notices.map((a) => (
            <AnnouncementCard key={a.id} announcement={a} siteUrl={siteUrl} />
          ))}

          {/* Check in. The one thing they open the app for at the door. */}
          <Pressable
            onPress={() => router.push("/checkin")}
            accessibilityRole="button"
            style={({ pressed }) => ({
              backgroundColor: p.accent,
              opacity: pressed ? 0.9 : 1,
              borderRadius: radius.lg,
              padding: space.lg,
              flexDirection: "row",
              alignItems: "center",
              gap: space.lg,
              marginBottom: space.lg,
            })}
          >
            <QrIcon color={p.onAccent} size={32} />
            <View style={{ flex: 1 }}>
              <Body style={{ color: p.onAccent, fontWeight: "800", fontSize: 16 }}>Check in</Body>
              <Body style={{ color: p.onAccent, opacity: 0.75, fontSize: 13 }}>
                {summary?.checked_in_now ? "You are inside right now" : "Show this at the front desk"}
              </Body>
            </View>
          </Pressable>

          {/* Membership */}
          <Heading>Your membership</Heading>
          {memberships.loading ? (
            <Loading />
          ) : memberships.error ? (
            <Notice tone="error">{memberships.error}</Notice>
          ) : active ? (
            <Card style={{ marginBottom: space.xl }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "700", fontSize: 17 }}>{active.packageDetails?.name || "Membership"}</Body>
                  <Caption style={{ marginTop: 2 }}>{active.orderNumber}</Caption>
                </View>
                <Pill label={statusPill(active).label} tone={statusPill(active).tone} />
              </View>
              <Divider />
              {active.subscription?.endDate ? (
                <Line label={endDateLabel(active)} value={`${longDate(active.subscription.endDate)} · ${relativeDays(active.subscription.endDate)}`} />
              ) : null}
              {active.packageDetails?.sessions ? (
                <Line label="Sessions left" value={`${Math.max(0, (active.sessions?.total || 0) - (active.sessions?.used || 0))} of ${active.sessions?.total || 0}`} />
              ) : null}
              {/* Paid for in parts and not finished: the status above still
                  says active, so the money owed is said here. */}
              {owing > 0 ? (
                <Pressable onPress={() => router.navigate("/(tabs)/membership")} hitSlop={8} accessibilityRole="link" style={{ marginTop: space.sm, alignSelf: "flex-start" }}>
                  <Body style={{ color: p.warning, fontWeight: "700", fontSize: 14 }}>
                    {money(owing, active.payment.currency)} still to pay — pay at the front desk ›
                  </Body>
                </Pressable>
              ) : null}
              {/* A renewal the card could not pay for: the new card goes in
                  on the website's account page. */}
              {active.status === "past_due" ? (
                <Pressable
                  onPress={() => openSite(SITE_ACCOUNT_HISTORY)}
                  disabled={!siteUrl}
                  hitSlop={8}
                  style={{ marginTop: space.sm, alignSelf: "flex-start" }}
                >
                  <Body style={{ color: p.danger, fontWeight: "700", fontSize: 14 }}>
                    Payment failed — update your card on the website{siteUrl ? " ›" : ""}
                  </Body>
                </Pressable>
              ) : null}
            </Card>
          ) : waiting.length > 0 ? (
            // Bought, not paid for yet: said as that, never as the membership.
            // The Membership tab has the bank details and what to do next.
            <Card style={{ marginBottom: space.xl }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "700", fontSize: 17 }}>{waiting[0].packageDetails?.name || "Membership"}</Body>
                  <Caption style={{ marginTop: 2 }}>{waiting[0].orderNumber}</Caption>
                </View>
                <Pill label="awaiting payment" tone="warn" />
              </View>
              <Divider />
              <Caption>Awaiting payment confirmation. It starts once the gym has your payment; the Membership tab has the details.</Caption>
            </Card>
          ) : (
            <>
              <Empty title="No membership yet" hint="Join on your gym's website, or ask at the front desk and they will set one up for you." />
              {siteUrl ? (
                <Button label="See plans on the website" variant="secondary" onPress={() => openSite(SITE_PACKAGES)} style={{ marginTop: space.md, marginBottom: space.xl }} />
              ) : null}
            </>
          )}

          {/* What they have booked */}
          <Heading>Your next classes</Heading>
          {timetable.loading ? (
            <Loading />
          ) : timetable.error ? (
            <Notice tone="error">{timetable.error}</Notice>
          ) : mine.length === 0 ? (
            <Empty title="Nothing booked" hint="Open Classes to book your next session." />
          ) : (
            <View style={{ gap: space.sm, marginBottom: space.xl }}>
              {mine.map((s) => (
                <Card key={`${s.class_id}-${s.date}-${s.start_time}`} style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
                  <View style={{ alignItems: "center", minWidth: 52 }}>
                    <Body style={{ fontWeight: "800", fontSize: 15 }}>{s.start_time}</Body>
                    <Caption>{dayLabel(s.date)}</Caption>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{s.class_name}</Body>
                    <Caption style={{ marginTop: 2 }}>
                      {[s.instructor_name, s.room].filter(Boolean).join(" · ") || timeRange(s.start_time, s.end_time)}
                    </Caption>
                  </View>
                  {s.my_booking?.status === "waitlisted" ? <Pill label="waitlist" tone="warn" /> : <Pill label="booked" tone="good" />}
                </Card>
              ))}
            </View>
          )}

          {/* How they are doing. Tapping through shows every visit. */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Heading>Your training</Heading>
            <Pressable onPress={() => router.push("/attendance")} hitSlop={10} style={{ marginBottom: space.md }}>
              <Body style={{ color: p.accent, fontWeight: "700", fontSize: 13.5 }}>All visits</Body>
            </Pressable>
          </View>
          {attendance.loading ? (
            <Loading />
          ) : attendance.error ? (
            <Notice tone="error">{attendance.error}</Notice>
          ) : !summary ? (
            <Empty title="No visits recorded yet" />
          ) : (
            <Pressable onPress={() => router.push("/attendance")} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
              <Card>
                <View style={{ flexDirection: "row", gap: space.md }}>
                  <Stat value={summary.this_month?.visits ?? 0} label={`visits in ${summary.this_month?.label || "this month"}`} />
                  <Stat value={summary.visits} label="visits in total" />
                  <Stat value={summary.total_label} label="time trained" />
                </View>
                {summary.last_visit_label ? (
                  <>
                    <Divider />
                    <Line label="Last visit" value={summary.last_visit_label} />
                  </>
                ) : null}
              </Card>
            </Pressable>
          )}
        </>
      )}
    </Screen>
  );
}

/**
 * A notice the gym put up: "closed Monday", "new timetable from June". Its
 * link, if it has one, is usually a page on the gym's own site, so a bare
 * path is resolved against that.
 */
function AnnouncementCard({ announcement: a, siteUrl }: { announcement: Announcement; siteUrl: string }) {
  const p = usePalette();
  const colour = a.tone === "warning" ? p.warning : a.tone === "success" ? p.success : p.accent;
  const href = !a.url ? "" : /^https?:\/\//i.test(a.url) ? a.url : siteUrl ? `${siteUrl}${a.url.startsWith("/") ? "" : "/"}${a.url}` : "";

  return (
    <Card style={{ marginBottom: space.lg, borderColor: `${colour}66` }}>
      <Body style={{ fontWeight: "700", color: colour }}>{a.title}</Body>
      {a.body ? <Body style={{ marginTop: 4, fontSize: 14 }}>{a.body}</Body> : null}
      {href ? (
        <Pressable onPress={() => WebBrowser.openBrowserAsync(href)} hitSlop={8} style={{ marginTop: space.sm, alignSelf: "flex-start" }}>
          <Body style={{ color: p.accent, fontWeight: "700", fontSize: 14 }}>{a.url_label || "Read more"} ›</Body>
        </Pressable>
      ) : null}
    </Card>
  );
}
