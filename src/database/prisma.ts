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

/** Verify connectivity at boot so a bad DATABASE_URL fails fast, loudly. */
export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info("Database connected (PostgreSQL via Prisma).");
}

/** Close the pool cleanly during graceful shutdown (see server.ts). */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info("Database disconnected.");
}
