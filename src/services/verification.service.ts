/**
 * src/services/verification.service.ts
 * ────────────────────────────────────────────────────────────────────
 * The email-verification lifecycle: ISSUE a token + email, and VERIFY a token.
 * Theory: docs/16-Email-Verification.md.
 *
 * Same token discipline as refresh tokens (docs 11): the raw token goes in the
 * emailed LINK; we store only its SHA-256 HASH. Tokens are SINGLE-USE (usedAt)
 * and EXPIRING (24h) — the two defenses against replay of a leaked link.
 * ────────────────────────────────────────────────────────────────────
 */

import type { User } from "@prisma/client";

import { generateOpaqueToken, sha256 } from "../utils/crypto";
import { verificationTokenRepository } from "../repositories/verificationToken.repository";
import { userRepository } from "../repositories/user.repository";
import { emailService } from "./email.service";
import { config } from "../config";
import { BadRequestError } from "../errors";
import { logger } from "../utils/logger";

// How long a verification link stays valid.
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const verificationService = {
  /**
   * Create a fresh verification token for a user and email them the link.
   * Invalidates any earlier unused verification tokens first (only the newest
   * link works). Best-effort email send — returns whether it went out.
   */
  async issueEmailVerification(user: Pick<User, "id" | "email" | "name">): Promise<boolean> {
    // Retire older unused tokens so previously-sent links stop working.
    await verificationTokenRepository.deleteUnused(user.id, "EMAIL_VERIFICATION");

    const rawToken = generateOpaqueToken();
    await verificationTokenRepository.create({
      userId: user.id,
      tokenHash: sha256(rawToken),
      type: "EMAIL_VERIFICATION",
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    });

    // The raw token goes ONLY into the link. Points at a frontend route in
    // production; the client then POSTs the token to /api/auth/verify-email.
    const link = `${config.appUrl}/verify-email?token=${rawToken}`;

    return emailService.sendVerificationEmail({
      to: user.email,
      name: user.name,
      link,
    });
  },

  /**
   * Verify an email using the raw token from the link.
   * @throws BadRequestError if the token is unknown, already used, expired, or
   *   the wrong type. (A generic 400 — we don't reveal which, to limit probing.)
   */
  async verifyEmail(rawToken: string): Promise<void> {
    const record = await verificationTokenRepository.findByTokenHash(sha256(rawToken));

    if (
      !record ||
      record.type !== "EMAIL_VERIFICATION" ||
      record.usedAt !== null ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestError("Invalid or expired verification token");
    }

    // Consume the token (single use) and flip the user's flag.
    await verificationTokenRepository.markUsed(record.id);
    await userRepository.markEmailVerified(record.userId);
    logger.info(`Email verified for user ${record.userId}`);
  },

  /**
   * Re-send verification to a logged-in user who hasn't verified yet.
   * @throws BadRequestError if the account is already verified (nothing to do).
   */
  async resendVerification(userId: string): Promise<boolean> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new BadRequestError("Account not found");
    }
    if (user.isEmailVerified) {
      throw new BadRequestError("Email is already verified");
    }
    return this.issueEmailVerification(user);
  },
};
