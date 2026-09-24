import { cookies } from 'next/headers';
import { isAdminAreaEnabled, isAllowedAdmin } from '@/lib/auth/allowlist';
import { consumeResetToken, verifyResetToken } from '@/lib/auth/reset';
import { setPassword } from '@/lib/auth/store';
import { ADMIN_COOKIE, SESSION_COOKIE_OPTIONS, createSessionToken } from '@/lib/auth/session';

export const runtime = 'nodejs';

/** Long enough to be worth having, short enough not to be annoying. */
const MIN_PASSWORD_LENGTH = 12;

export async function POST(request: Request) {
  if (!isAdminAreaEnabled()) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  let body: { token?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (password.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const lookup = await verifyResetToken(token);
  if (!lookup) {
    return Response.json(
      { error: 'That reset link has expired or already been used. Request a new one.' },
      { status: 400 },
    );
  }

  // The allowlist is authoritative and re-checked here: an address removed from
  // ADMIN_EMAILS after its token was minted must not be able to redeem it.
  if (!isAllowedAdmin(lookup.email)) {
    return Response.json({ error: 'That account is no longer an admin.' }, { status: 403 });
  }

  // Burn the token BEFORE setting the password. Conditional on it still being
  // unused, so two simultaneous redemptions cannot both win.
  const consumed = await consumeResetToken(lookup.tokenHash);
  if (!consumed) {
    return Response.json(
      { error: 'That reset link has already been used. Request a new one.' },
      { status: 400 },
    );
  }

  const saved = await setPassword(lookup.email, password);
  if (!saved) {
    return Response.json(
      { error: 'Could not save the new password. Please try again.' },
      { status: 500 },
    );
  }

  // Sign them straight in — they've just proved control of the mailbox, and
  // making them retype the password they set five seconds ago is pure friction.
  const session = createSessionToken(lookup.email);
  if (session) {
    const store = await cookies();
    store.set(ADMIN_COOKIE, session, SESSION_COOKIE_OPTIONS);
  }

  console.log(`[admin] password reset completed for ${lookup.email}`);
  return Response.json({ ok: true, email: lookup.email });
}
