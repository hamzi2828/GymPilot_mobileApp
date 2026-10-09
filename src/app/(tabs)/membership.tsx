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
//
// Buying and renewing stay on the gym's website: taking a first payment is
// the website's job. Changing the card is not -- that happens on the payment
// provider's own billing page, and the server hands the app a link to it
// (POST .../billing-portal), so a failed renewal is fixed from here with no
// second sign-in. The invoice PDF is the one thing left behind: its route
// wants the sign-in sent as a header, which a browser cannot do, so that
// link still opens the website's account page.
//
// Which order is "the membership" is decided in lib/membership: only a paid,
// live one. A bank transfer still waiting is shown on its own, and a card
// checkout that was never paid is not shown at all.

import React, { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Screen } from "@/components/Screen";
import { Body, Button, Caption, Card, Divider, Empty, GymClosed, Heading, Line, LoadFailed, Loading, Notice, Pill } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { longDate, money, relativeDays } from "@/lib/format";
import {
  awaitingPayment,
  balanceOwing,
  currentMembership,
  endDateLabel,
  endedMemberships,
  isLive,
  renewsAutomatically,
  SITE_ACCOUNT_HISTORY,
  SITE_PACKAGES,
  siteBankTransfer,
  startsLater,
  statusPill,
} from "@/lib/membership";
import { openWeb, webAddress } from "@/lib/open";
import { usePalette, useSession } from "@/lib/session";
import { radius, space } from "@/lib/theme";
import { useGymClosed, useLoad } from "@/lib/useLoad";
import type { MembershipOrder, PackageOnSale } from "@/lib/types";

interface Rules {
  allowMemberFreeze: boolean;
  maxFreezeDays: number;
  allowMemberCancel: boolean;
}

// Why a card membership cannot be paused, in words for the member: the
// server's own message is written for the gym's staff (it points at Stripe).
// Any other refusal is shown as the server words it.
const PAUSE_REFUSED: Record<string, string> = {
  FREEZE_PAYMENT_OUTSTANDING: "Your last card payment didn't go through. Update your card first, then pause.",
  FREEZE_STRIPE_PAUSED: "Your membership can't be paused from the app right now. Please ask at the front desk.",
  FREEZE_STRIPE_UNSUPPORTED: "Your membership can't be paused from the app right now. Please ask at the front desk.",
};

