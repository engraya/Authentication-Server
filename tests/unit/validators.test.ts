/**
 * tests/unit/validators.test.ts
 * ────────────────────────────────────────────────────────────────────
 * Unit tests for the Zod schemas (src/validators/auth.validators.ts). These are
 * the app's front door for untrusted input, so we test both what they ACCEPT
 * (and how they normalize it) and what they REJECT.
 * ────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";

import {
  registerSchema,
  loginSchema,
  updateMeSchema,
} from "../../src/validators/auth.validators";

describe("registerSchema", () => {
  it("accepts valid input and normalizes the email (trim + lowercase)", () => {
    const result = registerSchema.safeParse({
      email: "  Jane@Test.COM ",
      password: "longenough1",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("jane@test.com");
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({ email: "a@b.com", password: "short" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = registerSchema.safeParse({ email: "not-an-email", password: "longenough1" });
    expect(result.success).toBe(false);
  });

  it("treats name as optional", () => {
    const result = registerSchema.safeParse({ email: "a@b.com", password: "longenough1" });
    expect(result.success).toBe(true);
  });
});

describe("loginSchema", () => {
  it("only requires a NON-EMPTY password (no min length — no policy leak)", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "x" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("updateMeSchema", () => {
  it("trims the name", () => {
    const result = updateMeSchema.safeParse({ name: "  Ada Lovelace  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Ada Lovelace");
  });

  it("rejects an empty/whitespace-only name", () => {
    expect(updateMeSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("STRIPS unknown keys — a sneaky `id`/`role` never survives parsing", () => {
    const result = updateMeSchema.safeParse({ name: "Grace", id: "other-user", role: "ADMIN" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Grace" });
      expect("id" in result.data).toBe(false);
    }
  });
});
