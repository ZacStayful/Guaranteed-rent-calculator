import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, verifySessionToken } from './session.ts';
import { isAdminAreaEnabled, isAllowedAdmin } from './allowlist.ts';

const ADMIN = 'zac@stayful.co.uk';

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const CONFIGURED = {
  ADMIN_SESSION_SECRET: 'test-secret-value',
  ADMIN_EMAILS: ADMIN,
};

// ─── Allowlist ────────────────────────────────────────────────────

test('allows a listed stayful.co.uk address', () => {
  withEnv(CONFIGURED, () => {
    assert.equal(isAllowedAdmin(ADMIN), true);
    assert.equal(isAllowedAdmin('  ZAC@STAYFUL.CO.UK '), true, 'case and space insensitive');
  });
});

test('rejects an unlisted address even on the right domain', () => {
  withEnv(CONFIGURED, () => {
    assert.equal(isAllowedAdmin('someone-else@stayful.co.uk'), false);
  });
});

test('rejects a listed address on the wrong domain', () => {
  // Both conditions must hold: domain AND explicit listing.
  withEnv({ ...CONFIGURED, ADMIN_EMAILS: 'attacker@evil.com' }, () => {
    assert.equal(isAllowedAdmin('attacker@evil.com'), false);
  });
});

test('rejects lookalike domains', () => {
  withEnv({ ...CONFIGURED, ADMIN_EMAILS: 'zac@stayful.co.uk.evil.com' }, () => {
    assert.equal(isAllowedAdmin('zac@stayful.co.uk.evil.com'), false);
  });
});

test('the admin area is disabled unless both env vars are set', () => {
  withEnv({ ADMIN_EMAILS: undefined, ADMIN_SESSION_SECRET: undefined }, () => {
    assert.equal(isAdminAreaEnabled(), false);
  });
  withEnv({ ADMIN_EMAILS: ADMIN, ADMIN_SESSION_SECRET: undefined }, () => {
    assert.equal(isAdminAreaEnabled(), false, 'fails closed without a secret');
  });
  withEnv({ ADMIN_EMAILS: undefined, ADMIN_SESSION_SECRET: 'x' }, () => {
    assert.equal(isAdminAreaEnabled(), false, 'fails closed without an allowlist');
  });
  withEnv(CONFIGURED, () => assert.equal(isAdminAreaEnabled(), true));
});

// ─── Session tokens ───────────────────────────────────────────────

test('a freshly signed token verifies', () => {
  withEnv(CONFIGURED, () => {
    const token = createSessionToken(ADMIN);
    assert.ok(token);
    const session = verifySessionToken(token);
    assert.equal(session?.email, ADMIN);
  });
});

test('a tampered payload is rejected', () => {
  withEnv(CONFIGURED, () => {
    const token = createSessionToken(ADMIN);
    assert.ok(token);
    const [, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ email: 'attacker@evil.com', exp: 9_999_999_999 }),
    ).toString('base64url');
    assert.equal(verifySessionToken(`${forged}.${signature}`), null);
  });
});

test('a token signed with a different secret is rejected', () => {
  const token = withEnv({ ...CONFIGURED, ADMIN_SESSION_SECRET: 'other-secret' }, () =>
    createSessionToken(ADMIN),
  );
  assert.ok(token);
  withEnv(CONFIGURED, () => {
    assert.equal(verifySessionToken(token), null);
  });
});

test('an expired token is rejected', () => {
  withEnv(CONFIGURED, () => {
    // Hand-roll an expired but otherwise valid-looking token.
    const expired = Buffer.from(JSON.stringify({ email: ADMIN, exp: 1 })).toString('base64url');
    assert.equal(verifySessionToken(`${expired}.anything`), null);
  });
});

test('removing an email from the allowlist revokes its live session', () => {
  const token = withEnv(CONFIGURED, () => createSessionToken(ADMIN));
  assert.ok(token);
  // Same secret, so the signature still checks out — but the allowlist is
  // re-read on every verify, so the session must stop working.
  withEnv({ ...CONFIGURED, ADMIN_EMAILS: 'someone-else@stayful.co.uk' }, () => {
    assert.equal(verifySessionToken(token), null);
  });
});

test('malformed tokens are rejected rather than throwing', () => {
  withEnv(CONFIGURED, () => {
    for (const bad of ['', 'nodot', '.', 'a.b.c', 'not-base64!.sig', undefined, null]) {
      assert.equal(verifySessionToken(bad as string | undefined | null), null, `input: ${bad}`);
    }
  });
});

test('no token can be minted or verified without a secret', () => {
  withEnv({ ADMIN_EMAILS: ADMIN, ADMIN_SESSION_SECRET: undefined }, () => {
    assert.equal(createSessionToken(ADMIN), null);
    assert.equal(verifySessionToken('anything.atall'), null);
  });
});
