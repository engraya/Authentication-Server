/**
 * src/utils/password.ts
 * ────────────────────────────────────────────────────────────────────
 * Password hashing helpers.
 *
 * ⚠️ SEQUENCING NOTE: This is a Phase 4 "black box". We NEVER store a raw
 * password, so registration must hash immediately — hence this util exists
 * now. Phase 5 opens the box: what bcrypt is, salting, the cost factor,
 * timing-safe comparison, and why we chose these settings. For now, trust the
 * two functions below.
 *
 * WHY bcryptjs (not the native `bcrypt`)? bcryptjs is a pure-JavaScript
 * implementation of the SAME bcrypt algorithm — identical `$2b$` hashes — with
 * zero native compilation. That means no node-gyp/Visual Studio build step,
 * which is far more reliable across Windows dev and the Render Linux deploy.
 * The tradeoff (slightly slower hashing) is irrelevant at our scale. We revisit
 * this decision in Phase 5.
 * ────────────────────────────────────────────────────────────────────
 */

import bcrypt from "bcryptjs";

// The "cost factor": how many rounds of hashing. Higher = slower = harder to
// brute-force, but also slower for legitimate logins. 12 is a common 2020s
// default. We'll analyze and tune this in Phase 5.
const SALT_ROUNDS = 12;

/** Hash a plaintext password. Returns a self-contained bcrypt hash string. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Compare a plaintext attempt against a stored hash (used at login, Phase 6). */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
