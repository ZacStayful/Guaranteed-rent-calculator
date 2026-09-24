// ─── Admin session ────────────────────────────────────────────────
//
// A signed cookie, no database and no new dependencies: payload + HMAC-SHA256,
// both base64url, joined by a dot.
//
// Deliberately NOT Supabase Auth. That would mean exposing
// NEXT_PUBLIC_SUPABASE_ANON_KEY to the browser, and analyser_reports has no RLS
// policies — so the key would expose every lead email, address and full
// raw_response through PostgREST. Turning a private table public is a steep
// price for a login used by two people. (RLS is enabled by the bulk-jobs
// migration, so switching to Supabase Auth later is a safe follow-up: the
// callback would validate the JWT server-side and mint this same cookie.)
//
// There is deliberately no middleware/proxy either. Verifying an HMAC there
// means the Edge runtime and async Web Crypto for no benefit once the layout
// and per-route guards exist — and no proxy means zero chance of accidentally
// gating the public analyser.

// Deliberately free of any `next/*` import so the token logic — the actual
// security boundary — can be unit-tested under bare Node. Reading the cookie
// lives in ./guard.ts.
import { createHmac, timingSafeEqual } from "node:crypto";
import { isAllowedAdmin } from "./allowlist.ts";

export const ADMIN_COOKIE = "stayful_admin";
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

export interface AdminSession {
  email: string;
  /** Unix seconds. */
  exp: number;
}

function secret(): string | null {
  return process.env.ADMIN_SESSION_SECRET || null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createSessionToken(email: string): string | null {
  const key = secret();
  if (!key) return null;

  const session: AdminSession = {
    email: email.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payload = b64url(JSON.stringify(session));
  return `${payload}.${sign(payload, key)}`;
}

/**
 * Verify a session token.
 *
 * Re-checks the allowlist on every call, so removing an address from
 * ADMIN_EMAILS revokes any session it already holds rather than waiting for
 * the cookie to expire.
 */
export function verifySessionToken(token: string | undefined | null): AdminSession | null {
  const key = secret();
  if (!key || !token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(payload, key);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let session: AdminSession;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof session?.email !== "string" || typeof session?.exp !== "number") return null;
  if (session.exp <= Math.floor(Date.now() / 1000)) return null;
  if (!isAllowedAdmin(session.email)) return null;

  return session;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
