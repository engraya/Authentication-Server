/**
 * src/middlewares/errorHandler.ts
 * ────────────────────────────────────────────────────────────────────
 * THE single place every error becomes an HTTP response. Registered LAST in
 * the pipeline, with four arguments (err, req, res, next) so Express treats
 * it as an error handler (see docs 06/22).
 *
 * Responsibilities:
 *   1. Turn a known AppError into its intended status + safe message.
 *   2. Turn ANY unknown error (a bug) into a generic 500 — never leak
 *      internals (stack traces, DB errors) to the client in production.
 *   3. Log appropriately: programmer errors loudly, operational ones briefly.
 * ────────────────────────────────────────────────────────────────────
 */

import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors";
import { HttpStatus } from "../constants/httpStatus";
import { config } from "../config";
import { logger } from "../utils/logger";
import type { ApiError } from "../types/api";

// The 4th param `_next` is unused but MUST be present (prefixed with `_` to
// satisfy noUnusedParameters) so Express recognizes this as an error handler.
export function errorHandler(
  err: unknown, // untrusted: could be an AppError, a bug, or a thrown string
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // ── Case 1: an error we threw on purpose ─────────────────────────
  if (err instanceof AppError) {
    // Operational errors are expected; a one-line info log is enough.
    logger.warn(`${err.name} (${err.statusCode}): ${err.message}`);

    const body: ApiError = {
      success: false,
      error: {
        name: err.name,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // ── Case 2: anything else = an unexpected bug ────────────────────
  // Log the FULL error server-side so we can debug it...
  logger.error("Unexpected error", err);

  // ...but tell the CLIENT nothing specific. In development we surface the
  // message to speed up debugging; in production we stay generic and safe.
  const body: ApiError = {
    success: false,
    error: {
      name: "InternalServerError",
      message: config.isProduction
        ? "Something went wrong. Please try again later."
        : err instanceof Error
          ? err.message
          : "Unknown error",
    },
  };
  res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
}
