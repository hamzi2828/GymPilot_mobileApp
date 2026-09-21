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
| **Home**       | Check in, the gym's announcements, the membership at a glance, the next classes they booked, and how much they have trained. |
| **Classes**    | The gym's timetable, day by day. Book a class, join the waitlist when it is full, cancel a booking — with a warning when the cancel is a late one. |
| **Membership** | What they are on, what it costs, when it runs to, what it includes — pausing, restarting or cancelling it when their gym allows that — and a way to the website for plans and invoice PDFs. |
| **Profile**    | Their details, their sign-in username, notification switches, the gym's phone/email/website/opening hours, changing their password, signing out. |
| **Check in**   | A QR code the front desk scans, with a short countdown and a typed fallback number. |
| **Visits**     | Every visit the desk has recorded, month by month. |
| **Bookings**   | Every class they booked before today: attended, missed, cancelled, cancelled late. |

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

### Which gyms get the app

Sign-in also checks that the gym is entitled to the member app (the `member-app`
add-on on its GymPilot plan or subscription; a gym on no plan gets everything).
A gym without it answers `403 { code: "MEMBER_APP_NOT_INCLUDED" }` and the
sign-in screen shows the server's message. The check runs after the password,
so it cannot be used to find out which usernames exist.

### Two-factor sign-in

Accounts that switched on "sign in with an emailed code" (and all staff, when
the gym requires it) get a second step. The first call answers
`{ requires2fa: true, challengeId, gym: { slug } }` and the server emails a
six-digit code; the app shows a code screen and finishes with
`POST /api/mobile/auth/login/2fa { challengeId, code, gym }`, which returns the
same payload as a plain sign-in. A wrong code costs one of five tries and sends
nothing; "Send a new code" runs the first step again. Codes live ten minutes.

### Forgot password

"Forgot password?" on the sign-in screen asks for the username and posts it to
`POST /api/mobile/auth/forgot`. The server finds the gym, then sends the same
reset link the gym's website sends. The link opens on the website, where the
new password is chosen; the app has no reset page of its own. The answer is
always the same generic 200, whether or not the username exists.

### When a session ends

The server marks every refused token with a `code` — `TOKEN_MISSING`,
`TOKEN_INVALID`, `TOKEN_WRONG_GYM` or `SESSION_ENDED` (the account was
deactivated, or signed out everywhere). Only those sign the member out; the
sign-in screen then shows the server's reason. Any other 401 — a wrong current
password, a wrong 2FA code — is shown where it happened and the session stays.
A suspended gym, or one whose subscription lapsed, shows one notice on Home
with a Sign out button rather than an error under every section.

## How it gets the gym's look

The same colour scheme the gym picks under **Settings → Colour Scheme** in the
admin panel. Sign-in returns the gym's logo and six colour tokens (`accent`,
`accentDark`, `accentSoft`, `onAccent`, `base`, `surface`); `src/lib/theme.ts`
derives the rest of the palette from them and every component paints from
`usePalette()`. Nothing in the app hard-codes a colour.

Branding also carries `siteUrl` (the gym's website — the registered domain,
else `<slug>.<platform domain>`), and the gym's `phone` and `supportEmail` when
Settings has them. The website is where the app sends a member to buy or change
a plan (`/packages`) and to download invoice PDFs (`/user-detail?tab=history`):
the PDF route needs a website sign-in, so the app opens the account page in the
browser rather than the PDF directly.

If the gym changes its scheme, the app picks it up the next time the member
opens their profile (`GET /api/mobile/branding?gym=<slug>`), without a new
sign-in. A logo that fails to load falls back to the gym's initial.

## Push notifications

Expo's push service carries them, so a gym needs no keys of its own. After
sign-in (and on every launch with a session) the app asks for permission, gets
an Expo push token and registers it with
`POST /api/mobile/push/register { token, platform, deviceName }`; sign-out
sends `DELETE /api/mobile/push/register { token }`. The server keeps one row
per token in the gym's own database and sends to it wherever it already sends
web push — booking confirmations, reminders, campaigns — dropping tokens Expo
reports as `DeviceNotRegistered`.

Nothing is registered on the web build, on a simulator, or in a build whose
`app.json` still carries the `REPLACE_WITH_EAS_PROJECT_ID` placeholder (the
token is minted against the EAS project id — see **Building for the stores**).
Members switch channels on and off under **Profile → Notifications**
(`GET`/`PUT /user/notification-preferences`); announcements the gym puts up
(`GET /announcements/active`) appear at the top of Home.

