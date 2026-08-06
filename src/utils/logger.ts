/**
 * src/utils/logger.ts
 * ────────────────────────────────────────────────────────────────────
 * A minimal, typed logging helper. WHY not just use `console.log`?
 *   - One consistent format (timestamp + level) across the whole app.
 *   - A single place to later swap in a real logger (pino/winston) without
 *     touching every call site — this is the Separation of Concerns idea.
 *
 * We keep it tiny for Phase 2. In Phase 3 (Auth architecture) and Phase 15
 * (Security hardening) we harden logging further.
 * ────────────────────────────────────────────────────────────────────
 */

// A literal union of the log levels we support. Using a type (not loose
// strings) means a typo like logger["warnn"] is a compile error.
type LogLevel = "info" | "warn" | "error";

// Stay silent under the test runner: the suite deliberately triggers warns/
// errors (bad logins, 401s), and their log lines would drown the test output.
// We read NODE_ENV directly (not `config`) to avoid any import coupling.
const SILENT = process.env.NODE_ENV === "test";

/** Format one log line consistently: 2026-07-25T10:00:00.000Z [INFO] message */
function write(level: LogLevel, message: string, meta?: unknown): void {
  if (SILENT) return;
  const timestamp = new Date().toISOString();
  const line = `${timestamp} [${level.toUpperCase()}] ${message}`;

  // `unknown` (not `any`) forces callers to pass a value we then safely
  // print. We branch on the destination stream: errors go to stderr.
  if (level === "error") {
    console.error(line, meta ?? "");
  } else {
    console.log(line, meta ?? "");
  }
}

// Export a small object with one method per level. Callers write
// `logger.info("server started")` — readable and easy to grep for.
export const logger = {
  info: (message: string, meta?: unknown) => write("info", message, meta),
  warn: (message: string, meta?: unknown) => write("warn", message, meta),
  error: (message: string, meta?: unknown) => write("error", message, meta),
};
