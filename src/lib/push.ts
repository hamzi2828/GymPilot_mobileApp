// Push notifications: telling the gym's server how to reach this phone, and
// what to open when a notification is tapped.
//
// Expo's push service does the carrying, so the gym needs no keys of its
// own. The app asks the phone for permission, gets an Expo push token for
// it, and registers that token with the gym after sign-in. Sign-out removes
// it again, so a phone handed to the next person does not keep hearing from
// the last one's gym.
//
// Three situations quietly do nothing: the web build (no push there), a
// simulator (no push service), and a build without an EAS project id -- the
// token is minted against that id, so until `eas init` has run there is
// nothing to register. See the README.

import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter, type Href } from "expo-router";
import { api, ApiError, type Session } from "./api";
import { getItem, removeItem, setItem } from "./storage";

// Which token this phone registered, and with which gym. Kept on the phone
// as well as in memory, so a sign-out can take it back even when this launch
// never got as far as registering (no signal on the way in, say) -- and so a
// removal that could not reach the server is tried again later rather than
// forgotten.
const PUSH_KEY = "gympilot.push";

interface Registration {
  token: string;
  gymSlug: string;
}

let registered: Registration | null = null;

async function storedRegistration(): Promise<Registration | null> {
  try {
    const raw = await getItem(PUSH_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Registration>) : null;
    return parsed && typeof parsed.token === "string" && typeof parsed.gymSlug === "string"
      ? { token: parsed.token, gymSlug: parsed.gymSlug }
      : null;
  } catch {
    return null;
  }
}

/** Forgets a registration -- unless a newer one has replaced it meanwhile. */
async function forget(r: Registration): Promise<void> {
  const kept = await storedRegistration();
  if (kept && kept.token === r.token && kept.gymSlug === r.gymSlug) await removeItem(PUSH_KEY);
}

/**
 * Asks the gym to stop sending to this phone. Needs no sign-in -- holding
 * the push token is the proof -- which is what lets it work after the server
 * has already ended the session, the usual reason for signing out. true when
 * the gym has let go of it (or never had it); false when it is worth trying
 * again later.
 */
async function release(r: Registration): Promise<boolean> {
  try {
    await api("/api/mobile/push/register", { method: "DELETE", gym: r.gymSlug, body: { token: r.token } });
    return true;
  } catch (e) {
    // No signal, or the server having a bad moment: try again later.
    // Anything else it answered is final.
    return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
  }
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  // app.json ships with a placeholder until `eas init` replaces it.
  return typeof id === "string" && id && !id.startsWith("REPLACE") ? id : null;
}

/** Whether this build, on this device, can receive push at all. */
export function pushSupported(): boolean {
  return Platform.OS !== "web" && Device.isDevice && projectId() !== null;
}

// How a notification behaves when it arrives with the app open: shown, but
// quietly -- a member reading the timetable does not need a sound.
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Asks for permission if it has not been given, then registers this phone
 * with the gym. Safe to call on every launch: the server keeps one row per
 * token and simply refreshes it.
 */
