// The member's own membership: what they are on, what it costs, when it
// ends, and the things they are allowed to do to it themselves.
//
// Three separate actions, and the server names them precisely, so the app
// does too:
//   freeze / unfreeze  -- pause the membership and start it again, with the
//                         paused days added on to the end date
//   cancel             -- stop it renewing; access runs to the end date
//   resume             -- undo that cancel while the period is still running
//
// Whether a member may freeze or cancel at all is the gym's decision and
// arrives from /membership/rules; the server enforces it either way.

import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { Screen } from "@/components/Screen";
import { Body, Button, Caption, Card, Divider, Empty, Heading, Line, Loading, Notice, Pill } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { longDate, money, relativeDays } from "@/lib/format";
import { usePalette, useSession } from "@/lib/session";
import { radius, space } from "@/lib/theme";
import { useLoad } from "@/lib/useLoad";
import type { MembershipOrder, PackageOnSale } from "@/lib/types";

interface Rules {
  allowMemberFreeze: boolean;
  maxFreezeDays: number;
  allowMemberCancel: boolean;
}

/** Statuses the server will accept a freeze or a cancel on. */
const LIVE = ["active", "frozen", "past_due"];

export default function Membership() {
  const { session, signOut } = useSession();
  const p = usePalette();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pausing, setPausing] = useState(false);

  const orders = useLoad<{ data: MembershipOrder[] }>("/api/gymfolio/package-orders/me?limit=20");
  const rules = useLoad<{ data: Rules }>("/api/gymfolio/membership/rules");
  const onSale = useLoad<{ data: PackageOnSale[] }>("/api/gymfolio/packages/active");

  const list = orders.data?.data || [];
  const current = list.find((o) => LIVE.includes(o.status)) || list[0] || null;
  const past = list.filter((o) => o !== current);
  const r = rules.data?.data;

  const frozen = !!current && (current.status === "frozen" || !!current.freeze?.isFrozen);
  const live = !!current && LIVE.includes(current.status);
  const stopping = !!current?.subscription?.cancelAtPeriodEnd && current.status !== "cancelled";

  const act = async (label: string, path: string, body?: unknown, confirmText?: string) => {
    if (confirmText) {
      const sure = await confirmAction({
        title: label,
        message: confirmText,
        confirm: label,
        cancel: "Not now",
        destructive: label.toLowerCase().startsWith("cancel"),
      });
      if (!sure) return;
    }
    setBusy(label);
    setMessage(null);
    try {
      const res = await api<{ message?: string }>(path, { method: "POST", session, onUnauthorised: signOut, body });
      setMessage({ tone: "ok", text: res.message || "Done." });
      orders.reload();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "That did not work." });
    } finally {
      setBusy(null);
    }
  };

  // A pause is for a length of time, so the member picks one rather than
  // being given the maximum by default.
  const freezeChoices = (max: number) => [7, 14, 30, max].filter((n, i, all) => n <= max && all.indexOf(n) === i).sort((a, b) => a - b);

  const pauseFor = (days: number) => {
    setPausing(false);
    act(
      "Pause my membership",
      `/api/gymfolio/package-orders/${current!._id}/freeze`,
      { days },
      `Your membership pauses today and starts again in ${days} days. Those ${days} days are added on to the end, so you lose nothing.`
    );
  };

  return (
    <Screen title="Membership" refreshing={orders.refreshing} onRefresh={orders.reload}>
      {message ? <Notice tone={message.tone === "ok" ? "ok" : "error"}>{message.text}</Notice> : null}
      {orders.error ? <Notice tone="error">{orders.error}</Notice> : null}

      {orders.loading ? (
        <Loading />
      ) : !current ? (
        <Empty title="You do not have a membership yet" hint="The front desk can set one up for you, or you can join from your gym's website." />
      ) : (
        <>
          <Card style={{ marginBottom: space.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>{current.packageDetails?.name || "Membership"}</Body>
                <Caption style={{ marginTop: 2 }}>{current.orderNumber}</Caption>
              </View>
              <Pill
                label={frozen ? "paused" : current.status === "past_due" ? "payment due" : current.status}
                tone={frozen ? "warn" : current.status === "active" ? "good" : current.status === "expired" || current.status === "cancelled" ? "bad" : "neutral"}
              />
            </View>

            <Divider />

            {current.packageDetails ? (
              <Line label="Price" value={`${money(current.packageDetails.price, current.packageDetails.currency)} / ${current.packageDetails.period}`} />
            ) : null}
            {current.subscription?.startDate ? <Line label="Started" value={longDate(current.subscription.startDate)} /> : null}
            {current.subscription?.endDate ? (
              <Line
                label={["expired", "cancelled"].includes(current.status) ? "Ended" : "Runs until"}
                value={`${longDate(current.subscription.endDate)} · ${relativeDays(current.subscription.endDate)}`}
              />
            ) : null}
            {current.packageDetails?.sessions ? (
              <Line label="Sessions" value={`${current.sessions?.used || 0} used of ${current.sessions?.total || 0}`} />
            ) : null}
            {frozen && current.freeze?.resumeAt ? <Line label="Starts again" value={longDate(current.freeze.resumeAt)} /> : null}
            <Line label="Payment" value={`${current.payment?.status || "—"}${current.payment?.method ? ` · ${current.payment.method}` : ""}`} />
            {current.subscription?.autoRenew && !stopping ? <Line label="Renews automatically" value="yes" /> : null}
          </Card>

          {stopping ? (
            <Notice tone="warn">
              This membership will not renew. You keep access until {longDate(current.subscription?.endDate)}.
            </Notice>
          ) : null}

          {(current.packageDetails?.features || []).length > 0 ? (
            <Card style={{ marginBottom: space.lg }}>
              <Heading>What it includes</Heading>
              {current.packageDetails.features.map((f) => (
                <View key={f} style={{ flexDirection: "row", gap: space.sm, marginBottom: 6 }}>
                  <Body style={{ color: p.accent }}>•</Body>
                  <Body style={{ flex: 1 }}>{f}</Body>
                </View>
              ))}
            </Card>
          ) : null}

          {/* What the member may do themselves. */}
          {live ? (
            <View style={{ gap: space.sm, marginBottom: space.xl }}>
              {frozen ? (
                <Button
                  label="Start my membership again"
                  variant="secondary"
                  busy={busy === "Start my membership again"}
                  onPress={() => act("Start my membership again", `/api/gymfolio/package-orders/${current._id}/unfreeze`)}
                />
              ) : r?.allowMemberFreeze ? (
                pausing ? (
                  <Card>
                    <Heading>Pause for how long?</Heading>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                      {freezeChoices(r.maxFreezeDays || 30).map((days) => (
                        <Pressable
                          key={days}
                          onPress={() => pauseFor(days)}
                          style={({ pressed }) => ({
                            backgroundColor: pressed ? p.accentDark : p.accent,
                            borderRadius: radius.pill,
                            paddingHorizontal: space.lg,
                            paddingVertical: 10,
                          })}
                        >
                          <Body style={{ color: p.onAccent, fontWeight: "700", fontSize: 14 }}>{days} days</Body>
                        </Pressable>
                      ))}
                    </View>
                    <Caption style={{ marginTop: space.md }}>
                      The days you pause are added on to your end date. Your gym allows up to {r.maxFreezeDays || 30} days.
                    </Caption>
                    <Button label="Never mind" variant="quiet" onPress={() => setPausing(false)} style={{ marginTop: space.sm }} />
                  </Card>
                ) : (
                  <Button label="Pause my membership" variant="secondary" busy={busy === "Pause my membership"} onPress={() => setPausing(true)} />
                )
              ) : null}

              {stopping ? (
                <Button
                  label="Keep my membership"
                  variant="secondary"
                  busy={busy === "Keep my membership"}
                  onPress={() => act("Keep my membership", `/api/gymfolio/package-orders/${current._id}/resume`)}
                />
              ) : r?.allowMemberCancel ? (
                <Button
                  label="Cancel my membership"
                  variant="danger"
                  busy={busy === "Cancel my membership"}
                  onPress={() =>
                    act(
                      "Cancel my membership",
                      `/api/gymfolio/package-orders/${current._id}/cancel`,
                      undefined,
                      `You keep access until ${longDate(current.subscription?.endDate)} and it will not renew after that.`
                    )
                  }
                />
              ) : null}

              {!r?.allowMemberFreeze && !r?.allowMemberCancel && !frozen && !stopping ? (
                <Caption>Your gym handles pauses and cancellations at the front desk.</Caption>
              ) : null}
            </View>
          ) : null}
        </>
      )}

      {past.length > 0 ? (
        <>
          <Heading>Earlier memberships</Heading>
          <View style={{ gap: space.sm, marginBottom: space.xl }}>
            {past.map((o) => (
              <Card key={o._id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "600" }}>{o.packageDetails?.name || o.orderNumber}</Body>
                    <Caption style={{ marginTop: 2 }}>
                      {o.subscription?.endDate ? `ended ${longDate(o.subscription.endDate)}` : longDate(o.createdAt)}
                    </Caption>
                  </View>
                  <Pill label={o.status} tone={o.status === "cancelled" ? "bad" : "neutral"} />
                </View>
              </Card>
            ))}
          </View>
        </>
      ) : null}

      {/* What else the gym sells, so a member can ask for it by name. */}
      {(onSale.data?.data || []).length > 0 ? (
        <>
          <Heading>What your gym offers</Heading>
          <View style={{ gap: space.sm }}>
            {(onSale.data?.data || []).map((pkg) => (
              <Card key={pkg._id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{pkg.name}</Body>
                    {pkg.supportingText ? <Caption style={{ marginTop: 2 }}>{pkg.supportingText}</Caption> : null}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Body style={{ fontWeight: "800" }}>{money(pkg.price, pkg.currency)}</Body>
                    <Caption>per {pkg.period}</Caption>
                  </View>
                </View>
              </Card>
            ))}
            <Caption style={{ marginTop: space.sm }}>To change what you are on, speak to the front desk or use your gym&apos;s website.</Caption>
          </View>
        </>
      ) : null}
    </Screen>
  );
}
