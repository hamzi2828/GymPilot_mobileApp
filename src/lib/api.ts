// Every call to the gym's API goes through here.
//
// Two headers matter. `Authorization` is the member's token. `X-Tenant-Slug`
// says which gym they belong to -- the website gets that from its domain, the
// app has to say it -- and the server refuses a token whose gym does not
// match, so the header cannot be used to reach anybody else's data.

import { API_URL } from "./config";
import type { LoginResponse } from "./types";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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

type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  session?: Session | null;
  /**
   * Called, with the server's own words, when the token itself is refused --
   * so the app can sign out and tell the member why.
   */
  onUnauthorised?: (reason: string) => void;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, session, onUnauthorised } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (session?.gymSlug) headers["X-Tenant-Slug"] = session.gymSlug;

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
    const message = typeof payload.message === "string" ? payload.message : `Something went wrong (${response.status}).`;
    throw new ApiError(message, response.status, typeof payload.code === "string" ? payload.code : undefined);
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
