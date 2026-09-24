// ─── Admin allowlist ──────────────────────────────────────────────
//
// Who may reach /admin. Deliberately two conditions: the address must be on
// the Stayful domain AND explicitly listed. The domain check alone would let
// any future Stayful address in without anyone deciding to grant it.
//
// Fails CLOSED: with ADMIN_EMAILS or ADMIN_SESSION_SECRET unset the whole
// admin area 404s, mirroring the INTERNAL_API_SECRET pattern already used by
// /api/reports/count and /api/market-stats. A misconfigured deploy exposes
// nothing rather than everything.

const ADMIN_DOMAIN = "@stayful.co.uk";

function allowlist(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True when the admin area is configured at all. */
export function isAdminAreaEnabled(): boolean {
  return Boolean(process.env.ADMIN_EMAILS && process.env.ADMIN_SESSION_SECRET);
}

export function isAllowedAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalised = email.trim().toLowerCase();
  if (!normalised.endsWith(ADMIN_DOMAIN)) return false;
  return allowlist().has(normalised);
}

export function normaliseAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}
