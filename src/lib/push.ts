// Push notifications: telling the gym's server how to reach this phone.
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

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api, type Session } from "./api";

// The token this phone registered, kept so sign-out can take it back.
let registered: string | null = null;

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
  await api("/api/mobile/push/register", {
    method: "POST",
    session,
    body: { token, platform: Platform.OS, deviceName: Device.deviceName || Device.modelName || "" },
  });
  registered = token;
}

/**
 * Takes the registration back. Best effort: the session may already be dead
 * (that is often why we are signing out), in which case the server will
 * drop the token the next time a notification bounces.
 */
export async function unregisterPush(session: Session | null): Promise<void> {
  const token = registered;
  registered = null;
  if (!token || !session) return;
  try {
    await api("/api/mobile/push/register", { method: "DELETE", session, body: { token } });
  } catch {
    /* signing out regardless */
  }
}
