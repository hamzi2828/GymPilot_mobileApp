// Every call to the gym's API goes through here.
//
// Two headers matter. `Authorization` is the member's token. `X-Tenant-Slug`
// says which gym they belong to -- the website gets that from its domain, the
// app has to say it -- and the server refuses a token whose gym does not
// match, so the header cannot be used to reach anybody else's data.

import { API_URL } from "./config";

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

type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  session?: Session | null;
  /** Called when the server rejects the token, so the app can sign out. */
  onUnauthorised?: () => void;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, session, onUnauthorised } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (session?.gymSlug) headers["X-Tenant-Slug"] = session.gymSlug;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // No connection, wrong address, gym's server down: all the same to the
    // member, and none of them are their fault.
    throw new ApiError("Cannot reach your gym right now. Check your connection and try again.", 0);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /* some endpoints answer with no body */
  }

  if (response.status === 401 && onUnauthorised) onUnauthorised();

  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : `Something went wrong (${response.status}).`;
    throw new ApiError(message, response.status, typeof payload.code === "string" ? payload.code : undefined);
  }

  return payload as T;
}

/** Sign-in runs before there is a session, and before a gym is known. */
export async function login(username: string, password: string) {
  return api<import("./types").LoginResponse>("/api/mobile/auth/login", {
    method: "POST",
    body: { username: username.trim().toLowerCase(), password },
  });
}
