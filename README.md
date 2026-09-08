# GymPilot — member app

One app for every gym running on GymPilot. A member downloads it, signs in with
the username and password their gym gave them, and from that moment the app is
**their gym's** app: its logo, its colours, its timetable, its packages.

There is no sign-up. A member exists because a gym put them on its books, so the
only way in is a username the gym issued.

---

## What a member can do

| Screen         | What it is for |
| -------------- | -------------- |
| **Home**       | Check in, see the membership at a glance, the next classes they booked, and how much they have trained. |
| **Classes**    | The gym's timetable, day by day. Book a class, join a waitlist, cancel a booking. |
| **Membership** | What they are on, what it costs, when it runs to, what it includes — and pausing, restarting or cancelling it, when their gym allows that. |
| **Profile**    | Their details, their sign-in username, the gym's phone/address/opening hours, changing their password, signing out. |
| **Check in**   | A QR code the front desk scans, with a short countdown and a typed fallback number. |
| **Visits**     | Every visit the desk has recorded, month by month. |

---

## How it knows which gym

GymPilot gives every gym its own database. The website knows which gym it is
from its domain; an app cannot, so the **username** does that job instead.

1. Every member gets a globally unique username when their account is created —
   name + a little of their email + three digits, e.g. `ayeshakhan375`. It is
   shown to staff at `/admin/users` and emailed to the member with their
   password.
2. Signing in posts that username to `POST /api/mobile/auth/login`, which is
   mounted **before** the per-gym gate. A platform-wide directory maps the
   username to its gym.
3. The reply carries a token, the gym's slug, and the gym's branding.
4. Every later call sends `Authorization: Bearer <token>` and
   `X-Tenant-Slug: <gym slug>`. The token records which gym it was issued for,
   so pointing it at another gym is refused — the header cannot be used to reach
   anybody else's data.

## How it gets the gym's look

The same colour scheme the gym picks under **Settings → Colour Scheme** in the
admin panel. Sign-in returns the gym's logo and six colour tokens (`accent`,
`accentDark`, `accentSoft`, `onAccent`, `base`, `surface`); `src/lib/theme.ts`
derives the rest of the palette from them and every component paints from
`usePalette()`. Nothing in the app hard-codes a colour.

If the gym changes its scheme, the app picks it up the next time the member
opens their profile (`GET /api/mobile/branding?gym=<slug>`), without a new
sign-in.

---

## Running it

```bash
npm install
cp .env.example .env      # then set EXPO_PUBLIC_API_URL to your machine's LAN address
npm start                 # press a for Android, i for iOS, w for web
```

The backend must be running (`GymPilot_backend`, port 4000 by default). A phone
cannot reach `localhost`, so during development set `EXPO_PUBLIC_API_URL` to the
address Expo prints, e.g. `http://192.168.1.20:4000`.

```bash
npm run typecheck   # tsc --noEmit
npm run lint
```

---

## Layout

```
src/
  app/                    expo-router: the file tree is the navigation
    _layout.tsx           session provider, stack, status bar
    index.tsx             signed in? → tabs, otherwise → login
    login.tsx             username + password, no sign-up
    checkin.tsx           the QR code for the front desk
    attendance.tsx        every recorded visit
    (tabs)/               home, classes, membership, profile
  components/
    Screen.tsx            safe area, pull to refresh, the gym's logo
    ui.tsx                the pieces every screen is built from
    icons.tsx             tab icons, drawn rather than shipped as a font
  lib/
    api.ts                one fetch, both headers, one error type
    session.tsx           who is signed in, their gym, its colours
    theme.ts              six tokens → a full palette
    types.ts              the shapes the API actually returns
    format.ts             money, dates, durations
    useLoad.ts            loading / error / refresh, reloaded on focus
    storage.ts            SecureStore on a device, localStorage on web
    config.ts             EXPO_PUBLIC_API_URL
```

## What it calls

Everything except sign-in is the gym's ordinary API, called with the token and
the tenant header:

| | |
| --- | --- |
| `POST /api/mobile/auth/login` | username + password → token, gym, branding |
| `GET /api/mobile/branding?gym=` | logo and colours, refreshed later |
| `GET /userDetailForProfile` · `PUT /update/user` · `PUT /user/change-password` | the member's own record (these sit at the server root, not under `/api`) |
| `GET /api/attendance/me` · `GET /api/attendance/me/qr` | visits, and the check-in code |
| `GET /api/gymfolio/timetable` · `POST /api/gymfolio/bookings` · `DELETE /api/gymfolio/bookings/:id` | classes |
| `GET /api/gymfolio/package-orders/me` · `GET /api/gymfolio/membership/rules` · `GET /api/gymfolio/packages/active` | the membership |
| `POST /api/gymfolio/package-orders/:id/{freeze,unfreeze,cancel,resume}` | pausing, cancelling, and undoing a cancellation |

The server decides what a member may do — how far ahead they can book, whether
they may pause or cancel at all — and the app shows what it is told.
