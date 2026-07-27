/**
 * src/server.ts
 * ────────────────────────────────────────────────────────────────────
 * The BOOTSTRAP file — the real entry point. Jobs: connect the database,
 * open the TCP port, and shut everything down cleanly when the OS asks.
 *
 * Boot order matters: we connect the DB FIRST. If DATABASE_URL is wrong, the
 * app fails to start (loudly) instead of accepting requests it can't serve.
 * ────────────────────────────────────────────────────────────────────
 */

import type { Server } from "node:http";

import app from "./app";
import { config } from "./config";
import { logger } from "./utils/logger";
import { connectDatabase, disconnectDatabase } from "./database/prisma";

// Hold the HTTP server reference so shutdown() can close it. It's assigned
// inside start(); `undefined` until the server is actually listening.
let server: Server | undefined;

/** Boot sequence: DB first, then HTTP. */
async function start(): Promise<void> {
  await connectDatabase(); // throws on a bad DATABASE_URL → caught below
  server = app.listen(config.app.port, () => {
    logger.info(
      `Auth server listening on http://localhost:${config.app.port} (${config.env})`,
    );
  });
}

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests
 * finish, close the DB pool, then exit. Standard production hygiene so a
 * deploy/restart never drops requests or leaks DB connections.
 */
async function shutdown(signal: string): Promise<void> {
  logger.warn(`Received ${signal} — shutting down gracefully...`);

  // Safety net: if cleanup hangs, force-exit rather than wait forever.
  const forceTimer = setTimeout(() => {
    logger.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);
  forceTimer.unref(); // this timer alone must not keep the process alive

  try {
    // Close the HTTP server (stop new connections, drain existing ones).
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
      logger.info("HTTP server closed.");
    }
    await disconnectDatabase();
    process.exit(0); // clean exit
  } catch (err) {
    logger.error("Error during shutdown", err);
    process.exit(1);
  }
}

// OS signals: SIGTERM (deploy/stop), SIGINT (Ctrl+C). `void` marks the async
// call as intentionally not awaited in this event-handler context.
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Last-resort crash guards: log loudly and exit so the platform restarts a
// clean process rather than limping on in a corrupt state.
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
  process.exit(1);
});

// Kick off boot. If the initial connect/listen fails, log and exit non-zero.
start().catch((err) => {
  logger.error("Failed to start server", err);
  process.exit(1);
});
