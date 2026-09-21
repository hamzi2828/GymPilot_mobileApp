// Where the app talks to. One value, set at build time: EXPO_PUBLIC_API_URL,
// from .env during development and from the build profile in eas.json for a
// store build.
//
// A phone on the same wifi as your laptop cannot reach "localhost" -- that is
// the phone itself -- so during development this has to be your machine's
// address on the network, e.g. http://192.168.1.20:4000. Expo prints that
// address when you run `npm start`.

const configured = (process.env.EXPO_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");

// eas.json ships with https://api.example.com as a stand-in until the real
// address goes in. A build made before that happened has nowhere to send a
// sign-in, and must say so rather than "cannot reach your gym" for ever.
const PLACEHOLDER = /^https?:\/\/(?:[a-z0-9-]+\.)*example\.(?:com|org|net)(?::\d+)?(?:\/|$)/i;

/**
 * Whether this build knows where the server is. A development build with no
 * address at all falls back to this machine; a release build has no such
 * fallback, because "localhost" on a member's phone is nothing.
 */
export const API_CONFIGURED = configured ? !PLACEHOLDER.test(configured) : __DEV__;

export const API_URL = configured || (__DEV__ ? "http://localhost:4000" : "");

/** What the sign-in screen says when API_CONFIGURED is false. */
export const NOT_CONFIGURED_MESSAGE =
  "This app build isn't configured with a server address, so it cannot reach your gym. Please update the app, or let your gym know.";

/**
 * Shown on the sign-in screen so a developer can see which address a build
 * is pointed at. Empty in a store build: a member has no use for it.
 */
export const API_HINT = __DEV__ ? `Trying ${API_URL}` : "";
