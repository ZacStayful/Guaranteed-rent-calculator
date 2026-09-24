// ─── Route + page guards ──────────────────────────────────────────
//
// requireAdmin()    — for server components / layouts. Redirects to the login.
// requireAdminApi() — for route handlers. Returns a Response to short-circuit.
//
// IMPORTANT: the layout guard protects PAGES only. Route handlers are not
// nested inside it, so every /api/admin/* handler must call requireAdminApi
// itself. This is the classic footgun in this pattern.

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isAdminAreaEnabled } from "./allowlist.ts";
import { ADMIN_COOKIE, verifySessionToken, type AdminSession } from "./session.ts";

/** The current admin session, or null. Safe to call from pages and routes. */
export async function getAdminSession(): Promise<AdminSession | null> {
  if (!isAdminAreaEnabled()) return null;
  const store = await cookies();
  return verifySessionToken(store.get(ADMIN_COOKIE)?.value);
}

/**
 * For server components. Returns the session, or never returns (redirects to
 * the login, or 404s when the admin area isn't configured).
 */
export async function requireAdmin(): Promise<AdminSession> {
  if (!isAdminAreaEnabled()) notFound();
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}

export type ApiGuardResult =
  | { ok: true; session: AdminSession }
  | { ok: false; response: Response };

/**
 * For route handlers. Check `ok` before doing anything else:
 *
 *   const guard = await requireAdminApi();
 *   if (!guard.ok) return guard.response;
 */
export async function requireAdminApi(): Promise<ApiGuardResult> {
  if (!isAdminAreaEnabled()) {
    return { ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) };
  }
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true, session };
}
