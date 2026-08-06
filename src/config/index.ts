/**
 * src/config/index.ts
 * ────────────────────────────────────────────────────────────────────
 * The SINGLE source of truth for configuration.
 *
 * WHY a dedicated, validated config module?
 *   1. `process.env.X` is always `string | undefined`. Reading it directly
 *      all over the codebase means every call site re-handles "what if it's
 *      missing / not a number?".
 *   2. We want to FAIL FAST: if a required variable is missing or malformed,
 *      the app should refuse to boot with a clear message — NOT crash later,
 *      mid-request, in production, with a cryptic error.
 *   3. Everything downstream imports a clean, fully-typed `config` object and
 *      can trust it. This is the Twelve-Factor "config in the environment"
 *      principle, made type-safe.
 *
 * We validate MANUALLY here (no library) so you can see exactly what a
 * validator does under the hood. In Phase 4 we adopt Zod for *request*
 * validation; the same idea, applied to untrusted user input.
 * ────────────────────────────────────────────────────────────────────
 */

// Load variables from a local .env file into process.env BEFORE we read them.
// In production (Render) there is no .env file and real env vars are already
// present — dotenv simply finds nothing to load and never overrides them.
// This import must run first, so it sits at the very top of the module.
import "dotenv/config";

// Literal union: the app runs in exactly one of these modes.
export type NodeEnv = "development" | "production" | "test";

// We collect every configuration problem, then report them all at once —
// far better DX than fixing one missing var, re-running, hitting the next.
const problems: string[] = [];

/**
 * Read a REQUIRED string. If absent, record a problem (we throw later).
 * Returns "" on failure so type stays `string`; the boot check aborts anyway.
 */
function requireString(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") {
    problems.push(`Missing required env var: ${key}`);
    return "";
  }
  return value;
}

/** Read an OPTIONAL string, falling back to a default. */
function optionalString(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value.trim() === "" ? fallback : value;
}

/**
 * Read a COMMA-SEPARATED list into a string[] (trimmed, empties dropped).
 * Used for the CORS allowlist: CORS_ORIGIN="https://app.com,https://admin.app.com".
 * Falls back to the given default list when the var is absent.
 */
function readList(key: string, fallback: string[]): string[] {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Read a REQUIRED secret and enforce a minimum length. A short JWT signing
 * secret can be brute-forced, letting an attacker FORGE valid tokens — so a
 * weak secret is a real vulnerability we refuse to boot with (docs 09).
 */
function requireSecret(key: string, minLength: number): string {
  const value = requireString(key);
  if (value !== "" && value.length < minLength) {
    problems.push(`Env var ${key} must be at least ${minLength} characters (weak secret)`);
  }
  return value;
}

/** Read a number, validating that it actually parses. */
function readInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    problems.push(`Env var ${key} must be an integer, got "${raw}"`);
    return fallback;
  }
  return parsed;
}

/**
 * Read an integer that must fall within [min, max]. Used for the bcrypt cost
 * factor: too low is insecure, too high makes every login painfully slow.
 * Out-of-range or non-numeric values are recorded as problems (fail fast).
 */
function readIntInRange(key: string, fallback: number, min: number, max: number): number {
  const value = readInt(key, fallback);
  if (value < min || value > max) {
    problems.push(`Env var ${key} must be between ${min} and ${max}, got ${value}`);
    return fallback;
  }
  return value;
}

/** Narrow NODE_ENV into our union, defaulting to development. */
function readNodeEnv(): NodeEnv {
  const raw = optionalString("NODE_ENV", "development");
  if (raw === "production" || raw === "test" || raw === "development") return raw;
  problems.push(`NODE_ENV must be development|production|test, got "${raw}"`);
  return "development";
}

const nodeEnv = readNodeEnv();

/**
 * The exported config object, grouped by concern. `as const` makes it deeply
 * readonly so nothing mutates configuration at runtime.
 *
 * Grouping (app / — later — db, jwt, email) keeps it organized as it grows;
 * Phase 4 adds `db.url`, Phase 7 adds `jwt.*`, Phase 11 adds `email.*`, each
 * registered as REQUIRED via requireString so a bad deploy fails at boot.
 */
