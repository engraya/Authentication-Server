/**
 * tests/integration/auth.routes.test.ts
 * ────────────────────────────────────────────────────────────────────
 * INTEGRATION tests: drive the REAL Express app end-to-end with Supertest
 * (route → middleware → controller → service), but MOCK the repository layer so
 * no real database is touched. This is the payoff of the layered architecture
 * (docs 23): the seam between service and repository is a clean mock boundary.
 *
 * Supertest calls `app` in-process — no server is started, no port is opened.
 *
 * `vi.mock(path, factory)` is HOISTED above the imports, so by the time `app`
 * (and its repositories) load, they resolve to these fakes. We then program each
 * fake's return value per test with `vi.mocked(...)`.
 * ────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Role, type User } from "@prisma/client";

// ── Mock the data layer (no DB) and the email side-effect ───────────
vi.mock("../../src/repositories/user.repository", () => ({
  userRepository: {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    updatePasswordHash: vi.fn(),
    list: vi.fn(),
    markEmailVerified: vi.fn(),
    updateProfile: vi.fn(),
  },
}));
vi.mock("../../src/repositories/refreshToken.repository", () => ({
  refreshTokenRepository: {
    create: vi.fn(),
    findByTokenHash: vi.fn(),
    revoke: vi.fn(),
    revokeByTokenHash: vi.fn(),
    revokeAllForUser: vi.fn(),
  },
}));
// Registration kicks off email verification best-effort; stub it so no real
// token is created and no email is sent.
vi.mock("../../src/services/verification.service", () => ({
  verificationService: {
    issueEmailVerification: vi.fn().mockResolvedValue(undefined),
    verifyEmail: vi.fn(),
    resendVerification: vi.fn(),
  },
}));

import app from "../../src/app";
import { hashPassword } from "../../src/utils/password";
import { userRepository } from "../../src/repositories/user.repository";
import { refreshTokenRepository } from "../../src/repositories/refreshToken.repository";

const users = vi.mocked(userRepository);
const refreshTokens = vi.mocked(refreshTokenRepository);

const PASSWORD = "correctPassword1";

/** Build a full User row (as the DB would return one). */
function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-123",
    email: "jane@test.com",
    passwordHash: "$2b$10$placeholderplaceholderplaceholderplaceholderplaceholde",
    name: null,
    role: Role.USER,
    isEmailVerified: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Issuing a refresh token calls create(); it just needs to resolve.
  refreshTokens.create.mockResolvedValue(undefined as never);
});

describe("POST /api/auth/register", () => {
  it("creates a user → 201 with an access token and NO password hash", async () => {
    users.findByEmail.mockResolvedValue(null); // email is free
    users.create.mockResolvedValue(fakeUser());

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "jane@test.com", password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe("jane@test.com");
    expect(res.body.data.user).not.toHaveProperty("passwordHash");
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    // Refresh token is delivered as an httpOnly cookie, never in the body.
    expect(res.headers["set-cookie"]?.[0]).toMatch(/refresh_token=.*HttpOnly/i);
    expect(res.body.data).not.toHaveProperty("refreshToken");
  });

  it("rejects a duplicate email → 409", async () => {
    users.findByEmail.mockResolvedValue(fakeUser()); // already exists

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "jane@test.com", password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error.name).toBe("ConflictError");
    expect(users.create).not.toHaveBeenCalled();
  });

  it("rejects invalid input → 422 with field errors", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "nope", password: "short" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(users.findByEmail).not.toHaveBeenCalled(); // rejected at the edge
  });
});

describe("POST /api/auth/login", () => {
  it("verifies credentials → 200 with an access token", async () => {
    const hash = await hashPassword(PASSWORD);
    users.findByEmail.mockResolvedValue(fakeUser({ passwordHash: hash }));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "jane@test.com", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.headers["set-cookie"]?.[0]).toMatch(/refresh_token=/);
  });

  it("wrong password → generic 401", async () => {
    const hash = await hashPassword(PASSWORD);
    users.findByEmail.mockResolvedValue(fakeUser({ passwordHash: hash }));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "jane@test.com", password: "wrongPassword1" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid email or password/i);
  });

  it("unknown email → the SAME generic 401 (no enumeration)", async () => {
    users.findByEmail.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "ghost@test.com", password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid email or password/i);
  });
});

describe("GET /api/auth/me (protected)", () => {
  async function loginAndGetToken(): Promise<string> {
    const hash = await hashPassword(PASSWORD);
    users.findByEmail.mockResolvedValue(fakeUser({ passwordHash: hash }));
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "jane@test.com", password: PASSWORD });
    return res.body.data.accessToken as string;
  }

  it("returns the profile for a valid token → 200, no hash", async () => {
    const token = await loginAndGetToken();
    users.findById.mockResolvedValue(fakeUser()); // getMe re-fetches live state

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe("user-123");
    expect(res.body.data.user).not.toHaveProperty("passwordHash");
  });

  it("401 when no Authorization header is sent", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("401 for a malformed/garbage token", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
  });
});
