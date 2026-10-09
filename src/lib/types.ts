// The shapes the API actually returns, written down once so the screens do
// not each guess at them. Field names match the server exactly.

export interface ThemeTokens {
  accent: string;
  accentDark: string;
  accentSoft: string;
  onAccent: string;
  base: string;
  surface: string;
}

export interface Branding {
  gym: { slug: string; name: string } | null;
  siteName: string;
  /** The gym's website: where plans are bought and invoices live. */
  siteUrl: string;
  logoUrl: string;
  logoWidth: number;
  logoHeight: number;
  theme: string;
  themeName: string;
  themeTokens: ThemeTokens;
  currency: string;
  locale: { language: string; direction: "ltr" | "rtl" };
  /** How to reach the gym, when Settings carries it. */
  supportEmail: string;
  phone: string;
  contact: { email: string; phone: string; address: string };
  openingHours: { day: string; open: string; close: string; closed: boolean }[];
  whatsapp: string;
}

export interface Member {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  avatarUrl: string;
  dateOfBirth: string | null;
  isStaff: boolean;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  user?: Member;
  gym?: { slug: string; name: string };
  branding?: Branding;
  requires2fa?: boolean;
  challengeId?: string;
  message?: string;
}

/** GET /api/attendance/me */
export interface AttendanceSummary {
  visits: number;
  days_present: number;
  total_minutes: number;
  total_label: string;
  average_label: string | null;
  first_visit_label: string | null;
  last_visit_label: string | null;
  streak_days: number;
  this_month: { label: string; visits: number; minutes: number; total_label: string };
  checked_in_now: boolean;
}

export interface Visit {
  id: string;
  shift_date: string;
  date_label: string;
  day_name: string;
  check_in_time: string;
  /** null until they check out, and for good on a visit that never had one. */
  check_out_time: string | null;
  still_in: boolean;
  /** Ended without a check-out (closed by the daily job, or past the window): no time out and no duration. */
  no_check_out?: boolean;
  minutes: number | null;
  duration_label: string | null;
  package_name: string;
  status: string;
  status_label: string;
  /** Corrected by the gym after the fact. Not sent by every server yet. */
  edited?: boolean;
  /** Struck out by the gym: not a visit at all. Not sent by every server yet. */
  voided?: boolean;
}

export interface AttendanceMonth {
  key: string;
  label: string;
  visits: number;
  days: number;
  minutes: number;
  total_label: string;
  average_label: string | null;
  packages: string[];
}

export interface AttendanceResponse {
  success: boolean;
  timezone: string;
  today: string;
  summary: AttendanceSummary;
  /** Only when ?month=YYYY-MM was asked for. */
  selected_month: AttendanceMonth | null;
  months: AttendanceMonth[];
  visits: Visit[];
  note: string | null;
}

/** GET /api/attendance/me/qr */
export interface CheckInCode {
  token: string;
  expires_at: string;
  person_type: "member" | "staff";
  code: string;
  name: string;
}

/** GET /api/gymfolio/timetable → data[] */
export interface Session {
  class_id: string;
  class_name: string;
  class_slug: string;
  date: string;
  weekday: string;
  start_time: string;
  end_time: string;
  instructor_name: string;
  room: string;
  capacity: number;
  /** null when the gym never set one on the class. */
  duration_minutes: number | null;
  difficulty: string;
  starts_at: string;
  is_cancelled: boolean;
  is_substitute: boolean;
  change_note: string;
  booked_count: number;
  waitlist_count: number;
  spots_left: number;
  is_full: boolean;
  is_closed: boolean;
  can_book: boolean;
  my_booking: { id: string; status: string; waitlist_position?: number } | null;
}

export interface BookingRules {
  horizon_days: number;
  cutoff_minutes: number;
  cancel_hours: number;
  require_active_membership: boolean;
  use_credits: boolean;
}

export interface TimetableResponse {
  success: boolean;
  range: { from: string; to: string; today: string };
  timezone: string;
  rules: BookingRules;
  data: Session[];
}

/** GET /api/gymfolio/bookings/me?scope=past → data[] */
export interface BookingRecord {
  id: string;
  class_id: string;
  class_name: string;
  date: string;
  start_time: string;
  end_time: string;
  instructor_name: string;
  status: string;
  waitlist_position: number | null;
  credit_used: boolean;
  late_cancel: boolean;
  created_at: string;
  cancelled_at: string | null;
  attended_at: string | null;
}

export interface BookingsResponse {
  success: boolean;
  rules: BookingRules;
  data: BookingRecord[];
  counts: { upcoming: number };
}

/** GET /api/gymfolio/package-orders/me → data[] */
export interface MembershipOrder {
  _id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  packageDetails: {
    name: string;
    price: string;
    currency: string;
    period: string;
    features: string[];
    kind: string;
    sessions: number;
    durationDays: number;
  };
  subscription: {
    startDate: string | null;
    endDate: string | null;
    isActive: boolean;
    /** Already true on a card checkout before it is paid: see renewsAutomatically in lib/membership. */
    autoRenew: boolean;
    cancelAtPeriodEnd: boolean;
    /** Stripe's own status for the subscription behind the order ('canceled' once it has ended); '' when there is none. */
    stripeStatus?: string;
  };
  sessions: { total: number; used: number };
  freeze: { isFrozen: boolean; frozenAt: string | null; resumeAt: string | null; totalFrozenDays: number };
  payment: {
    /** pending | processing | paid | failed | refunded | cancelled */
    status: string;
    /** stripe (online card checkout) | card (desk terminal) | bank_transfer | cash */
    method: string;
    amount: number;
    currency: string;
    /**
     * A membership sold at the desk may be paid for in parts. It keeps status
     * 'paid' while it is, so these two are the only sign that money is still
     * owed: what has arrived so far (null on an order paid in one go), and
     * what is left.
     */
    amountPaid?: number | null;
    balanceDue?: number;
    /** Only an order with a Stripe subscription behind it renews by itself. */
    stripeSubscriptionId?: string | null;
    /** Why the last charge failed, on a past-due membership. */
    lastPaymentError?: string;
  };
  invoice?: { number?: string } | null;
}

/** GET /api/gymfolio/packages/active → data[] */
export interface PackageOnSale {
  _id: string;
  name: string;
  price: string;
  currency: string;
  period: string;
  features: string[];
  kind: string;
  sessions: number;
  badge?: string;
  supportingText?: string;
}

/** GET /userDetailForProfile → data (and PUT /update/user → data) */
export interface Profile {
  _id: string;
  username?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role?: string;
  avatarUrl?: string;
  gender?: string;
  dateOfBirth?: string | null;
  goals?: string;
  emergencyContact?: { name?: string; phone?: string; relationship?: string };
  addresses?: { _id?: string; address?: string; city?: string; state?: string; postalCode?: string; country?: string }[];
  employment?: { isStaff?: boolean };
  createdAt?: string;
}

/** GET /announcements/active → data[] */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: "members" | "public" | "all";
  tone: "info" | "success" | "warning";
  url: string;
  url_label: string;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
}

/** GET /user/notification-preferences → data */
export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  push: boolean;
  marketing: boolean;
}

export interface NotificationSettings {
  preferences: NotificationPreferences;
  phone: string;
  /** Which channels the gym can actually send on. */
  channels: { email: boolean; sms: boolean; whatsapp: boolean; push: boolean };
  push_public_key: string;
  push_devices: number;
}
