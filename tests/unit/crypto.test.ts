/**
 * tests/unit/crypto.test.ts
 * ────────────────────────────────────────────────────────────────────
 * Unit tests for the opaque-token helpers (src/utils/crypto.ts). Pure functions
 * with no dependencies — the easiest thing to test and a good place to learn the
 * describe / it / expect rhythm.
 * ────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";

import { generateOpaqueToken, sha256 } from "../../src/utils/crypto";

describe("generateOpaqueToken", () => {
  it("returns a URL-safe base64url string (no +, /, or = padding)", () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is effectively unique across calls (high entropy)", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateOpaqueToken()));
    // 1000 random 384-bit tokens must never collide.
    expect(tokens.size).toBe(1000);
  });

  it("honors a custom byte length", () => {
    // 3 raw bytes → exactly 4 base64 chars (no padding in base64url).
    expect(generateOpaqueToken(3)).toHaveLength(4);
  });
});

describe("sha256", () => {
  it("is deterministic — same input always yields the same hash", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });

  it("returns 64 hex characters (256 bits)", () => {
    expect(sha256("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the known SHA-256 vector for the empty string", () => {
    // A fixed, independently-verifiable vector guards against a broken impl.
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});
