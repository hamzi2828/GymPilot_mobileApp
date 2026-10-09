// Leaving the app: a web page in the in-app browser, or another app (the
// dialler, mail, WhatsApp).
//
// Every one of these is a promise that can fail -- a website a gym saved
// without "https://", a phone with no mail app -- and a tap that does nothing
// is a dead end. So the address is tidied first, and a failure says what
// could not be opened, with the thing itself, so the member can still use it.

import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { tellMember } from "./confirm";

/**
 * An address as somebody typed it -- "gym.example/", "www.gym.example" --
 * made into one a browser will take, with a path put on the end of it.
 */
export function webAddress(base: string, path = ""): string {
  const site = String(base || "").trim().replace(/\/+$/, "");
  if (!site) return "";
  const withScheme = /^https?:\/\//i.test(site) ? site : `https://${site.replace(/^\/+/, "")}`;
  return path ? `${withScheme}/${path.replace(/^\/+/, "")}` : withScheme;
}

// One browser at a time: a second tap while the first is still opening would
// be refused by the phone, and must not be reported as a failure.
let opening = false;

/** A web page, in the browser that slides up over the app. */
export async function openWeb(url: string): Promise<void> {
  if (opening) return;
  const address = webAddress(url);
  opening = true;
  try {
    if (!address) throw new Error("no address");
    await WebBrowser.openBrowserAsync(address);
  } catch {
    // No in-app browser on this phone: its ordinary one will do.
    try {
      if (!address) throw new Error("no address");
      await Linking.openURL(address);
    } catch {
      await tellMember("Could not open that page", address ? `You can type it into your browser instead: ${address}` : "There is no address to open.");
    }
  } finally {
    opening = false;
  }
}

/**
 * Another app, by its link (tel:, mailto:, https://wa.me/...). `otherwise`
 * is what the member is told when this phone has nothing to open it with.
 */
export async function openApp(url: string, otherwise: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    await tellMember("Could not open that", otherwise);
  }
}
