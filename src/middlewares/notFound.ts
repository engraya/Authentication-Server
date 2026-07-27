/**
 * src/middlewares/notFound.ts
 * ────────────────────────────────────────────────────────────────────
 * Runs when no route matched. Instead of formatting a 404 inline (as we did
 * in Phase 2), it THROWS a typed NotFoundError. Express catches the throw and
 * forwards it to the global error handler — so ALL responses, success or
 * failure, flow through one consistent formatter. (DRY + Single Responsibility.)
 * ────────────────────────────────────────────────────────────────────
 */

import type { Request, Response, NextFunction } from "express";
import { NotFoundError } from "../errors";

// Note: even a synchronous `throw` inside Express middleware is caught by
// Express and routed to the error handler — no need to call next() manually.
export function notFound(req: Request, _res: Response, _next: NextFunction): void {
  throw new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
}
