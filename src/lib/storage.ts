// Where the session is kept between launches.
//
// On a phone that is the OS keychain (expo-secure-store): a token is as good
// as a password, and it has no business sitting in plain storage. Secure
// Store has no web implementation, so the browser build falls back to
// localStorage -- fine for `npm run web`, which is a development convenience
// rather than something a member uses.

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const web = Platform.OS === "web";

export async function getItem(key: string): Promise<string | null> {
  try {
    if (web) return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (web) {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch {
    // A device that refuses to store the session still works for this run;
    // the member just signs in again next time.
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    if (web) {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* nothing to remove */
  }
}
