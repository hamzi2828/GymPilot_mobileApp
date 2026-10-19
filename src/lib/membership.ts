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
//   due       -- a renewal the gym set up before the current term ends, with
//                a payment link to pay it online: shown as "Payment due",
//                with Pay now.
//   ended     -- paid for once and over now: the history.
//
// An unpaid online checkout is none of these, and is not shown at all.

import { daysUntil } from "@/lib/format";
import type { MembershipOrder } from "@/lib/types";

/** Where on the gym's website these things live: buying a plan happens there. */
export const SITE_PACKAGES = "/packages";
/** The account page, for invoice PDFs. (The card is changed from the app: see openBilling on the Membership tab.) */
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

/**
 * What is still owed on an order the desk let the member pay for in parts.
 * Such an order stays 'paid' -- that is what keeps the door open -- so the
 * payment status alone would tell a member they are paid up when they are
 * not. 0 when nothing is owed.
 */
export function balanceOwing(o: MembershipOrder): number {
  const due = Number(o.payment?.balanceDue);
  return o.payment?.status === "paid" && Number.isFinite(due) && due > 0 ? due : 0;
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
 * Paid for online, on the payment provider's page: a Stripe or Safepay
 * checkout, or a renewal paid from its payment link.
 */
const ONLINE_METHODS = ["stripe", "safepay", "online"];

/**
 * Waiting on money that does not come through an online checkout: a bank
 * transfer (before or after the receipt is sent), or a sale the desk made
 * without taking payment yet. An unpaid online checkout is left out on
 * purpose -- it is either still open in a browser or abandoned, and the
 * member has nothing to do about it here -- and a renewal with a payment
 * link is "due" (paymentDue), paid from the app, not at the desk.
 */
export function awaitingPayment(orders: MembershipOrder[]): MembershipOrder[] {
  return orders.filter(
    (o) =>
      o.status === "pending" &&
      !ONLINE_METHODS.includes(o.payment?.method) &&
      !o.pay_link_url &&
      ["pending", "processing"].includes(o.payment?.status)
  );
}

/**
 * Renewals waiting to be paid from their payment link, soonest due first.
 * The server sets one up shortly before the current term ends, reminds the
 * member about it, and puts the link on it (`pay_link_url`) for as long as it
 * can still be paid; once it is paid it is an ordinary live order.
 */
export function paymentDue(orders: MembershipOrder[]): MembershipOrder[] {
  const dueAt = (o: MembershipOrder) => {
    const at = new Date(payDates(o).dueDate || "").getTime();
    return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
  };
  return orders.filter((o) => !!o.pay_link_url && o.status === "pending" && o.payment?.status !== "paid").sort((a, b) => dueAt(a) - dueAt(b));
}

/**
 * When a renewal is due and the last day to pay it, as the server keeps them
 * on the order. A bare date ("2026-10-22") is read as that day on the phone,
 * not as midnight UTC, which is still the day before anywhere west of it.
 */
export function payDates(o: MembershipOrder): { dueDate: string | null; lastDay: string | null } {
  const day = (v: string | undefined) => (!v ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
  return { dueDate: day(o.metadata?.dueDate), lastDay: day(o.metadata?.lastDay) };
}

/**
 * Where a due renewal stands today: still to come, due today, past its due
 * date ("overdue"), or past the last day to pay as well ("late") -- which the
 * link may still pay for a few days, until the server takes it off.
 */
export function dueStage(o: MembershipOrder, now: number): "soon" | "today" | "overdue" | "late" {
  const { dueDate, lastDay } = payDates(o);
  const toDue = daysUntil(dueDate, now);
  const toLast = daysUntil(lastDay, now);
  if (toLast !== null && toLast < 0) return "late";
  if (toDue === null || toDue > 0) return "soon";
  return toDue === 0 ? "today" : "overdue";
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

/** Staff turned the bank transfer receipt down; the order is closed. */
export function transferRejected(o: MembershipOrder): boolean {
  return o.payment?.method === "bank_transfer" && o.payment?.status === "failed";
}

/** How long a receipt staff turned down stays on the Membership tab. */
const REJECTION_SHOWN_MS = 30 * 86_400_000;

/**
 * Turned down in the last month, counted from when staff turned it down --
 * an order can sit for weeks before anyone looks at its receipt -- or from
 * the order date on an order that never recorded when.
 */
export function rejectedRecently(o: MembershipOrder, now: number): boolean {
  if (!transferRejected(o)) return false;
  const at = new Date(o.payment?.proof?.reviewedAt || o.createdAt).getTime();
  return Number.isFinite(at) && now - at < REJECTION_SHOWN_MS;
}

/** What to tell the member about a receipt staff did not accept, with their reason. */
export function rejectionMessage(o: MembershipOrder): string {
  const reason = (o.payment?.proof?.rejectionReason || "").trim().replace(/[.\s]+$/, "");
  return `Payment not accepted${reason ? `: ${reason}` : ""}. Please contact the gym, or choose the package again and upload a new receipt.`;
}

/** What the member's own copy of the membership says it is, and how worried to look. */
export function statusPill(o: MembershipOrder): { label: string; tone: "neutral" | "good" | "warn" | "bad" } {
  if (o.status === "frozen" || o.freeze?.isFrozen) return { label: "paused", tone: "warn" };
  if (o.status === "past_due") return { label: "payment failed", tone: "bad" };
  if (o.status === "active") return { label: "active", tone: "good" };
  if (transferRejected(o)) return { label: "payment not accepted", tone: "bad" };
  if (o.payment?.status === "refunded") return { label: "refunded", tone: "neutral" };
  return { label: o.status, tone: o.status === "cancelled" ? "bad" : "neutral" };
}

/** The label for a live membership's end date: what happens on that day. */
export function endDateLabel(o: MembershipOrder): string {
  if (o.status === "past_due") return "Paid until";
  return renewsAutomatically(o) ? "Renews automatically on" : "Runs until";
}