---

## Running it

```bash
npm install
cp .env.example .env      # then set EXPO_PUBLIC_API_URL to your machine's LAN address
npm start                 # press a for Android, i for iOS, w for web
```

The backend must be running (`GymPilot_backend`, port 4000 by default). A phone
cannot reach `localhost`, so during development set `EXPO_PUBLIC_API_URL` to the
address Expo prints, e.g. `http://192.168.1.20:4000`. The sign-in screen shows
the address a development build is pointed at; store builds do not.

```bash
npm run typecheck   # tsc --noEmit
npm run lint
npx expo export --platform web --output-dir /tmp/expo-web   # proves it bundles
```

Requests give up after 20 seconds, so a server that never answers shows a
message rather than a spinner for good.

## Building for the stores

The identifiers are set: `app.gympilot.member` for both the iOS bundle id and
the Android package, phones only on iOS. `eas.json` carries three profiles —
`development` (dev client, internal), `preview` (internal) and `production`
(auto-incremented build numbers) — each with its own `EXPO_PUBLIC_API_URL`;
change the placeholder addresses before building.

1. `npm install -g eas-cli && eas login`
2. `eas init` — links the app to an EAS project and writes the real
   `extra.eas.projectId` into `app.json` in place of `REPLACE_WITH_EAS_PROJECT_ID`.
   Push tokens cannot be issued without it.
3. `eas credentials` — for Android push, upload an FCM V1 service account
   key; iOS push uses the APNs key EAS creates. Both are stored on EAS, not in
   this repo.
4. `eas build --profile preview --platform all` for a build to hand to testers;
   `eas build --profile production --platform all` then `eas submit` for the
   stores.

The icons under `assets/images` and `assets/expo.icon` are still placeholders
and want replacing before a store submission.

---

## Layout

```
src/
  app/                    expo-router: the file tree is the navigation
    _layout.tsx           session provider, stack, status bar
    index.tsx             signed in? → tabs, otherwise → login
    login.tsx             username + password, the 2FA code step, no sign-up
    forgot.tsx            username → reset link by email
    checkin.tsx           the QR code for the front desk
    attendance.tsx        every recorded visit
    bookings.tsx          every past class booking
    (tabs)/               home, classes, membership, profile
  components/
    Screen.tsx            safe area, pull to refresh, the gym's logo
    ui.tsx                the pieces every screen is built from
    icons.tsx             tab icons, drawn rather than shipped as a font
  lib/
    api.ts                one fetch, both headers, one error type, the 20 s timeout
    session.tsx           who is signed in, their gym, its colours, why a session ended
    push.ts               permission, the Expo push token, register / unregister
    useRequireSession.ts  send a signed-out member to the sign-in screen
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
| `POST /api/mobile/auth/login` | username + password → token, gym, branding (or `requires2fa` + `challengeId`) |
| `POST /api/mobile/auth/login/2fa` | challengeId + code + gym → the same payload as sign-in |
| `POST /api/mobile/auth/forgot` | username → the website's reset email; always 200 |
| `GET /api/mobile/branding?gym=` | logo, colours, site address and contact details, refreshed later |
| `POST` · `DELETE /api/mobile/push/register` | this phone's Expo push token, on sign-in and sign-out |
| `GET /userDetailForProfile` · `PUT /update/user` · `PUT /user/change-password` | the member's own record (these sit at the server root, not under `/api`) |
| `GET` · `PUT /user/notification-preferences` · `GET /announcements/active` | how they want to hear from the gym, and what the gym is saying (also at the root) |
| `GET /api/attendance/me` · `GET /api/attendance/me/qr` | visits, and the check-in code |
| `GET /api/gymfolio/timetable` · `POST /api/gymfolio/bookings` · `DELETE /api/gymfolio/bookings/:id` · `GET /api/gymfolio/bookings/me?scope=past` | classes, and the booking history |
| `GET /api/gymfolio/package-orders/me` · `GET /api/gymfolio/membership/rules` · `GET /api/gymfolio/packages/active` | the membership |
| `POST /api/gymfolio/package-orders/:id/{freeze,unfreeze,cancel,resume}` | pausing, cancelling, and undoing a cancellation |

The server decides what a member may do — how far ahead they can book, whether
they may pause or cancel at all — and the app shows what it is told.
