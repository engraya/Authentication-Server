/**
 * src/errors/index.ts
 * ────────────────────────────────────────────────────────────────────
 * Concrete, throwable errors — one per HTTP failure we care about. Each
 * fixes its own `statusCode`, so a controller/service simply does:
 *
 *     throw new ConflictError("Email already registered");
 *
 * ...and the global error handler produces a 409 with that message. The HTTP
 * concern lives HERE, not scattered through business logic.
 *
 * Barrel file: re-exports AppError too, so callers `import { ... } from "../errors"`.
 * ────────────────────────────────────────────────────────────────────
 */

import { HttpStatus } from "../constants/httpStatus";
import { AppError } from "./AppError";

/** 400 — the request itself is malformed / invalid. */
export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super(message, HttpStatus.BAD_REQUEST, true, details);
  }
}

/** 401 — not authenticated: missing/invalid/expired credentials or token. */
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, HttpStatus.UNAUTHORIZED, true);
  }
}

/** 403 — authenticated, but not allowed to do this (wrong role/ownership). */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, HttpStatus.FORBIDDEN, true);
  }
}

/** 404 — resource or route does not exist. */
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, HttpStatus.NOT_FOUND, true);
  }
}

/** 409 — conflict with current state (e.g. duplicate email on register). */
export class ConflictError extends AppError {
  constructor(message = "Resource already exists") {
    super(message, HttpStatus.CONFLICT, true);
  }
}

/** 422 — well-formed but semantically invalid; carries field-level details. */
export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, true, details);
  }
}

/** 429 — rate limit exceeded (wired up in Phase 15). */
export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests, please try again later") {
    super(message, HttpStatus.TOO_MANY_REQUESTS, true);
  }
}

// Re-export the base so consumers can `instanceof AppError` from one import.
export { AppError } from "./AppError";
