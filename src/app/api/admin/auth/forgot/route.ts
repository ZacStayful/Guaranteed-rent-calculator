import { after } from 'next/server';
import { isAdminAreaEnabled, isAllowedAdmin, normaliseAdminEmail } from '@/lib/auth/allowlist';
import { createResetToken } from '@/lib/auth/reset';
import { missingEmailConfig, resetEmail, sendEmail } from '@/lib/email/send';

export const runtime = 'nodejs';

// Reset requests are rate limited per IP: minting tokens sends real email and
// an unthrottled endpoint is a spam cannon pointed at your own domain.
const WINDOW_MS = 15 * 60_000;
const MAX_REQUESTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooMany(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_REQUESTS;
}

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of attempts) if (now > entry.resetAt) attempts.delete(ip);
}, 300_000);
(cleanup as unknown as { unref?: () => void }).unref?.();

function baseUrl(request: Request): string {
  if (process.env.ADMIN_BASE_URL) return process.env.ADMIN_BASE_URL;
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!isAdminAreaEnabled()) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? normaliseAdminEmail(body.email) : '';

  // ONE response for every outcome — unknown address, non-admin address, rate
  // limited, send failure. Anything else turns this into an oracle for which
  // addresses are admins.
  const ok = Response.json({
    ok: true,
    message: "If that address has an admin account, a reset link is on its way.",
  });

  if (tooMany(ip)) return ok;
  if (!email || !isAllowedAdmin(email)) {
    console.log(`[admin] reset requested for non-admin address (ignored): ${email || '<blank>'}`);
    return ok;
  }

  // Everything expensive happens AFTER the response is flushed.
  //
  // Awaiting it here would leak by timing what the identical response text is
  // there to hide: minting a token is a database write and sending is an HTTP
  // call to Resend, so an admin address would answer in ~300ms where an unknown
  // one answers in ~10ms. Deferring makes both indistinguishable, and returns
  // faster for the user either way.
  const origin = baseUrl(request);
  after(async () => {
    const missing = missingEmailConfig();
    if (missing.length) {
      // Worth shouting about: the user is now waiting for an email that is
      // never coming. Name the missing variables — and the usual cause, which
      // is not that they were never set.
      console.error(
        `[admin] reset requested but email is not configured — missing ${missing.join(' and ')}. ` +
          `If it is set in Vercel, check it covers this environment, and note that variables bind ` +
          `at build time: a deployment created before the variable existed will never see it.`,
      );
      return;
    }

    const token = await createResetToken(email, ip);
    if (!token) return;

    const resetUrl = `${origin}/admin/reset?token=${token}`;
    const { subject, html, text } = resetEmail(resetUrl);
    const result = await sendEmail({ to: email, subject, html, text });

    if (result.sent) console.log(`[admin] reset link sent to ${email}`);
    else console.error(`[admin] reset link could NOT be sent to ${email}: ${result.reason}`);
  });

  return ok;
}
