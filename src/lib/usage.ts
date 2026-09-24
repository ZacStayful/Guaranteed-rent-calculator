// ─── Analyser Usage Gate ──────────────────────────────────────────
// Limits how many free estimates each email address can run. After the free
// limit is reached the analyser stops producing estimates and the user is
// pushed to the paid product at intelligence.stayful.co.uk. One email is
// always exempt (the owner) — configurable via ANALYSER_UNLIMITED_EMAILS.
//
// The count of actual uses is a durable per-email counter stored on the lead's
// Monday item ("Analyser Uses" number column) — see getAnalyserUseCount /
// incrementAnalyserUseCount in src/lib/apis/monday.ts, applied in /api/analyse.
// It is keyed by EMAIL (not the device/browser, which over-blocks a shared
// machine) and counts FORWARD from when the column was added (so established
// leads are not retroactively blocked by their historical reports). Monday is
// the single source of truth; the gate fails open when the email isn't a known
// lead or the CRM is unreachable, so a genuine new user is never wrongly gated.

// Number of free estimates allowed per email before the paywall kicks in.
// "Used more than 2 times" ⇒ uses 1 and 2 are free, the 3rd is blocked.
export const FREE_ANALYSIS_LIMIT = 2;

// Where blocked users are sent to keep using the analyser.
export const PAYMENT_URL = "https://intelligence.stayful.co.uk";

// Emails that are never gated. Defaults to the owner; override with a
// comma-separated ANALYSER_UNLIMITED_EMAILS env var if needed.
const UNLIMITED_EMAILS: Set<string> = new Set(
  (process.env.ANALYSER_UNLIMITED_EMAILS ?? "zac@stayful.co.uk")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isUnlimited(email: string | null | undefined): boolean {
  return !!email && UNLIMITED_EMAILS.has(normaliseEmail(email));
}
