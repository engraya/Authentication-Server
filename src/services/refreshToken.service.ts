/**
 * src/services/refreshToken.service.ts
 * ────────────────────────────────────────────────────────────────────
 * The refresh-token lifecycle: ISSUE and ROTATE (with reuse detection).
 * Theory: docs/11-Refresh-Tokens.md and docs/12-Token-Lifecycle.md.
 *
 * The raw token is returned to the caller (to put in the cookie) but only its
 * SHA-256 HASH is ever stored. On refresh we hash the incoming token and look
 * it up by that hash.
 * ────────────────────────────────────────────────────────────────────
 */

import { generateOpaqueToken, sha256 } from "../utils/crypto";
import { refreshTokenRepository } from "../repositories/refreshToken.repository";
import { config } from "../config";
import { UnauthorizedError } from "../errors";
import { logger } from "../utils/logger";

export interface IssuedRefreshToken {
  rawToken: string; // goes to the client cookie
  expiresAt: Date; // used to set the cookie's max-age
}

export interface RotatedRefreshToken extends IssuedRefreshToken {
  userId: string; // so the caller can mint a new access token
}

function expiryFromNow(): Date {
  return new Date(Date.now() + config.refresh.ttlDays * 24 * 60 * 60 * 1000);
}

export const refreshTokenService = {
  /**
   * Revoke a single refresh token by its raw value (logout). Best-effort and
   * idempotent — an unknown/already-revoked token is a no-op, so logging out
   * twice (or with a stale cookie) never errors.
   */
  async revoke(rawToken: string): Promise<void> {
    await refreshTokenRepository.revokeByTokenHash(sha256(rawToken));
  },

  /** Revoke ALL of a user's active tokens ("log out everywhere"). */
  async revokeAll(userId: string): Promise<number> {
    return refreshTokenRepository.revokeAllForUser(userId);
  },

  /** Create and store a new refresh token for a user; return the RAW value. */
  async issue(userId: string): Promise<IssuedRefreshToken> {
    const rawToken = generateOpaqueToken();
    const expiresAt = expiryFromNow();
    await refreshTokenRepository.create({
      userId,
      tokenHash: sha256(rawToken),
      expiresAt,
    });
    return { rawToken, expiresAt };
  },

  /**
   * Validate an incoming refresh token and ROTATE it: revoke the old one and
   * issue a fresh one. Returns the new raw token + the owning userId.
   *
   * Security decisions (docs 11/12):
   *  - Unknown token            → 401 (never existed or already pruned).
   *  - ALREADY-REVOKED token    → REUSE DETECTED. A valid token is single-use;
   *    seeing a revoked one again means it was replayed/stolen. We revoke ALL of
   *    the user's tokens (kill every session) and 401. This is the key defense
   *    that turns rotation into theft DETECTION.
   *  - Expired token            → 401.
   *  - Valid token              → revoke it (linking to its replacement) and
   *    issue a new one (rotation), so each refresh token is used exactly once.
   */
  async rotate(rawToken: string): Promise<RotatedRefreshToken> {
    const tokenHash = sha256(rawToken);
    const record = await refreshTokenRepository.findByTokenHash(tokenHash);

    if (!record) {
      throw new UnauthorizedError("Invalid refresh token");
    }

    if (record.revokedAt !== null) {
      // Reuse of a token we already retired → treat the whole session as
      // compromised and revoke everything for this user.
      logger.warn(
        `Refresh token REUSE detected for user ${record.userId} — revoking all sessions`,
      );
      await refreshTokenRepository.revokeAllForUser(record.userId);
      throw new UnauthorizedError("Refresh token reuse detected");
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError("Refresh token expired");
    }

    // Valid → rotate: issue the replacement first, then revoke the old one and
    // record what replaced it (the rotation trail).
    const next = await this.issue(record.userId);
    await refreshTokenRepository.revoke(record.id, sha256(next.rawToken));

    return { ...next, userId: record.userId };
  },
};
