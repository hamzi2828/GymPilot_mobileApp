// The last check-in code, kept on the phone.
//
// A code is good for two days, and the place a member needs it -- the gym's
// front door -- is often the place with no signal. So the last one the server
// issued is kept in the keychain beside the session, and the check-in screen
// shows it straight away and when the server cannot be reached.
//
// It is kept with whose it is: a code is as good as the member standing
// there, so one saved for somebody else, or past its expiry, is never handed
// back -- it is deleted instead. Sign-out deletes it too.

import { getItem, removeItem, setItem } from "./storage";
import type { CheckInCode } from "./types";

const KEY = "gympilot.checkin";

interface Saved {
  owner: string;
  code: CheckInCode;
}

/** Who a code belongs to: this member, at this gym. Empty when that is not known. */
export function codeOwner(gymSlug: string | undefined, memberId: string | undefined): string {
  return gymSlug && memberId ? `${gymSlug}:${memberId}` : "";
}

/** Whether a code can still be scanned. */
export function codeIsLive(code: CheckInCode | null | undefined, now = Date.now()): code is CheckInCode {
  if (!code || typeof code.token !== "string" || !code.token) return false;
  const expires = new Date(code.expires_at).getTime();
  return Number.isFinite(expires) && expires > now;
}

export async function saveCode(owner: string, code: CheckInCode): Promise<void> {
  if (!owner || !codeIsLive(code)) return;
  const saved: Saved = { owner, code };
  await setItem(KEY, JSON.stringify(saved));
}

/** The saved code, if it is this member's and still good; otherwise nothing, and it is thrown away. */
export async function savedCode(owner: string): Promise<CheckInCode | null> {
  // Not known yet who is asking: nothing to hand back, and nothing to judge.
  if (!owner) return null;
  const raw = await getItem(KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<Saved>;
    if (saved.owner === owner && codeIsLive(saved.code)) return saved.code;
  } catch {
    /* unreadable is the same as absent */
  }
  await removeItem(KEY);
  return null;
}

export async function clearSavedCode(): Promise<void> {
  await removeItem(KEY);
}
