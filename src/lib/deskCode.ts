// The code on the screen at the gym's front desk, as the camera reads it.
//
// The desk's screen shows a QR code that changes every minute. What it holds
// is a web address -- the gym website's /checkin page, with the code in its
// `c` parameter -- so a member who points the phone's ordinary camera at it
// lands on the website and is checked in there. This app reads the same QR,
// takes the code out of the address and sends only that. A bare code
// ("GPD1." and the rest) is taken as it is.
//
// The server checks the code's signature and its age; this only turns away
// what is plainly not a desk code, so the QR on a poster or a protein shake
// is answered on the spot rather than sent to the gym.

const PREFIX = "GPD1.";

// The code's own alphabet: hex, digits and base64url, joined by dots.
// Anything else in it means it is not one.
const SHAPE = /^GPD1\.[A-Za-z0-9._-]{8,200}$/;

/** The desk code in what the camera read, or null when it is not one. */
export function readDeskCode(scanned: string | null | undefined): string | null {
  const text = String(scanned || "").trim();
  if (text.startsWith(PREFIX)) return SHAPE.test(text) ? text : null;
  if (!/^https?:\/\//i.test(text)) return null;

  // Read with a pattern rather than URL/URLSearchParams, which are not the
  // same on every phone's JavaScript engine.
  const query = /[?&]c=([^&#]*)/.exec(text);
  if (!query) return null;
  let code: string;
  try {
    code = decodeURIComponent(query[1]).trim();
  } catch {
    return null;
  }
  return SHAPE.test(code) ? code : null;
}

/**
 * A new id for one check-in attempt, in the shape of a UUID. The server
 * remembers it with the visit it records, so the same attempt sent again --
 * its answer was lost on the way back -- is answered again rather than taken
 * for a second scan. It only has to be unlikely to repeat, not secret.
 */
export function newRequestId(): string {
  const hex = (length: number) => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}
