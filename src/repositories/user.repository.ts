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

  /** Insert a new user row and return it. */
  async create(data: CreateUserData): Promise<User> {
    return prisma.user.create({ data });
  },
};
