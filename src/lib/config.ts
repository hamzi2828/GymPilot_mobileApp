// Where the app talks to. One value, set at build time.
//
// A phone on the same wifi as your laptop cannot reach "localhost" -- that is
// the phone itself -- so during development this has to be your machine's
// address on the network, e.g. http://192.168.1.20:4000. Expo prints that
// address when you run `npm start`.

const fallback = "http://localhost:4000";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || fallback).replace(/\/+$/, "");

/** Shown on the sign-in screen when the app cannot reach the API at all. */
export const API_HINT = `Trying ${API_URL}`;