export default function Membership() {
  const { session, signOut, branding } = useSession();
  const p = usePalette();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pausing, setPausing] = useState(false);

  const orders = useLoad<{ data: MembershipOrder[] }>("/api/gymfolio/package-orders/me?limit=20");
  const rules = useLoad<{ data: Rules }>("/api/gymfolio/membership/rules");
  const onSale = useLoad<{ data: PackageOnSale[] }>("/api/gymfolio/packages/active");
  const closed = useGymClosed(orders, rules);
  const reload = () => {
    closed.clear();
    orders.reload();
    rules.reload();
    onSale.reload();
  };

  const list = orders.data?.data || [];
  const current = currentMembership(list);
  // A session pack alongside the membership, or a renewal bought early.
  const alsoLive = list.filter((o) => o !== current && isLive(o));
  const waiting = awaitingPayment(list);
  const past = endedMemberships(list);
  const r = rules.data?.data;

  const frozen = !!current && (current.status === "frozen" || !!current.freeze?.isFrozen);
  const pastDue = current?.status === "past_due";
  const stopping = !!current?.subscription?.cancelAtPeriodEnd;
  const renews = !!current && renewsAutomatically(current);
  const owing = current ? balanceOwing(current) : 0;

  const siteUrl = branding?.siteUrl || "";
  const openSite = (path: string) => {
    if (siteUrl) openWeb(webAddress(siteUrl, path));
  };

  // One thing at a time: from the first tap -- the "are you sure?" included
  // -- until the server has answered, every other action waits. `busy` only
  // changes on the next draw, so the ref is what a quick second tap meets.
  const acting = useRef(false);

  const act = async (label: string, path: string, body?: unknown, confirmText?: string) => {
    if (acting.current) return;
    acting.current = true;
    try {
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
      const res = await api<{ message?: string }>(path, { method: "POST", session, onUnauthorised: signOut, body });
      setMessage({ tone: "ok", text: res.message || "Done." });
      orders.reload();
    } catch (e) {
      if (closed.caught(e)) return;
      const refused = e instanceof ApiError && e.code ? PAUSE_REFUSED[e.code] : undefined;
      setMessage({ tone: "error", text: refused || (e instanceof ApiError || e instanceof Error ? e.message : "That did not work.") });
    } finally {
      acting.current = false;
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

  // The card behind a membership that renews by itself is changed on the
  // payment provider's own page. The server makes a link to it that is good
  // for this member and this order only, and it opens over the app: no
  // website, and no second sign-in. When the browser closes, the list is
  // read again -- a new card usually clears a failed payment within moments.
  const CARD = "Update my card";
  const openBilling = async (o: MembershipOrder) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(CARD);
    setMessage(null);
    try {
      const res = await api<{ url?: string }>(`/api/gymfolio/package-orders/${o._id}/billing-portal`, { method: "POST", session, onUnauthorised: signOut });
      if (!res.url) throw new Error("Your card page could not be opened just now. Please try again, or ask at the front desk.");
      await openWeb(res.url);
      orders.reload();
    } catch (e) {
      if (closed.caught(e)) return;
      setMessage({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "Your card page could not be opened just now." });
    } finally {
      acting.current = false;
      setBusy(null);
    }
  };

  // The invoice PDF needs the website's own sign-in, so the link goes to the
  // account page there, where every invoice can be downloaded.
  const invoiceLink = (o: MembershipOrder) =>
    o.payment?.status === "paid" && siteUrl ? (
      <Pressable
        onPress={() => openSite(SITE_ACCOUNT_HISTORY)}
        hitSlop={8}
        accessibilityRole="link"
        accessibilityLabel={`Invoice for ${o.packageDetails?.name || o.orderNumber}, on your gym's website`}
        style={{ marginTop: space.sm, alignSelf: "flex-start" }}
      >
        <Body style={{ color: p.accent, fontWeight: "700", fontSize: 14 }}>Invoice PDF on the website ›</Body>
      </Pressable>
    ) : null;

  // One line per membership that is not the main one: live alongside it, or
  // over.
  const orderRow = (o: MembershipOrder) => {
    const pill = statusPill(o);
    const end = o.subscription?.endDate;
    const when = !isLive(o)
      ? end
        ? `ended ${longDate(end)}`
        : longDate(o.createdAt)
      : startsLater(o)
        ? `starts ${longDate(o.subscription?.startDate)}`
        : end
          ? `${endDateLabel(o).toLowerCase()} ${longDate(end)}`
          : "";
    return (
      <Card key={o._id}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: "600" }}>{o.packageDetails?.name || o.orderNumber}</Body>
            {when ? <Caption style={{ marginTop: 2 }}>{when}</Caption> : null}
            {balanceOwing(o) > 0 ? (
              <Caption style={{ marginTop: 2, color: p.warning }}>{money(balanceOwing(o), o.payment.currency)} still to pay at the front desk</Caption>
            ) : null}
          </View>
          <Pill label={pill.label} tone={pill.tone} />
        </View>
        {invoiceLink(o)}
      </Card>
    );
  };

  // Bought, but the money has not arrived yet. For a bank transfer the
  // website has the gym's bank details and takes the receipt; anything else
  // unpaid was a sale at the desk, and is paid there.
  const awaitingCard = (o: MembershipOrder) => {
    const transfer = o.payment?.method === "bank_transfer";
    const receiptSent = o.payment?.status === "processing";
    return (
      <Card key={o._id}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: "700" }}>{o.packageDetails?.name || "Membership"}</Body>
            <Caption style={{ marginTop: 2 }}>{o.orderNumber}</Caption>
          </View>
          <Pill label="awaiting payment" tone="warn" />
        </View>
        <Divider />
        {o.payment ? <Line label="Amount" value={money(o.payment.amount, o.payment.currency)} /> : null}
        <Caption style={{ marginTop: space.sm }}>
          {!transfer
            ? "Not paid yet. Pay at the front desk to start it."
            : receiptSent
              ? "We have your transfer details and are confirming the payment. Your membership starts once it clears."
              : `Send the transfer with ${o.orderNumber} as the reference, then send the gym your receipt from the website.`}
        </Caption>
        {transfer && siteUrl ? (
          <Pressable onPress={() => openSite(siteBankTransfer(o._id))} hitSlop={8} style={{ marginTop: space.sm, alignSelf: "flex-start" }}>
            <Body style={{ color: p.accent, fontWeight: "700", fontSize: 14 }}>{receiptSent ? "Transfer details ›" : "Bank details and receipt ›"}</Body>
          </Pressable>
        ) : null}
      </Card>
    );
  };

  if (closed.message) {
    return (
      <Screen title="Membership" refreshing={orders.refreshing} onRefresh={reload}>
        <GymClosed message={closed.message} />
      </Screen>
    );
  }

  return (
    <Screen title="Membership" refreshing={orders.refreshing} onRefresh={reload}>
      {message ? <Notice tone={message.tone === "ok" ? "ok" : "error"}>{message.text}</Notice> : null}
      {orders.error && orders.data ? <Notice tone="error">{orders.error}</Notice> : null}

      {orders.loading ? (
        <Loading />
      ) : orders.error && !orders.data ? (
        // The list never arrived: that is the truth, not "no membership".
        <View style={{ marginBottom: space.xl }}>
          <LoadFailed message={orders.error} onRetry={reload} />
        </View>
      ) : !current ? (
        // Nothing live. A transfer still waiting says so below; otherwise say
        // plainly there is no membership and where to get one.
        waiting.length > 0 ? null : (
          <>
            <Empty
              title={past.length > 0 ? "Your membership has ended" : "You do not have a membership yet"}
              hint={
                past.length > 0
                  ? "Renew on your gym's website, or ask at the front desk."
                  : "The front desk can set one up for you, or you can join from your gym's website."
              }
            />
            {siteUrl ? <Button label="See plans on the website" onPress={() => openSite(SITE_PACKAGES)} style={{ marginTop: space.lg, marginBottom: space.xl }} /> : null}
          </>
        )
      ) : (
        <>
          <Card style={{ marginBottom: space.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>{current.packageDetails?.name || "Membership"}</Body>
                <Caption style={{ marginTop: 2 }}>{current.orderNumber}</Caption>
              </View>
              <Pill label={statusPill(current).label} tone={statusPill(current).tone} />
            </View>

            <Divider />

            {current.packageDetails ? (
              <Line label="Price" value={`${money(current.packageDetails.price, current.packageDetails.currency)} / ${current.packageDetails.period}`} />
            ) : null}
            {current.subscription?.startDate ? <Line label="Started" value={longDate(current.subscription.startDate)} /> : null}
            {current.subscription?.endDate ? (
              <Line label={endDateLabel(current)} value={`${longDate(current.subscription.endDate)} · ${relativeDays(current.subscription.endDate)}`} />
            ) : null}
            {current.packageDetails?.sessions ? (
              <Line label="Sessions" value={`${current.sessions?.used || 0} used of ${current.sessions?.total || 0}`} />
            ) : null}
            {frozen && current.freeze?.resumeAt ? <Line label="Starts again" value={longDate(current.freeze.resumeAt)} /> : null}
            {/* Past due keeps payment.status 'paid' -- that is the first
                payment -- so the renewal that failed is said here instead. */}
            <Line
              label="Payment"
              value={`${pastDue ? "failed" : owing > 0 ? "part paid" : current.payment?.status || "—"}${current.payment?.method ? ` · ${current.payment.method}` : ""}`}
            />
            {/* Paid for in parts: the order still says 'paid', so the money
                left to pay is said in so many words. */}
            {owing > 0 && current.payment?.amountPaid != null ? (
              <Line label="Paid so far" value={money(current.payment.amountPaid, current.payment.currency)} />
            ) : null}
            {owing > 0 ? (
              <Line label="Still to pay" value={<Body style={{ color: p.warning, fontWeight: "800", fontSize: 14 }}>{money(owing, current.payment.currency)}</Body>} />
            ) : null}
            {invoiceLink(current)}
            {/* Paid by a card that is charged again by itself: the card can
                be changed before it ever fails. */}
            {current.payment?.stripeSubscriptionId && !pastDue ? (
              <Pressable
                onPress={() => openBilling(current)}
                disabled={!!busy}
                hitSlop={8}
                accessibilityRole="link"
                style={{ marginTop: space.sm, alignSelf: "flex-start", opacity: busy ? 0.5 : 1 }}
              >
                <Body style={{ color: p.accent, fontWeight: "700", fontSize: 14 }}>Change my card ›</Body>
              </Pressable>
            ) : null}
          </Card>

          {owing > 0 ? (
            <Notice tone="warn">
              You still have {money(owing, current.payment.currency)} to pay on this membership. Pay it at the front desk.
            </Notice>
          ) : null}

          {/* A renewal the card could not pay for. Stripe keeps retrying; the
              new card goes in on its billing page, opened from here. */}
          {pastDue ? (
            <>
              <Notice tone="error">
                Payment failed — update your card to keep your membership.
                {current.payment?.lastPaymentError ? ` (${current.payment.lastPaymentError})` : ""}
              </Notice>
              <Button label={CARD} busy={busy === CARD} disabled={!!busy} onPress={() => openBilling(current)} style={{ marginBottom: space.lg }} />
            </>
          ) : null}

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
          <View style={{ gap: space.sm, marginBottom: space.xl }}>
            {frozen ? (
              <Button
                label="Start my membership again"
                variant="secondary"
                busy={busy === "Start my membership again"}
                disabled={!!busy}
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
                <Button label="Pause my membership" variant="secondary" busy={busy === "Pause my membership"} disabled={!!busy} onPress={() => setPausing(true)} />
              )
            ) : null}

            {stopping ? (
              <Button
                label="Keep my membership"
                variant="secondary"
                busy={busy === "Keep my membership"}
                disabled={!!busy}
                onPress={() => act("Keep my membership", `/api/gymfolio/package-orders/${current._id}/resume`)}
              />
            ) : r?.allowMemberCancel ? (
              <Button
                label="Cancel my membership"
                variant="danger"
                busy={busy === "Cancel my membership"}
                disabled={!!busy}
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
        </>
      )}

      {waiting.length > 0 ? (
        <>
          <Heading>Awaiting payment confirmation</Heading>
          <View style={{ gap: space.sm, marginBottom: space.xl }}>{waiting.map(awaitingCard)}</View>
        </>
      ) : null}

      {alsoLive.length > 0 ? (
        <>
          <Heading>Also on your account</Heading>
          <View style={{ gap: space.sm, marginBottom: space.xl }}>{alsoLive.map(orderRow)}</View>
        </>
      ) : null}

      {past.length > 0 ? (
        <>
          <Heading>Earlier memberships</Heading>
          <View style={{ gap: space.sm, marginBottom: space.xl }}>{past.map(orderRow)}</View>
        </>
      ) : null}

      {/* What else the gym sells, so a member can ask for it by name -- or
          go and buy it, on the website, where paying happens. */}
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
            {/* A subscription renews itself, so there is nothing to renew by
                hand. With no membership at all, the button to buy one is
                already at the top of the screen. */}
            {!current ? null : siteUrl ? (
              <Button
                label={renews ? "Change your plan on the website" : "Renew or change your plan on the website"}
                variant="secondary"
                onPress={() => openSite(SITE_PACKAGES)}
                style={{ marginTop: space.sm }}
              />
            ) : (
              <Caption style={{ marginTop: space.sm }}>To change what you are on, speak to the front desk or use your gym&apos;s website.</Caption>
            )}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
