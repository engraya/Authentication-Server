/**
 * src/utils/password.ts
 * ────────────────────────────────────────────────────────────────────
 * Password hashing helpers. In Phase 4 this was a black box; Phase 5 opens it.
 * Full theory in docs/14-Bcrypt.md and docs/15-Password-Hashing.md. In brief:
 *
 *  - We store a ONE-WAY bcrypt HASH, never the password (hashing ≠ encryption:
 *    there is no key that reverses it).
 *  - bcrypt SALTS automatically (a random value mixed in), so identical
 *    passwords produce different hashes and precomputed "rainbow tables" fail.
 *  - bcrypt is ADAPTIVE: a COST FACTOR sets how much work each hash takes.
 *    Higher cost = exponentially slower for us AND for an attacker. We measured
 *    costs on real hardware to choose the default (see docs 14).
 *  - The bcrypt output string embeds the algorithm, cost, salt, and hash, e.g.
 *      $2b$12$R9h/cIPz0gi.URNNX3kh2O...   ← "$2b$" alg, "12" cost, then salt+hash
 *    so verification needs only the stored string — no separate salt column.
 *
 * WHY bcryptjs (not native `bcrypt`)? Pure-JS, no native build — reliable on
 * Windows dev and the Render Linux deploy. Same `$2b$` algorithm; a bit slower
 * than native (so our cost timings are conservative). Revisit if hashing
 * throughput ever matters at scale.
 * ────────────────────────────────────────────────────────────────────
 */

import bcrypt from "bcryptjs";

import { config } from "../config";

// bcrypt only processes the first 72 BYTES of input; anything longer is
// silently ignored. We cap password length in the validator (docs 21) to match
// this reality and to blunt a slow-hash DoS. Exported for reuse there/in tests.
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

/**
 * Hash a plaintext password using the configured cost factor.
 * `bcrypt.genSalt(cost)` creates a random salt encoding the cost; `hash` then
 * mixes password + salt through `cost` rounds. The salt travels inside the
 * returned string, so we store just that one value.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length === 0) {
    // Defensive: the validator should already prevent this. Never hash empty.
    throw new Error("Cannot hash an empty password");
  }
  const salt = await bcrypt.genSalt(config.security.bcryptCostFactor);
  return bcrypt.hash(plain, salt);
}

/**
 * Verify a plaintext attempt against a stored hash (used at login, Phase 6).
 * bcrypt.compare re-derives the hash using the cost+salt embedded in `hash` and
 * compares in CONSTANT TIME, so it doesn't leak how much of the value matched
 * (a timing-attack defense — docs 15).
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Does this stored hash use a WEAKER cost than we now require? If so, we should
 * transparently re-hash the password at login (when we briefly have the
 * plaintext) and save the stronger hash — upgrading security over time without
 * ever asking users to reset. Wired into the login flow in Phase 6.
 */
export function passwordNeedsRehash(hash: string): boolean {
  // The cost is the number between the 2nd and 3rd '$' in "$2b$12$...".
  const parts = hash.split("$"); // ["", "2b", "12", "<salt+hash>"]
  const cost = Number.parseInt(parts[2] ?? "", 10);
  if (Number.isNaN(cost)) return true; // unrecognized format → rehash to be safe
  return cost < config.security.bcryptCostFactor;
}
