/**
 * src/errors/AppError.ts
 * ────────────────────────────────────────────────────────────────────
 * The base class for every error WE throw on purpose.
 *
 * WHY a custom error class at all?
 *   A plain `throw new Error("Email taken")` carries no HTTP meaning — the
 *   error handler can't tell a 409 from a 500. By attaching `statusCode` and
 *   an `isOperational` flag to the error itself, our ONE global error handler
 *   can turn any thrown error into the correct HTTP response, with zero
 *   `if/else` chains in controllers.
 *
 * Operational vs programmer errors — a crucial distinction:
 *   - OPERATIONAL: expected, part of normal life (bad login, email taken,
 *     not found). We KNOW how to respond: a clean 4xx with a safe message.
 *   - PROGRAMMER: bugs (undefined is not a function, null deref). These are
 *     unexpected; we must NOT leak details, we return a generic 500, and we
 *     log loudly. `isOperational` lets the handler tell them apart.
 * ────────────────────────────────────────────────────────────────────
 */

import type { HttpStatusCode } from "../constants/httpStatus";

// `abstract` means: you can't do `new AppError(...)` directly. It only exists
// to be EXTENDED by concrete errors (NotFoundError, ConflictError, ...).
// This enforces "every app error has a specific type".
export abstract class AppError extends Error {
  // `readonly` — set once in the constructor, never reassigned afterwards.
  public readonly statusCode: HttpStatusCode;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  protected constructor(
    message: string,
    statusCode: HttpStatusCode,
    // Default true: anything we deliberately throw is an expected condition.
    isOperational = true,
    details?: unknown,
  ) {
    super(message); // set the standard Error `.message`

    this.statusCode = statusCode;
    this.isOperational = isOperational;
    // `exactOptionalPropertyTypes` is on, so we only assign `details` when it
    // was actually provided, rather than setting it to `undefined`.
    if (details !== undefined) this.details = details;

    // `this.name` becomes the concrete subclass name ("ConflictError"), which
    // we expose to clients as a stable, machine-readable error code.
    this.name = new.target.name;

    // Restores the prototype chain so `instanceof` works reliably after the
    // TypeScript→JS down-level of extending built-ins. A well-known TS gotcha.
    Object.setPrototypeOf(this, new.target.prototype);

    // Cleaner stack traces (omit this constructor frame). V8-only, guarded.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}