export const config = {
  env: nodeEnv,
  isProduction: nodeEnv === "production",
  isDevelopment: nodeEnv === "development",
  isTest: nodeEnv === "test",
  app: {
    port: readInt("PORT", 5000),
  },
  db: {
    // REQUIRED. If DATABASE_URL is absent, the app refuses to boot (below).
    // Prisma reads this same variable directly from .env for its CLI.
    url: requireString("DATABASE_URL"),
  },
  security: {
    // bcrypt cost factor (work factor). Higher = exponentially slower to hash
    // AND to brute-force. Configurable so it can be tuned to each environment's
    // hardware — measure so a login hash stays ≈250–500ms (see docs 14). Bounded
    // to [10, 15]: below 10 is too weak today; above 15 is impractically slow.
    bcryptCostFactor: readIntInRange("BCRYPT_COST", 12, 10, 15),
    // Rate limiting (Phase 15). A rolling window per client IP: too many
    // requests inside the window → 429. Two tiers — a broad cap on the whole
    // API, and a much stricter cap on the sensitive auth endpoints (login,
    // register, password reset) where abuse means brute-force / spam.
    rateLimit: {
      // Window length in ms (default 15 minutes).
      windowMs: readInt("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
      // Max requests per IP per window across the whole API.
      max: readInt("RATE_LIMIT_MAX", 100),
      // Max requests per IP per window on sensitive auth routes (tighter).
      authMax: readInt("AUTH_RATE_LIMIT_MAX", 10),
    },
  },
  cors: {
    // The allowlist of browser origins permitted to call this API. A cross-site
    // SPA must be listed here or the browser blocks its requests. Default to the
    // common local dev origins (Next.js :3000, Vite :5173) so dev works out of
    // the box; set CORS_ORIGIN in production to your real frontend origin(s).
    origins: readList("CORS_ORIGIN", [
      "http://localhost:3000",
      "http://localhost:5173",
    ]),
    // Allow the browser to send credentials (our refresh cookie) cross-origin.
    // Required for the refresh flow to work from a different-origin SPA — and
    // why we can never use a wildcard origin (docs 13/26).
    credentials: true,
  },
  jwt: {
    // The secret used to SIGN and VERIFY access tokens (HMAC/HS256). REQUIRED,
    // and must be long/random — anyone who knows it can forge valid tokens.
    accessSecret: requireSecret("JWT_ACCESS_SECRET", 32),
    // How long an access token is valid. Short by design (docs 10): a leaked
    // token is only useful briefly. A refresh token (Phase 8) handles longevity.
    // Accepts a zeit/ms string ("15m", "1h") or seconds as a number-string.
    accessTtl: optionalString("JWT_ACCESS_TTL", "15m"),
  },
  refresh: {
    // How long a refresh token lives. Longer than the access token (it's the
    // "stay logged in" credential) but bounded, and revocable server-side.
    ttlDays: readIntInRange("REFRESH_TOKEN_TTL_DAYS", 7, 1, 365),
    // The httpOnly cookie the raw refresh token is delivered in (docs 13).
    cookie: {
      name: "refresh_token",
      // Scope the cookie to the auth routes so it's only ever sent where it's
      // needed (refresh/logout) — minimizing its exposure surface.
      path: "/api/auth",
      // Secure (HTTPS-only) in production; off on localhost http during dev.
      secure: nodeEnv === "production",
      // "lax" balances CSRF safety with usability for same-site frontends.
      // A cross-site SPA needs "none" + Secure + CORS credentials (docs 13).
      sameSite: "lax" as const,
    },
  },
  email: {
    // Resend API key (REQUIRED to send). Verification/reset emails fail without it.
    resendApiKey: requireString("RESEND_API_KEY"),
    // The "From" address. Resend's shared onboarding@resend.dev works without a
    // verified domain (but only delivers to your own account email in test mode).
    from: optionalString("EMAIL_FROM", "Auth Server <onboarding@resend.dev>"),
  },
  // Base URL that emailed links point at (a frontend route in production).
  appUrl: optionalString("APP_URL", "http://localhost:5000"),
} as const;

// ── FAIL FAST ───────────────────────────────────────────────────────
// If anything above recorded a problem, refuse to start. Printing to stderr
// (not the logger, to avoid an import cycle) and exiting non-zero means the
// platform sees a failed boot and won't route traffic to a broken instance.
if (problems.length > 0) {
  console.error("✗ Invalid configuration — refusing to start:");
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}

// A type other modules can import if they need to accept config as a param.
export type Config = typeof config;
