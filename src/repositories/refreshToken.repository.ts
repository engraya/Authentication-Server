/**
 * src/repositories/refreshToken.repository.ts
 * ────────────────────────────────────────────────────────────────────
 * Data access for the refresh_tokens table. The only module that queries it.
 * Note: it stores/looks up by tokenHash — the RAW token never reaches the DB.
 * ────────────────────────────────────────────────────────────────────
 */

import type { RefreshToken } from "@prisma/client";

import { prisma } from "../database/prisma";

export interface CreateRefreshTokenData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export const refreshTokenRepository = {
  /** Store a new refresh-token record (hash only). */
  async create(data: CreateRefreshTokenData): Promise<RefreshToken> {
    return prisma.refreshToken.create({ data });
  },

  /** Look a token up by its SHA-256 hash (deterministic → indexable). */
  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  /**
   * Revoke a token by its hash (used by logout). Idempotent: only touches an
   * active token; returns how many rows changed (0 if unknown/already revoked).
   */
  async revokeByTokenHash(tokenHash: string): Promise<number> {
    const result = await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  },

  /** Mark a single token revoked, optionally recording what replaced it. */
  async revoke(id: string, replacedByHash?: string): Promise<void> {
    await prisma.refreshToken.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        ...(replacedByHash !== undefined ? { replacedByHash } : {}),
      },
    });
  },

  /**
   * Revoke EVERY active token for a user. Used on reuse detection (possible
   * theft) and on "log out everywhere" (Phase 13). Only touches tokens not
   * already revoked, so it's idempotent and cheap.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  },
};
