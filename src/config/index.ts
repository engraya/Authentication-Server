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
  // Future phases extend this: jwt (Phase 7), email (Phase 11).
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
