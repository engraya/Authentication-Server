/**
 * src/repositories/user.repository.ts
 * ────────────────────────────────────────────────────────────────────
 * DATA ACCESS layer for users. This is the ONLY place Prisma/DB queries for
 * the User table live (docs 23/24). Services call these methods and never
 * touch Prisma directly — so we could swap the ORM or mock the DB in tests
 * without changing any business logic.
 * ────────────────────────────────────────────────────────────────────
 */

import type { User } from "@prisma/client";
import { prisma } from "../database/prisma";

// The exact fields needed to create a user. The service assembles this AFTER
// hashing the password — the repository never sees a plaintext password.
export interface CreateUserData {
  email: string;
  passwordHash: string;
  name?: string;
}

export const userRepository = {
  /** Find a user by email, or null if none. Used for the uniqueness check. */
  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  /** Find a user by id, or null. Used after refreshing to mint a new token. */
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  /** Insert a new user row and return it. */
  async create(data: CreateUserData): Promise<User> {
    return prisma.user.create({ data });
  },

  /** Replace a user's stored password hash (used by rehash-on-login upgrades). */
  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { passwordHash } });
  },

  /** List all users, newest first (admin-only feature). */
  async list(): Promise<User[]> {
    return prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  },

  /** Mark a user's email as verified (Phase 11). */
  async markEmailVerified(id: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { isEmailVerified: true } });
  },

  /** Update a user's editable profile fields and return the updated row. */
  async updateProfile(id: string, data: { name: string }): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  },
};
