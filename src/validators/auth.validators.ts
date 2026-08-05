/**
 * src/validators/auth.validators.ts
 * ────────────────────────────────────────────────────────────────────
 * Zod schemas describing what VALID input looks like for auth endpoints.
 *
 * WHY validate at runtime when we have TypeScript? Types are ERASED at compile
 * time (docs 02) — they cannot check data that arrives at RUNTIME from an
 * untrusted client. `req.body` is really `any`-shaped attacker-controlled JSON.
 * Zod checks it AT RUNTIME and, as a bonus, lets us INFER the static type from
 * the schema — one definition, both guarantees. (Full theory: docs 21.)
 * ────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";

/** Rules for POST /auth/register. */
export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase() // normalize so "A@B.com" and "a@b.com" are one account
    .email("A valid email is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"), // bcrypt ignores >72 bytes
  name: z.string().trim().min(1).max(100).optional(),
});

// z.infer DERIVES a TypeScript type from the schema. `RegisterInput` is
// exactly `{ email: string; password: string; name?: string }` — but kept in
// perfect sync with the runtime rules automatically. Change the schema, the
// type updates. This is the single-source-of-truth payoff.
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Rules for POST /auth/login.
 *
 * DELIBERATELY looser than registration: we only require a NON-EMPTY password,
 * NOT min(8). Two reasons:
 *   1. Never leak the password policy to an attacker probing the login form.
 *   2. A user's existing password may predate a policy change; they must still
 *      be able to log in. Policy is enforced at REGISTRATION / reset, not login.
 * Email is normalized the same way so it matches the stored (lowercased) value.
 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Rules for POST /auth/verify-email — just the opaque token from the link. */
export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Verification token is required"),
});

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

/**
 * Rules for PATCH /auth/me — update the caller's OWN profile. Only fields a
 * user is allowed to change themselves belong here (NOT email/role/verified —
 * those need their own dedicated, more-guarded flows).
 */
export const updateMeSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").max(100),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** Rules for POST /auth/forgot-password — normalize email like login/register. */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Rules for POST /auth/reset-password — the token plus the NEW password, which
 * must meet the same policy as registration (min 8, max 72; docs 14/21).
 */
export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
