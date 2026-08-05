/**
 * src/services/passwordReset.service.ts
 * ────────────────────────────────────────────────────────────────────
 * The forgot/reset-password lifecycle. Theory: docs/17-Forgot-Password.md.
 *
 * Reuses the SAME VerificationToken model as email verification (docs 16), with
 * type = PASSWORD_RESET. Tokens are opaque, hashed, single-use, and expiring —
 * with a SHORTER TTL (1h) because a reset link is higher-value than a verify
 * link (it can change the password).
 * ────────────────────────────────────────────────────────────────────
 */

import { generateOpaqueToken, sha256 } from "../utils/crypto";
import { verificationTokenRepository } from "../repositories/verificationToken.repository";
import { refreshTokenRepository } from "../repositories/refreshToken.repository";
import { userRepository } from "../repositories/user.repository";
import { emailService } from "./email.service";
import { hashPassword } from "../utils/password";
import { config } from "../config";
import { BadRequestError } from "../errors";
import { logger } from "../utils/logger";

// Reset links are short-lived — they can change a password, so limit the window.
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export const passwordResetService = {
  /**
   * Handle a "forgot password" request. Whether or not the email exists, the
   * CONTROLLER returns the same 200 (no user enumeration, docs 31). Here we only
   * do work — issue a token + send the reset email — IF the account exists.
   */
  async requestReset(email: string): Promise<void> {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      // Unknown email: silently do nothing. The caller still returns 200 so an
      // attacker can't tell registered emails from unregistered ones.
      logger.info(`Password-reset requested for unknown email (ignored)`);
      return;
    }

    // Invalidate earlier unused reset tokens so only the newest link works.
    await verificationTokenRepository.deleteUnused(user.id, "PASSWORD_RESET");

    const rawToken = generateOpaqueToken();
    await verificationTokenRepository.create({
      userId: user.id,
      tokenHash: sha256(rawToken),
      type: "PASSWORD_RESET",
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });

    const link = `${config.appUrl}/reset-password?token=${rawToken}`;
    await emailService.sendPasswordResetEmail({ to: user.email, name: user.name, link });
  },

  /**
   * Complete a reset: validate the token, set the new password, consume the
   * token, and REVOKE ALL refresh tokens so any existing sessions are killed
   * (a password reset should log the user out everywhere — especially important
   * if the reset was triggered because the account was compromised).
   * @throws BadRequestError if the token is invalid/used/expired/wrong type.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const record = await verificationTokenRepository.findByTokenHash(sha256(rawToken));

    if (
      !record ||
      record.type !== "PASSWORD_RESET" ||
      record.usedAt !== null ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestError("Invalid or expired reset token");
    }

    const passwordHash = await hashPassword(newPassword);
    await userRepository.updatePasswordHash(record.userId, passwordHash);
    await verificationTokenRepository.markUsed(record.id);

    // Kill every existing session — the old password (and any stolen refresh
    // tokens) must not survive a reset.
    const revoked = await refreshTokenRepository.revokeAllForUser(record.userId);
    logger.info(`Password reset for user ${record.userId}; revoked ${revoked} session(s)`);
  },
};
