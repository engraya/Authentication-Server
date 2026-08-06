# 25 — Testing (Vitest + Supertest)

> We've verified every phase by hand with curl. That proves it works *once, today, on my machine*.
> **Automated tests** prove it still works after the next change — they turn "I think I didn't break
> login" into a green checkmark. This chapter adds a fast, TypeScript-native test suite: **Vitest** for
> unit tests and **Supertest** for HTTP integration tests.

---

## The testing pyramid (and where we sit)

```
        ╱╲        few   E2E (real browser + real DB)      ← not here
       ╱──╲
      ╱    ╲      some  INTEGRATION (real app, mocked DB)  ← Supertest
     ╱──────╲
    ╱        ╲    many  UNIT (one pure function)           ← Vitest
   ╱──────────╲
```

- **Unit** — one function, no I/O, milliseconds. We test the *pure logic*: crypto, password hashing,
  JWT sign/verify, Zod schemas. Most of our tests, because most bugs live here.
- **Integration** — the *real Express app* wired end-to-end (route → middleware → controller →
  service), but with the **repository layer mocked** so no database is needed. Proves the wiring.
- **E2E** — a real browser against a real deployment. Out of scope; the closest we get is Phase 17 CI
  running this suite.

---

## Why these tools

- **Vitest** — Vite-powered, so it runs `.ts` directly (no separate compile step), has a great watch
  mode, and ships `expect` + mocking built in. Config lives in one `vitest.config.ts`.
- **Supertest** — calls the Express `app` **in-process** (no port opened) and gives a fluent API for
  asserting on status, body, and headers. This is exactly why [app.ts](../src/app.ts) *builds* the app
  but [server.ts](../src/server.ts) *listens* — the split (Phase 2) lets tests import `app` without
  booting a server or touching the DB.

---

## The config seam: booting `config` in tests

Our [config](../src/config/index.ts) validates required env vars **at import** and `process.exit(1)`
if any are missing. A test that imports `app` imports `config` — so the vars must exist first. We
supply fake-but-valid values in `vitest.config.ts` under `test.env`:

```ts
test: {
  environment: "node",
  include: ["tests/**/*.test.ts"],
  env: {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/testdb?schema=public",
    JWT_ACCESS_SECRET: "test-jwt-secret-at-least-32-chars-long-000",
    RESEND_API_KEY: "re_test_placeholder_key",
    BCRYPT_COST: "10",            // fastest allowed → snappy hashing tests
    RATE_LIMIT_MAX: "1000000",    // don't let the limiter cause flaky 429s
    AUTH_RATE_LIMIT_MAX: "1000000",
  },
}
```

Vitest sets these on `process.env` **before** any test file loads, and `dotenv` never overrides
existing vars — so these win over the real `.env`, and **tests never touch real secrets or the real
database.** The placeholder `DATABASE_URL` is never dialed because the repositories are mocked.

We also made the [logger](../src/utils/logger.ts) **silent** when `NODE_ENV === "test"`: the suite
deliberately triggers 401s and 409s, and their log lines would bury the test output.

---

## Unit tests — pure logic

The rhythm is `describe` / `it` / `expect`. Example from [tests/unit/crypto.test.ts](../tests/unit/crypto.test.ts):

```ts
import { describe, it, expect } from "vitest";
import { sha256 } from "../../src/utils/crypto";

describe("sha256", () => {
  it("is deterministic", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });
  it("matches the known empty-string vector", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
```

What we cover:

| File | Asserts |
|---|---|
| [crypto.test.ts](../tests/unit/crypto.test.ts) | base64url shape, 1000× uniqueness, deterministic SHA-256 (+ known vector) |
| [password.test.ts](../tests/unit/password.test.ts) | bcrypt `$2b$` shape, salting (two hashes differ), verify true/false, empty-throws, `needsRehash` weak/current/garbage |
| [token.service.test.ts](../tests/unit/token.service.test.ts) | sign→verify round trip, **tampered**→401, **expired**→401, **wrong secret**→401, **bad role claim**→401 |
| [validators.test.ts](../tests/unit/validators.test.ts) | email normalization, min-length rejects, login's no-policy-leak, `updateMe` strips unknown keys |

Two techniques worth naming:

- **Known-answer vectors** (the empty-string SHA-256) catch a silently broken implementation that a
  "same input → same output" test would miss.
- **Adversarial construction**: we sign *malicious* JWTs with the `jsonwebtoken` library directly —
  expired (`expiresIn: -10`), wrong-secret, invalid-role — to drive every rejection branch of
  `verifyAccessToken`, not just the happy path.

---

## Integration tests — the real app, mocked DB

`vi.mock(path, factory)` is **hoisted** above the imports, so when `app` loads, its repositories
resolve to fakes. We program each fake per test and assert on the HTTP response.
From [tests/integration/auth.routes.test.ts](../tests/integration/auth.routes.test.ts):

```ts
vi.mock("../../src/repositories/user.repository", () => ({
  userRepository: { findByEmail: vi.fn(), create: vi.fn(), findById: vi.fn(), /* … */ },
}));
// (also mock refreshToken.repository, and stub verification.service so no email is sent)

import app from "../../src/app";
import { userRepository } from "../../src/repositories/user.repository";
const users = vi.mocked(userRepository);

it("creates a user → 201 with an access token and NO password hash", async () => {
  users.findByEmail.mockResolvedValue(null);      // email is free
  users.create.mockResolvedValue(fakeUser());     // DB "returns" the row

  const res = await request(app)
    .post("/api/auth/register")
    .send({ email: "jane@test.com", password: "correctPassword1" });

  expect(res.status).toBe(201);
  expect(res.body.data.user).not.toHaveProperty("passwordHash");   // no leak
  expect(res.headers["set-cookie"][0]).toMatch(/refresh_token=.*HttpOnly/i);
});
```

