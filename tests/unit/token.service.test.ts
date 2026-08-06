/**
 * tests/unit/token.service.test.ts
 * ────────────────────────────────────────────────────────────────────
 * Unit tests for JWT access tokens (src/services/token.service.ts). We test the
 * ROUND TRIP (sign → verify) and every rejection path, crafting adversarial
 * tokens with the `jsonwebtoken` library directly to simulate tampering,
 * expiry, a wrong secret, and an invalid role claim.
 * ────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

import { signAccessToken, verifyAccessToken } from "../../src/services/token.service";
import { config } from "../../src/config";
import { UnauthorizedError } from "../../src/errors";

const user = { id: "user-123", email: "a@b.com", role: Role.USER };

describe("signAccessToken → verifyAccessToken (round trip)", () => {
  it("returns the id (sub), email and role we signed", () => {
    const payload = verifyAccessToken(signAccessToken(user));
    expect(payload).toEqual({ sub: "user-123", email: "a@b.com", role: "USER" });
  });

  it("produces a three-part JWT (header.payload.signature)", () => {
    expect(signAccessToken(user).split(".")).toHaveLength(3);
  });
});

describe("verifyAccessToken rejections", () => {
  it("rejects a tampered token with 'Invalid access token'", () => {
    const token = signAccessToken(user);
    const tampered = token.slice(0, -3) + "abc"; // corrupt the signature
    expect(() => verifyAccessToken(tampered)).toThrow(UnauthorizedError);
    expect(() => verifyAccessToken(tampered)).toThrow(/invalid access token/i);
  });

  it("rejects an expired token with 'Access token expired'", () => {
    // Sign a token that expired 10 seconds ago, using the REAL secret.
    const expired = jwt.sign({ email: user.email, role: user.role }, config.jwt.accessSecret, {
      subject: user.id,
      expiresIn: -10,
    });
    expect(() => verifyAccessToken(expired)).toThrow(/expired/i);
  });

  it("rejects a token signed with the wrong secret", () => {
    const forged = jwt.sign({ email: user.email, role: user.role }, "a-different-secret-32-chars-xxxxxx", {
      subject: user.id,
    });
    expect(() => verifyAccessToken(forged)).toThrow(UnauthorizedError);
  });

  it("rejects a token whose role claim isn't a real Role", () => {
    const badRole = jwt.sign({ email: user.email, role: "SUPERADMIN" }, config.jwt.accessSecret, {
      subject: user.id,
    });
    expect(() => verifyAccessToken(badRole)).toThrow(/invalid access token/i);
  });

  it("rejects a garbage string", () => {
    expect(() => verifyAccessToken("not.a.jwt")).toThrow(UnauthorizedError);
  });
});