export async function registerForPush(session: Session): Promise<void> {
  const id = projectId();
  if (!id || !pushSupported()) return;

  let { granted } = await Notifications.getPermissionsAsync();
  if (!granted) {
    ({ granted } = await Notifications.requestPermissionsAsync());
  }
  if (!granted) return;

  if (Platform.OS === "android") {
    // Android needs a channel before anything can be shown at all.
    await Notifications.setNotificationChannelAsync("default", {
      name: "Your gym",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });

  // Whatever this phone was registered as before -- with another gym, or
  // under a token that has since rotated -- comes off first, so the phone
  // never hears from two gyms at once.
  const before = registered || (await storedRegistration());
  if (before && (before.token !== token || before.gymSlug !== session.gymSlug)) {
    if (await release(before)) await forget(before);
  }

  await api("/api/mobile/push/register", {
    method: "POST",
    session,
    body: { token, platform: Platform.OS, deviceName: Device.deviceName || Device.modelName || "" },
  });
  registered = { token, gymSlug: session.gymSlug };
  await setItem(PUSH_KEY, JSON.stringify(registered));
}

/**
 * Takes the registration back, on sign-out -- and on a launch with nobody
 * signed in, for a removal that could not reach the server last time. Never
 * throws; a removal that fails for want of a connection stays on the phone
 * and is tried again next time.
 */
export async function unregisterPush(): Promise<void> {
  const r = registered || (await storedRegistration());
  registered = null;
  if (!r) return;
  if (await release(r)) await forget(r);
  else await setItem(PUSH_KEY, JSON.stringify(r));
}

/**
 * Where a notification's link leads in the app, or null for nowhere. The
 * server sends the gym's website address for the same thing (e.g.
 * "https://gym.example/user-detail?tab=bookings"), so only the path and its
 * ?tab= are read. A link the app has no screen for -- a blog post a campaign
 * pointed at -- goes nowhere: the app simply opens where it was.
 */
export function notificationTarget(url: unknown): Href | null {
  if (typeof url !== "string" || !url.trim()) return null;
  // Scheme and host (if any), then the path, then the query.
  const parts = /^(?:[a-z][a-z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(?:\?([^#]*))?/i.exec(url.trim());
  const path = (parts?.[1] || "").replace(/\/+$/, "").toLowerCase() || "/";
  const tab = (/(?:^|&)tab=([^&]*)/i.exec(parts?.[2] || "")?.[1] || "").toLowerCase();

  switch (path) {
    case "/":
      return "/(tabs)";
    case "/classes":
    case "/timetable":
      return "/(tabs)/classes";
    case "/membership":
    case "/packages":
      return "/(tabs)/membership";
    case "/profile":
      return "/(tabs)/profile";
    case "/bookings":
      return "/bookings";
    case "/attendance":
      return "/attendance";
    case "/user-detail":
      // The website's account page, one tab per thing.
      switch (tab) {
        case "bookings": // upcoming classes: on the Classes tab here
          return "/(tabs)/classes";
        case "history":
        case "orders":
          return "/(tabs)/membership";
        case "visits":
          return "/attendance";
        case "checkin":
          return "/checkin";
        case "profile":
          return "/(tabs)/profile";
        default:
          return "/(tabs)";
      }
    default:
      return null;
  }
}

/**
 * Opens the right screen when a notification is tapped -- including the tap
 * that launched the app, which arrives before the stored session has been
 * read and so waits for it. A tap while nobody is signed in goes nowhere: it
 * was meant for whoever was signed in when it was sent.
 */
export function useNotificationTaps(ready: boolean, signedIn: boolean): void {
  const router = useRouter();
  // The launching tap is read once, up front; later taps come by listener.
  const [tap, setTap] = useState<{ target: Href } | null>(() => (Platform.OS === "web" ? null : launchTap()));
  const handled = useRef<{ target: Href } | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const target = tapTarget(response);
      if (target) setTap({ target });
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!tap || !ready || handled.current === tap) return;
    handled.current = tap;
    if (!signedIn) return;
    const target = tap.target;
    // Next tick: on launch, the first screen's own redirect to the tabs runs
    // in this same pass and must land before this does.
    setTimeout(() => {
      if (typeof target === "string" && target.startsWith("/(tabs)")) router.navigate(target);
      else router.push(target);
    }, 0);
  }, [tap, ready, signedIn, router]);
}

function tapTarget(response: Notifications.NotificationResponse | null): Href | null {
  // Only a tap on the notification itself; not a dismissal or an action button.
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  return notificationTarget(response.notification.request.content.data?.url);
}

function launchTap(): { target: Href } | null {
  try {
    const target = tapTarget(Notifications.getLastNotificationResponse());
    // Taken once: without this, every later launch would reopen the same screen.
    Notifications.clearLastNotificationResponse();
    return target ? { target } : null;
  } catch {
    return null;
  }
}
