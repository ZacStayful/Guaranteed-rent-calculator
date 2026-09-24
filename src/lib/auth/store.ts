// ─── Admin credential store ───────────────────────────────────────
//
// Where an admin's password hash actually lives.
//
// Reads prefer the database, falling back to the ADMIN_PASSWORD_HASHES env var
// when there's no row. That fallback is what makes the switch seamless: the
// env var keeps working until someone resets their password, at which point a
// row is written and takes precedence from then on.
//
// Writes only ever go to the database — a running app cannot rewrite its own
// environment, which is precisely why "forgot password" needed this table.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getSupabase } from "../supabase.ts";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const TABLE = "admin_users";

export interface StoredCredential {
  hash: Buffer;
  salt: Buffer;
}

/** Parse the legacy "email:hashHex:saltHex,..." env var. */
function envCredentials(): Map<string, StoredCredential> {
  const out = new Map<string, StoredCredential>();
  for (const entry of (process.env.ADMIN_PASSWORD_HASHES ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    // Split from the right: the email itself may not contain a colon, but
    // popping keeps this unambiguous regardless.
    const parts = trimmed.split(":");
    if (parts.length < 3) continue;
    const saltHex = parts.pop() as string;
    const hashHex = parts.pop() as string;
    const email = parts.join(":").trim().toLowerCase();
    if (!email || !hashHex || !saltHex) continue;
    try {
      out.set(email, { hash: Buffer.from(hashHex, "hex"), salt: Buffer.from(saltHex, "hex") });
    } catch {
      // Malformed hex — skip rather than crash the login route.
    }
  }
  return out;
}

/** The stored credential for an email, or null if there isn't one anywhere. */
export async function getCredential(email: string): Promise<StoredCredential | null> {
  const key = email.trim().toLowerCase();

  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("password_hash, password_salt")
        .eq("email", key)
        .maybeSingle();
      if (!error && data) {
        return {
          hash: Buffer.from(data.password_hash, "hex"),
          salt: Buffer.from(data.password_salt, "hex"),
        };
      }
    } catch (err) {
      // Fall through to the env var rather than locking everyone out because
      // storage hiccuped.
      console.error("[admin] credential lookup failed, falling back to env:", err);
    }
  }

  return envCredentials().get(key) ?? null;
}

/** Write (or replace) an admin's password. */
export async function setPassword(email: string, password: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    console.error("[admin] cannot set a password — Supabase is not configured");
    return false;
  }

  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  const key = email.trim().toLowerCase();

  try {
    const { error } = await supabase.from(TABLE).upsert(
      {
        email: key,
        password_hash: hash.toString("hex"),
        password_salt: salt.toString("hex"),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" },
    );
    if (error) {
      console.error("[admin] could not save password:", error.message);
      return false;
    }
    console.log(`[admin] password updated for ${key}`);
    return true;
  } catch (err) {
    console.error("[admin] could not save password:", err);
    return false;
  }
}

/**
 * Verify a password.
 *
 * Always performs a scrypt derivation — even for an unknown email — so response
 * time doesn't reveal which addresses are configured.
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const record = await getCredential(email);

  const salt = record?.salt ?? randomBytes(16);
  const expected = record?.hash ?? randomBytes(KEY_LENGTH);

  const derived = await scrypt(password, salt, KEY_LENGTH);

  if (derived.length !== expected.length) return false;
  const match = timingSafeEqual(derived, expected);
  return Boolean(record) && match;
}
