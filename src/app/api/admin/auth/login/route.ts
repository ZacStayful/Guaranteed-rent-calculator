import { cookies } from 'next/headers';
import { isAdminAreaEnabled, isAllowedAdmin, normaliseAdminEmail } from '@/lib/auth/allowlist';
// Reads the database first, falling back to ADMIN_PASSWORD_HASHES when an
// address has no row yet — so this keeps working before and after a reset.
import { verifyPassword } from '@/lib/auth/store';
import { ADMIN_COOKIE, SESSION_COOKIE_OPTIONS, createSessionToken } from '@/lib/auth/session';

export const runtime = 'nodejs';

// ─── Login throttle (in-memory, per IP) ──────────────────────────
// Same shape as the analyser's rate limiter. Per-instance only, which is fine:
// it exists to blunt online guessing, not as the security boundary — scrypt
// already makes each attempt expensive.
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(ip);
  }
}, 300_000);
(cleanup as unknown as { unref?: () => void }).unref?.();

export async function POST(request: Request) {
  // Fail closed when the admin area isn't configured.
  if (!isAdminAreaEnabled()) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  if (tooManyAttempts(ip)) {
    return Response.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429 },
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? normaliseAdminEmail(body.email) : '';
  const password = typeof body.password === 'string' ? body.password : '';

  // One generic message and one generic delay for every failure, so the
  // response can't be used to enumerate which addresses are configured.
  const reject = async () => {
    await new Promise((r) => setTimeout(r, 1000));
    return Response.json({ error: 'Invalid email or password.' }, { status: 401 });
  };

  if (!email || !password) return reject();
  if (!isAllowedAdmin(email)) return reject();
  if (!(await verifyPassword(email, password))) return reject();

  const token = createSessionToken(email);
  if (!token) return Response.json({ error: 'Not found' }, { status: 404 });

  const store = await cookies();
  store.set(ADMIN_COOKIE, token, SESSION_COOKIE_OPTIONS);

  console.log(`[admin] signed in: ${email}`);
  return Response.json({ ok: true, email });
}
