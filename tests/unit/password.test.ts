/**
 * tests/unit/password.test.ts
 * ────────────────────────────────────────────────────────────────────
 * Unit tests for the bcrypt helpers (src/utils/password.ts). These import
 * `config` (for the cost factor), which is why vitest.config.ts supplies a fake
 * env — including BCRYPT_COST=10 so hashing stays fast in the suite.
 * ────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";

import {
  hashPassword,
  verifyPassword,
  passwordNeedsRehash,
  BCRYPT_MAX_PASSWORD_BYTES,
} from "../../src/utils/password";

describe("hashPassword", () => {
  it("produces a bcrypt hash (never the plaintext)", async () => {
    const hash = await hashPassword("correct horse battery");
    // $2b$ = bcrypt algorithm id; a bcrypt hash is 60 chars.
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(hash).toHaveLength(60);
    expect(hash).not.toContain("correct horse battery");
  });

  it("salts: the same password hashes to different values each time", async () => {
    const [a, b] = await Promise.all([
      hashPassword("samePassword1"),
      hashPassword("samePassword1"),
    ]);
    expect(a).not.toBe(b);
  });

  it("uses the configured cost factor (10 in tests)", async () => {
    const hash = await hashPassword("whatever8");
    expect(hash.split("$")[2]).toBe("10");
  });

  it("refuses to hash an empty password", async () => {
    await expect(hashPassword("")).rejects.toThrow(/empty/i);
  });
});

describe("verifyPassword", () => {
  it("returns true for the correct password", async () => {
    const hash = await hashPassword("s3cretValue");
    expect(await verifyPassword("s3cretValue", hash)).toBe(true);
  });

  it("returns false for a wrong password", async () => {
    const hash = await hashPassword("s3cretValue");
    expect(await verifyPassword("wrongValue", hash)).toBe(false);
  });
});

describe("passwordNeedsRehash", () => {
  it("is true when the stored cost is weaker than the current config", () => {
    // A hand-crafted hash at cost 08 — weaker than our configured 10.
    expect(passwordNeedsRehash("$2b$08$" + "x".repeat(53))).toBe(true);
  });

  it("is false for a hash at the current cost", async () => {
    const hash = await hashPassword("current10"); // cost 10 == config
    expect(passwordNeedsRehash(hash)).toBe(false);
  });

  it("is true for an unrecognized/garbage hash (rehash to be safe)", () => {
    expect(passwordNeedsRehash("not-a-bcrypt-hash")).toBe(true);
  });
});

describe("BCRYPT_MAX_PASSWORD_BYTES", () => {
  it("reflects bcrypt's 72-byte input limit", () => {
    expect(BCRYPT_MAX_PASSWORD_BYTES).toBe(72);
  });
});
