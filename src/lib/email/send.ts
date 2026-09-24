// ─── Transactional email ──────────────────────────────────────────
//
// Resend, over plain fetch — no SDK, so no new dependency. Currently used only
// for admin password resets.
//
// Configured with:
//   RESEND_API_KEY     from resend.com/api-keys
//   ADMIN_EMAIL_FROM   e.g. "Stayful <noreply@stayful.co.uk>". The domain must
//                      be verified in Resend, or sending is rejected. For a
//                      first test you can use "onboarding@resend.dev", which
//                      only delivers to the address that owns the Resend
//                      account.
//
// With either unset, sending is skipped and logged rather than throwing — the
// caller decides what that means for the user.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendResult {
  sent: boolean;
  reason?: string;
}

export function isEmailConfigured(): boolean {
  return missingEmailConfig().length === 0;
}

/**
 * Which of the required variables are absent.
 *
 * Named individually because "email is not configured" sends you looking at
 * both, and the usual cause is one of them — either set for the wrong
 * environment, or added after the deployment was built, since Vercel binds
 * variables at build time and an existing deployment never picks up new ones.
 */
export function missingEmailConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (!process.env.ADMIN_EMAIL_FROM) missing.push("ADMIN_EMAIL_FROM");
  return missing;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ADMIN_EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn("[email] not configured (RESEND_API_KEY / ADMIN_EMAIL_FROM) — skipping send");
    return { sent: false, reason: "not_configured" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "<unreadable>");
      console.error(`[email] Resend HTTP ${res.status}: ${body.slice(0, 400)}`);
      return { sent: false, reason: `http_${res.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { sent: false, reason: "network" };
  }
}

/** The password-reset email. Plain and unbranded — it's an internal tool. */
export function resetEmail(resetUrl: string): { subject: string; html: string; text: string } {
  return {
    subject: "Reset your Stayful admin password",
    text:
      `Someone asked to reset the password for your Stayful admin account.\n\n` +
      `Open this link to choose a new one:\n${resetUrl}\n\n` +
      `The link works once and expires in an hour.\n\n` +
      `If this wasn't you, ignore this email — your password is unchanged.`,
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#171717;max-width:520px">
        <p>Someone asked to reset the password for your Stayful admin account.</p>
        <p style="margin:24px 0">
          <a href="${resetUrl}"
             style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:500">
            Choose a new password
          </a>
        </p>
        <p style="color:#666;font-size:13px">
          The link works once and expires in an hour.
        </p>
        <p style="color:#666;font-size:13px">
          If this wasn't you, ignore this email — your password is unchanged.
        </p>
        <p style="color:#999;font-size:12px;word-break:break-all;margin-top:24px">
          If the button doesn't work, paste this into your browser:<br>${resetUrl}
        </p>
      </div>
    `.trim(),
  };
}
