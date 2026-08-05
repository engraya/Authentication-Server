/**
 * src/repositories/verificationToken.repository.ts
 * ────────────────────────────────────────────────────────────────────
 * Data access for the verification_tokens table (email verification now,
 * password reset in Phase 12). Stores/looks up by tokenHash; the raw token
 * only ever lives in the emailed link.
 * ────────────────────────────────────────────────────────────────────
 */

import type { VerificationToken, VerificationTokenType } from "@prisma/client";

import { prisma } from "../database/prisma";

export interface CreateVerificationTokenData {
  userId: string;
  tokenHash: string;
  type: VerificationTokenType;
  expiresAt: Date;
}

export const verificationTokenRepository = {
  async create(data: CreateVerificationTokenData): Promise<VerificationToken> {
    return prisma.verificationToken.create({ data });
  },

  async findByTokenHash(tokenHash: string): Promise<VerificationToken | null> {
    return prisma.verificationToken.findUnique({ where: { tokenHash } });
  },

  /** Mark a token consumed (single-use). */
  async markUsed(id: string): Promise<void> {
    await prisma.verificationToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  },

  /**
   * Invalidate any still-unused tokens of a given type for a user, so issuing a
   * fresh one makes earlier links stop working (only the latest is valid).
   */
  async deleteUnused(userId: string, type: VerificationTokenType): Promise<void> {
    await prisma.verificationToken.deleteMany({
      where: { userId, type, usedAt: null },
    });
  },
};
