// Which of the member's orders is their membership, decided once so Home and
// the Membership tab cannot disagree.
//
// /package-orders/me sends every order the member ever started, newest
// first, and not all of them are memberships. A card checkout opened on the
// website and walked away from is an order too: 'pending' and never paid
// until Stripe says the session expired, then closed by the server
// (cancelled or expired, still unpaid). Showing one of those as "your
// membership" told a member they were on a plan they never bought. So an
// order is one of:
//
//   live      -- paid, in a status that grants access. The same test the
//                server uses (membershipExpiry.liveFilter), and what it will
//                accept a freeze or a cancel on.
//   awaiting  -- a bank transfer, or a sale the desk has not taken the money
//                for yet: shown on its own, as waiting, never as the
//                membership.
//   ended     -- paid for once and over now: the history.
//
// An unpaid card checkout is none of these, and is not shown at all.

import type { MembershipOrder } from "@/lib/types";

/** Where on the gym's website these things live: buying and paying happen there. */
export const SITE_PACKAGES = "/packages";
/** The account page: invoices, and the button that opens Stripe to change the card. */
export const SITE_ACCOUNT_HISTORY = "/user-detail?tab=history";
/** The bank details and the receipt upload for one order waiting on a transfer. */
export const siteBankTransfer = (orderId: string) => `/checkout/bank-transfer?order=${encodeURIComponent(orderId)}`;

/** Statuses that grant access, most relevant first. */
export const LIVE_STATUSES = ["active", "frozen", "past_due"];

/** Money arrived for it at some point, even if it has since gone back. */
const everPaid = (o: MembershipOrder) => o.payment?.status === "paid" || o.payment?.status === "refunded";

export function isLive(o: MembershipOrder): boolean {
  return o.payment?.status === "paid" && LIVE_STATUSES.includes(o.status);
}

/** A term still to begin: a renewal bought early is live from the day it is paid, but starts when the current one ends. */
export function startsLater(o: MembershipOrder, now = Date.now()): boolean {
  const start = o.subscription?.startDate ? new Date(o.subscription.startDate).getTime() : NaN;
  return start > now;
}

/**
 * The membership to show: live, active before paused before a failed card,
 * one already running before one still to start, and otherwise the newest
 * (the order the server sent them in).
 */
export function currentMembership(orders: MembershipOrder[], now = Date.now()): MembershipOrder | null {
  const rank = (o: MembershipOrder) => LIVE_STATUSES.indexOf(o.status) * 2 + (startsLater(o, now) ? 1 : 0);
  return orders.filter(isLive).reduce<MembershipOrder | null>((best, o) => (!best || rank(o) < rank(best) ? o : best), null);
}

/**
 * Waiting on money that does not come through Stripe Checkout: a bank
 * transfer (before or after the receipt is sent), or a sale the desk made
 * without taking payment yet. An unpaid card checkout is left out on
 * purpose -- it is either still open in a browser or abandoned, and the
 * member has nothing to do about it here.
 */
export function awaitingPayment(orders: MembershipOrder[]): MembershipOrder[] {
  return orders.filter(
    (o) => o.status === "pending" && o.payment?.method !== "stripe" && ["pending", "processing"].includes(o.payment?.status)
  );
}

/** Paid for once and not live now: expired, cancelled, refunded. */
export function endedMemberships(orders: MembershipOrder[]): MembershipOrder[] {
  return orders.filter((o) => everPaid(o) && !isLive(o));
}

/**
 * A Stripe subscription that will charge again by itself, so there is
 * nothing to renew by hand. Only a subscription does: a recurring package
 * paid by bank transfer or cash is a term that ends, and `autoRenew` is
 * already true on a card checkout before it has been paid.
 */
export function renewsAutomatically(o: MembershipOrder): boolean {
  return (
    isLive(o) &&
    !!o.payment?.stripeSubscriptionId &&
    !o.subscription?.cancelAtPeriodEnd &&
    o.subscription?.stripeStatus !== "canceled"
  );
}

/** What the member's own copy of the membership says it is, and how worried to look. */
export function statusPill(o: MembershipOrder): { label: string; tone: "neutral" | "good" | "warn" | "bad" } {
  if (o.status === "frozen" || o.freeze?.isFrozen) return { label: "paused", tone: "warn" };
  if (o.status === "past_due") return { label: "payment failed", tone: "bad" };
  if (o.status === "active") return { label: "active", tone: "good" };
  if (o.payment?.status === "refunded") return { label: "refunded", tone: "neutral" };
  return { label: o.status, tone: o.status === "cancelled" ? "bad" : "neutral" };
}

/** The label for a live membership's end date: what happens on that day. */
export function endDateLabel(o: MembershipOrder): string {
  if (o.status === "past_due") return "Paid until";
  return renewsAutomatically(o) ? "Renews automatically on" : "Runs until";
}
