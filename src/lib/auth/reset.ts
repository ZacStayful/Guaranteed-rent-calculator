// ─── Password-reset tokens ────────────────────────────────────────
//
// A reset link is a bearer credential: whoever holds it can take over the
// account. So the token is treated like a password —
//
//   • 32 random bytes, so it can't be guessed
//   • only its SHA-256 is stored, so a leaked database backup yields no usable
//     links
//   • single use, marked the moment it's redeemed
//   • expires after an hour
//
// Requesting a reset deliberately reveals nothing: the route always responds
// the same way whether or not the address is an admin.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getSupabase } from "../supabase.ts";

const TABLE = "admin_password_resets";
const TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a reset token for an email.
 *
 * @returns the raw token to put in the emailed link, or null if it couldn't be
 *          stored. The raw value is never persisted and cannot be recovered.
 */
export async function createResetToken(
  email: string,
  requestedIp?: string | null,
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) {
    console.error("[admin] cannot create a reset token — Supabase is not configured");
    return null;
  }

  const token = randomBytes(32).toString("hex");
  const key = email.trim().toLowerCase();

  try {
    // Retire any outstanding tokens for this address first, so a stolen older
    // link stops working the moment a new one is requested.
    await supabase
      .from(TABLE)
      .update({ used_at: new Date().toISOString() })
      .eq("email", key)
      .is("used_at", null);

    const { error } = await supabase.from(TABLE).insert({
      token_hash: hashToken(token),
      email: key,
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      requested_ip: requestedIp ?? null,
    });
    if (error) {
      console.error("[admin] could not store reset token:", error.message);
      return null;
    }
    return token;
  } catch (err) {
    console.error("[admin] could not store reset token:", err);
    return null;
  }
}

export interface ResetLookup {
  email: string;
  tokenHash: string;
}

/**
 * Check a token without consuming it — used to decide whether to render the
 * "set a new password" form at all.
 *
 * @returns the email the token belongs to, or null when it's unknown, expired
 *          or already used.
 */
export async function verifyResetToken(token: string): Promise<ResetLookup | null> {
  const supabase = getSupabase();
  if (!supabase || !token) return null;

  const tokenHash = hashToken(token);

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("token_hash, email, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (error || !data) return null;
    if (data.used_at) return null;
    if (Date.now() >= new Date(data.expires_at).getTime()) return null;

    // Constant-time compare even though the lookup was by equality — keeps the
    // comparison uniform if this ever becomes a scan.
    const a = Buffer.from(data.token_hash);
    const b = Buffer.from(tokenHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    return { email: data.email, tokenHash };
  } catch (err) {
    console.error("[admin] reset token lookup failed:", err);
    return null;
  }
}

/**
 * Burn a token.
 *
 * Conditional on `used_at is null`, so two simultaneous redemptions can't both
 * succeed — the loser gets `false` and is rejected.
 */
export async function consumeResetToken(tokenHash: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ used_at: new Date().toISOString() })
      .eq("token_hash", tokenHash)
      .is("used_at", null)
      .select("token_hash");
    if (error) {
      console.error("[admin] could not consume reset token:", error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (err) {
    console.error("[admin] could not consume reset token:", err);
    return false;
  }
}
