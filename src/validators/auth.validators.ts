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
