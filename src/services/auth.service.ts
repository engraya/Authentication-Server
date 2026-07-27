/**
 * src/services/auth.service.ts
 * ────────────────────────────────────────────────────────────────────
 * BUSINESS LOGIC for authentication. Knows nothing about HTTP (no req/res).
 * It orchestrates: uniqueness check → hash → persist → return a SAFE user.
 * It throws typed domain errors (ConflictError); the global handler maps them
 * to HTTP. This is the heart of the app and the most valuable code to unit-test.
 * ────────────────────────────────────────────────────────────────────
 */

import { Prisma, type User } from "@prisma/client";

import { userRepository } from "../repositories/user.repository";
import { hashPassword } from "../utils/password";
import { ConflictError } from "../errors";
import type { RegisterInput } from "../validators/auth.validators";

// The user shape we are allowed to send to clients. `Omit<User, "passwordHash">`
// is a UTILITY TYPE: take the full User type but REMOVE the passwordHash field.
// The type system now makes it impossible to accidentally leak the hash.
export type PublicUser = Omit<User, "passwordHash">;

/** Strip sensitive fields before a user ever leaves the service layer. */
function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...safe } = user; // discard the hash
  return safe;
}

export const authService = {
  /**
   * Register a new account.
   * @throws ConflictError if the email is already registered.
   */
  async register(input: RegisterInput): Promise<PublicUser> {
    // 1. Application-level uniqueness check → a friendly 409 in the common case.
    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError("An account with this email already exists");
    }

    // 2. Hash the password (never store plaintext). Phase 5 explains the how.
    const passwordHash = await hashPassword(input.password);

    // 3. Persist. We wrap the insert to also catch the DATABASE-level unique
    //    constraint (Prisma error P2002). This is DEFENSE IN DEPTH: two
    //    requests could both pass the check above at the same instant, but the
    //    UNIQUE index on `email` guarantees only one insert wins — we translate
    //    the loser's error into the same clean 409.
    try {
      const user = await userRepository.create({
        email: input.email,
        passwordHash,
        ...(input.name !== undefined ? { name: input.name } : {}),
      });
      return toPublicUser(user);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictError("An account with this email already exists");
      }
      throw err; // anything else is unexpected → bubbles to the 500 handler
    }
  },
};
