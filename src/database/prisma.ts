/**
 * src/database/prisma.ts
 * ────────────────────────────────────────────────────────────────────
 * The Prisma Client SINGLETON — one shared database connection pool for the
 * whole app.
 *
 * WHY a singleton? Each `new PrismaClient()` opens its own pool of DB
 * connections. Creating one per request (or per module) would exhaust the
 * database's connection limit almost immediately. We create exactly ONE and
 * import it everywhere.
 *
 * The `globalThis` trick guards against a specific dev-mode footgun: tools
 * like `tsx watch` reload modules on save, which could otherwise spawn a NEW
 * client on every reload and leak connections. Caching it on globalThis means
 * reloads reuse the same instance.
 * ────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from "@prisma/client";
import { config } from "../config";
import { logger } from "../utils/logger";

// Tell TypeScript about the extra property we stash on the global object.
// `var` is required for correct global-augmentation semantics here.
declare global {
  // `var` (not let/const) is required so this merges onto globalThis correctly.
  var __prisma__: PrismaClient | undefined;
}

// Reuse an existing client (dev hot-reload) or create one. In production the
// global is empty on first run, so we make exactly one.
export const prisma =
  globalThis.__prisma__ ??
  new PrismaClient({
    // Log queries only in development; keep production logs to warnings/errors.
    log: config.isDevelopment ? ["warn", "error"] : ["error"],
  });

if (config.isDevelopment) {
  globalThis.__prisma__ = prisma;
}

/**
 * Verify connectivity at boot. We RETRY with backoff because serverless
 * Postgres (e.g. Neon) auto-suspends when idle; the first connection has to
 * WAKE it, and a single attempt can time out mid-wake (Prisma error P1001).
 * Retrying briefly turns a transient cold-start into a successful boot, while a
 * genuinely bad DATABASE_URL still fails after the attempts are exhausted.
 */
export async function connectDatabase(retries = 5, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prisma.$connect();
      logger.info("Database connected (PostgreSQL via Prisma).");
      return;
    } catch (err) {
      if (attempt === retries) throw err; // out of tries → let boot fail loudly
      logger.warn(
        `Database not reachable (attempt ${attempt}/${retries}) — retrying in ${delayMs}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Close the pool cleanly during graceful shutdown (see server.ts). */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info("Database disconnected.");
}
