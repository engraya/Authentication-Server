/**
 * vitest.config.ts
 * ────────────────────────────────────────────────────────────────────
 * Vitest is our test runner (Phase 16). It's Vite-powered, so it runs
 * TypeScript directly — no separate compile step — and gives a fast watch mode.
 *
 * The important part here is `test.env`: our `config` module (docs 03) validates
 * required env vars AT IMPORT and calls process.exit(1) if any are missing. Tests
 * import the app, which imports config — so we must supply FAKE-but-valid values
 * BEFORE that import runs. Vitest sets these on process.env before loading any
 * test file, and because `dotenv` never overrides existing vars, these win over
 * the real .env — so tests never touch real secrets or the real database.
 * ────────────────────────────────────────────────────────────────────
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // this is a backend; no DOM
    include: ["tests/**/*.test.ts"],
    // Fake, deterministic config for the test process. The DB is never actually
    // connected — repositories are mocked — so a placeholder URL is fine.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/testdb?schema=public",
      JWT_ACCESS_SECRET: "test-jwt-secret-at-least-32-chars-long-000",
      JWT_ACCESS_TTL: "15m",
      RESEND_API_KEY: "re_test_placeholder_key",
      EMAIL_FROM: "Auth Test <onboarding@resend.dev>",
      APP_URL: "http://localhost:5000",
      // Cost 10 = fastest allowed bcrypt, so hashing tests stay snappy.
      BCRYPT_COST: "10",
      // Effectively disable rate limiting during tests so it can't cause flaky
      // cross-test 429s (the limiter itself was verified live in Phase 15).
      RATE_LIMIT_MAX: "1000000",
      AUTH_RATE_LIMIT_MAX: "1000000",
    },
  },
});
