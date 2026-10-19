// Every call to the gym's API goes through here.
//
// Two headers matter. `Authorization` is the member's token. `X-Tenant-Slug`
// says which gym they belong to -- the website gets that from its domain, the
// app has to say it -- and the server refuses a token whose gym does not
// match, so the header cannot be used to reach anybody else's data.

import { API_CONFIGURED, API_URL, NOT_CONFIGURED_MESSAGE } from "./config";
import type { LoginResponse } from "./types";

export class ApiError extends Error {
  status: number;
  code?: string;
  /**
   * The server's technical reason, when it sent one beside `message` (in
   * `error`) -- e.g. which unique field a save collided with. For the app
   * to translate, never to show as it is.
   */
  detail?: string;
  constructor(message: string, status: number, code?: string, detail?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export interface Session {
  token: string;
  gymSlug: string;
}

/** How long to wait for the gym's server before giving up on a request. */
const TIMEOUT_MS = 20_000;

// The 401s that mean "this session is over", as the server names them in
// `code`. Any other 401 -- a wrong current password, a wrong sign-in code --
// is the answer to one request and must not sign the member out.
const SESSION_OVER = new Set(["TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_WRONG_GYM", "SESSION_ENDED"]);

export const SESSION_ENDED_MESSAGE = "Your session ended. Please sign in again.";

// The server could not check the session at all -- its database is down, say
// -- and answers 503 SERVICE_UNAVAILABLE. Nothing is wrong with the token, so
// this is never a sign-out (only the 401s above are): the screen shows its
// usual "try again", in these words rather than a bare status.
const SERVER_TROUBLE_MESSAGE = "Your gym's server is having trouble right now. Please try again in a moment.";

// The server's names for "the whole gym is closed to its members right now":
// suspended by the platform, its GymsPilotPro subscription lapsed, or the
// member app switched off for it. Every request fails the same way then, so
// screens say it once rather than under every section.
//
// By name only, never by status. A lapsed gym answers 402, but so does a
// class booking refused over the member's own membership (MEMBERSHIP_REQUIRED,
// NO_SESSIONS_LEFT): that is the answer to one tap, said beside the class.
const GYM_CLOSED = new Set(["TENANT_SUSPENDED", "SUBSCRIPTION_INACTIVE", "MEMBER_APP_NOT_INCLUDED"]);

export function isGymClosed(code: string | null | undefined): boolean {
  return !!code && GYM_CLOSED.has(code);
}

// The gym is not on GymsPilotPro any more: its account was deleted, so the
// slug the app holds names nothing. The server's own words ("No gym is
// connected to this domain") are written for the website; the member is told
// in theirs, and every screen says it once, as it does for a closed gym.
const GYM_GONE = "TENANT_NOT_FOUND";
export const GYM_GONE_MESSAGE = "Your gym's account is no longer active on GymsPilotPro.";

export function isGymGone(code: string | null | undefined): boolean {
  return code === GYM_GONE;
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  session?: Session | null;
  /** Names the gym for a call that has no session to name it (push removal). */
  gym?: string;
  /**
   * Called, with the server's own words, when the token itself is refused --
   * so the app can sign out and tell the member why.
   */
  onUnauthorised?: (reason: string) => void;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, session, gym, onUnauthorised } = options;

  // A build with no real server address: say that, rather than "cannot
  // reach your gym", which would send the member off checking their wifi.
  if (!API_CONFIGURED) throw new ApiError(NOT_CONFIGURED_MESSAGE, 0);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  const tenant = session?.gymSlug || gym;
  if (tenant) headers["X-Tenant-Slug"] = tenant;

  // A request that never answers would otherwise leave a spinner up for
  // good; twenty seconds is longer than any honest answer takes.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // No connection, wrong address, gym's server down: all the same to the
    // member, and none of them are their fault.
    throw new ApiError(
      controller.signal.aborted
        ? "Your gym's server is taking too long to answer. Please try again."
        : "Cannot reach your gym right now. Check your connection and try again.",
      0
    );
  } finally {
    clearTimeout(timer);
  }

  let payload: Record<string, unknown> = {};
  let hasBody = false;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object") {
      payload = parsed as Record<string, unknown>;
      hasBody = true;
    }
  } catch {
    /* some endpoints answer with no body */
  }

  if (response.status === 401 && onUnauthorised) {
    const code = typeof payload.code === "string" ? payload.code : "";
    if (!hasBody || SESSION_OVER.has(code)) {
      onUnauthorised(typeof payload.message === "string" && payload.message ? payload.message : SESSION_ENDED_MESSAGE);
    }
  }

  if (!response.ok) {
    const code = typeof payload.code === "string" ? payload.code : undefined;
    const said = typeof payload.message === "string" && payload.message ? payload.message : "";
    let message = said || `Something went wrong (${response.status}).`;
    if (tenant && isGymGone(code)) message = GYM_GONE_MESSAGE;
    else if (code === "SERVICE_UNAVAILABLE" || (response.status >= 500 && !said)) message = SERVER_TROUBLE_MESSAGE;
    throw new ApiError(message, response.status, code, typeof payload.error === "string" ? payload.error : undefined);
  }

  return payload as T;
}

/** Sign-in runs before there is a session, and before a gym is known. */
export async function login(username: string, password: string) {
  return api<LoginResponse>("/api/mobile/auth/login", {
    method: "POST",
    body: { username: username.trim().toLowerCase(), password },
  });
}

/**
 * The second step, for accounts that sign in with an emailed code. The gym
 * slug is the one the first step handed back: it tells the server which
 * gym's database holds the challenge.
 */
export async function loginTwoFactor(challengeId: string, code: string, gym: string) {
  return api<LoginResponse>("/api/mobile/auth/login/2fa", {
    method: "POST",
    body: { challengeId, code: code.replace(/\D/g, ""), gym },
  });
}

/** Asks for a reset link. The answer is the same whether or not the username exists. */
export async function forgotPassword(username: string) {
  return api<{ success: boolean; message: string }>("/api/mobile/auth/forgot", {
    method: "POST",
    body: { username: username.trim().toLowerCase() },
  });
}
