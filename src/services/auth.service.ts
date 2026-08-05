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
import {
  hashPassword,
  verifyPassword,
  passwordNeedsRehash,
} from "../utils/password";
import { signAccessToken } from "./token.service";
import { refreshTokenService } from "./refreshToken.service";
import { verificationService } from "./verification.service";
import { ConflictError, UnauthorizedError, NotFoundError } from "../errors";
import { logger } from "../utils/logger";
import type { RegisterInput, LoginInput } from "../validators/auth.validators";

// A precomputed, throwaway bcrypt hash (of a random value) used ONLY to burn an
// equivalent amount of CPU when the email doesn't exist — so login takes the
// same time whether or not the account is real (timing-based enumeration
// defense, docs 15/31). It is never expected to match anything.
const DUMMY_HASH = "$2b$12$4geBu7uR415mEBxmM.XiJ.zCXG0CVUdyMhslo47Q4QaVZsPzNBJLa";

// The user shape we are allowed to send to clients. `Omit<User, "passwordHash">`
// is a UTILITY TYPE: take the full User type but REMOVE the passwordHash field.
// The type system now makes it impossible to accidentally leak the hash.
export type PublicUser = Omit<User, "passwordHash">;

// What a successful authentication returns: the safe user, a short-lived access
// token, and a long-lived refresh token (raw value + its expiry, so the
// controller can set the httpOnly cookie). The refresh token is NEVER put in
// the JSON body — only in the cookie.
export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/** Strip sensitive fields before a user ever leaves the service layer. */
function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...safe } = user; // discard the hash
  return safe;
}

/** Build the standard auth response: safe user + access token + refresh token. */
async function buildAuthResult(user: User): Promise<AuthResult> {
  const accessToken = signAccessToken(user);
  const refresh = await refreshTokenService.issue(user.id);
  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken: refresh.rawToken,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

export const authService = {
  /**
   * Register a new account and return the user + a signed access token.
   * @throws ConflictError if the email is already registered.
   */
  async register(input: RegisterInput): Promise<AuthResult> {
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

      // Kick off email verification — BEST-EFFORT: a failure to create/send the
      // verification token must never fail the registration itself (the user
      // can request a resend). We log and move on.
      try {
        await verificationService.issueEmailVerification(user);
      } catch (err) {
        logger.warn(`Failed to issue email verification for user ${user.id}`, err);
      }

      return await buildAuthResult(user);
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

  /**
   * Verify credentials and return the user on success.
   * @throws UnauthorizedError (401) with a GENERIC message on ANY failure.
   *
   * Two anti–user-enumeration measures:
   *   - SAME message ("Invalid email or password") for unknown-email and
   *     wrong-password, so the RESPONSE doesn't reveal which accounts exist.
   *   - A dummy hash comparison on the unknown-email path, so the RESPONSE TIME
   *     doesn't reveal it either.
   *
   * Returns the user + a signed access token. (Phase 8 adds a refresh token.)
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const user = await userRepository.findByEmail(input.email);

    if (!user) {
      await verifyPassword(input.password, DUMMY_HASH); // equalize timing; ignore result
      throw new UnauthorizedError("Invalid email or password");
    }

    const passwordValid = await verifyPassword(input.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    // Transparent security upgrade: if the stored hash uses a weaker cost than
    // we now require, re-hash the (in-hand) plaintext and persist the stronger
    // hash. BEST-EFFORT — a failure here must never block a valid login.
    if (passwordNeedsRehash(user.passwordHash)) {
      try {
        const upgraded = await hashPassword(input.password);
        await userRepository.updatePasswordHash(user.id, upgraded);
        logger.info(`Upgraded password hash cost for user ${user.id}`);
      } catch (err) {
        logger.warn(`Rehash-on-login failed for user ${user.id}`, err);
      }
    }

    return await buildAuthResult(user);
  },

  /**
   * Return the current user's profile, fetched FRESH from the DB by id.
   * The access token proves *who* they are, but we read the live record so the
   * profile can't be stale (e.g. name changed since the token was issued).
   * @throws UnauthorizedError if the user no longer exists.
   */
  async getMe(userId: string): Promise<PublicUser> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedError("Account no longer exists");
    }
    return toPublicUser(user);
  },

  /**
   * Log out of the CURRENT session: revoke the presented refresh token.
   * Best-effort (idempotent) — see refreshTokenService.revoke.
   */
  async logout(rawToken: string): Promise<void> {
    await refreshTokenService.revoke(rawToken);
  },

  /** Log out of ALL sessions for a user ("sign out everywhere"). */
  async logoutAll(userId: string): Promise<number> {
    return refreshTokenService.revokeAll(userId);
  },

  /** Update the caller's own profile (currently just `name`). */
  async updateMe(userId: string, data: { name: string }): Promise<PublicUser> {
    const user = await userRepository.updateProfile(userId, data);
    return toPublicUser(user);
  },

  /** Fetch any user by id (access is gated by the route's authorization). */
  async getUserById(userId: string): Promise<PublicUser> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }
    return toPublicUser(user);
  },

  /** List all users (admin-only feature; authorization enforced at the route). */
  async listUsers(): Promise<PublicUser[]> {
    const users = await userRepository.list();
    return users.map(toPublicUser);
  },

  /**
   * Exchange a valid refresh token for a NEW access token + a NEW refresh token
   * (rotation). Delegates the security checks (reuse detection, expiry) to the
   * refresh-token service, then loads the user to sign a fresh access token.
   * @throws UnauthorizedError on any invalid/expired/reused token.
   */
  async refresh(rawToken: string): Promise<AuthResult> {
    const rotated = await refreshTokenService.rotate(rawToken);

    const user = await userRepository.findById(rotated.userId);
    if (!user) {
      // The account was deleted after the token was issued — treat as unauthenticated.
      throw new UnauthorizedError("Invalid refresh token");
    }

    return {
      user: toPublicUser(user),
      accessToken: signAccessToken(user),
      refreshToken: rotated.rawToken,
      refreshTokenExpiresAt: rotated.expiresAt,
    };
  },
};