The mock boundary is the **repository** — the clean seam the layered architecture (docs 23) exists
to give us. Everything above it (validation, controller, service, error handling, cookies, JWTs) runs
for real. Flows covered: register (201 / duplicate-409 / invalid-422), login (200 / wrong-pw-401 /
unknown-email-**same** 401), and protected `GET /me` (200 no-hash / no-token-401 / bad-token-401).

`beforeEach(() => vi.clearAllMocks())` resets call history so tests don't leak state into each other.

### Why mock the DB instead of using a real one?

| | Mocked repos (our choice) | Real (throwaway) Postgres |
|---|---|---|
| Speed | milliseconds | seconds (connect, migrate, truncate) |
| Determinism | total | depends on DB state/network (our Neon *suspends*) |
| What it proves | app logic + wiring | that + real SQL/constraints |
| CI friction | none | needs a DB service container |

For unit + integration we mock — fast and deterministic. A real-DB test tier (spinning a disposable
Postgres, running migrations, asserting on actual constraints) is valuable and complementary; it's a
natural addition alongside the Phase 17 CI pipeline. We call that out rather than pretend the mocked
suite exercises real SQL.

---

## Running

```bash
npm test          # vitest run — one-shot, what CI runs (Phase 17)
npm run test:watch  # re-runs affected tests on save while developing
```

Result: **42 tests across 5 files, green.**

> **A note on type-checking tests.** `tsconfig.json` excludes `tests/` from the build so test files
> never land in `dist/`. Vitest runs them via esbuild (fast transpile, no type-check). `npm run
> typecheck` therefore covers `src/` only; type errors *within* a test surface in the editor and when
> the test runs. Keeping tests out of the shipped build is deliberate.

---

## Common mistakes

- **Testing implementation, not behavior** — asserting "bcrypt was called" instead of "the stored
  value isn't the plaintext". Assert observable outcomes; they survive refactors.
- **Only the happy path** — the bugs that bite are the branches: wrong password, expired token,
  duplicate email. Test the failures.
- **Not resetting mocks between tests** — stale call counts/returns cause spooky order-dependent
  failures. `clearAllMocks()` in `beforeEach`.
- **Hitting the real DB/email in "unit" tests** — slow, flaky, and can send real mail. Mock the seam.
- **Leaking real secrets into tests** — use fake `test.env` values, never the real `.env`.
- **Asserting on an exact error string everywhere** — brittle. Prefer status + a loose `/regex/i`.
- **A `.only` left in** — silently skips the rest of the file. Grep for it before committing.

---

## Best practices

- Mirror `src/` under `tests/`; name files `*.test.ts`; one `describe` per unit.
- **Arrange–Act–Assert**: set up mocks, make the call, assert the outcome.
- Test **behavior and contracts** (status codes, the `PublicUser` shape, "no hash leaks"), not internals.
- Cover the **failure branches**, not just success.
- Keep tests **fast and isolated** — mock I/O, reset between tests, no shared mutable state.
- Use **known-answer vectors** for anything cryptographic.
- Wire `npm test` into **CI** (Phase 17) so a red suite blocks a merge/deploy.

---

## Interview questions

1. **Unit vs integration vs E2E?** Scope: one function / the wired app with mocked I/O / the whole
   system in a real environment. Cost and confidence rise as you go up; keep most tests at the base.
2. **Why does splitting `app` from `server` help testing?** Supertest imports `app` and calls it
   in-process — no port, no DB — because `app` builds but doesn't listen.
3. **Why mock the repository instead of the database client?** It's the architecture's clean seam:
   the whole stack above it runs for real, and the mock is trivial to program per test.
4. **How do you keep `config`'s fail-fast from killing the test run?** Provide fake-but-valid env
   before import (`test.env`); dotenv won't override them.
5. **A known-answer vector vs. a round-trip test — why have both?** A round trip can pass with two
   symmetric bugs; a fixed external vector proves the actual algorithm.
6. **How do you test error paths for JWT verification?** Craft adversarial tokens directly (expired,
   wrong-secret, bad-role) and assert each maps to a 401.

---

## Summary

- Added **Vitest** (unit) + **Supertest** (integration): 42 tests, green, fast, no real DB or email.
- **Unit** tests cover the pure logic (crypto, password, JWT, validators) including adversarial and
  known-answer cases; **integration** tests drive the real app with the **repository layer mocked**.
- Booted `config` safely via fake `test.env`; silenced the logger under `NODE_ENV=test`.
- Chose **mocked repositories** for speed/determinism and named the real-DB tier as a complementary
  next step alongside CI.
- Next: **Phase 17 — Deployment** (Docker, GitHub Actions running this suite, Render).

---

## Further reading

- Vitest — <https://vitest.dev/>
- Supertest — <https://github.com/ladjs/supertest>
- Testing Trophy (integration-heavy) — <https://kentcdodds.com/blog/write-tests>
