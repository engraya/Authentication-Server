/**
 * src/utils/crypto.ts
 * ────────────────────────────────────────────────────────────────────
 * Helpers for OPAQUE tokens — high-entropy random strings that mean nothing on
 * their own (unlike a JWT, which is self-describing). Used for refresh tokens
 * (Phase 8) and later email-verification / password-reset tokens (11/12).
 *
 * WHY SHA-256 here, when passwords use bcrypt?
 *   - Passwords are LOW entropy (humans pick them), so we need a SLOW, salted
 *     hash (bcrypt) to resist brute force.
 *   - These tokens are HIGH entropy (256+ random bits): brute-forcing them is
 *     infeasible regardless of hash speed, so a slow hash buys nothing.
 *   - Crucially, we must LOOK A TOKEN UP by its value on every refresh. bcrypt
 *     salts each hash differently, so you can't query by it — you'd have to
 *     compare against every row. SHA-256 is DETERMINISTIC, so the hash is an
 *     indexable key: hash the incoming token, look it up directly. (docs 11)
 * ────────────────────────────────────────────────────────────────────
 */

import { randomBytes, createHash } from "node:crypto";

/**
 * Generate a cryptographically-random, URL-safe opaque token.
 * 48 bytes = 384 bits of entropy — far beyond guessable. base64url is safe to
 * put in a cookie/URL without escaping.
 */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

/** Deterministic SHA-256 hash (hex) — what we STORE and look up by. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
