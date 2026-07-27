/**
 * src/middlewares/validate.ts
 * ────────────────────────────────────────────────────────────────────
 * A REUSABLE validation middleware factory. Call `validate(schema)` and it
 * returns a middleware that checks `req.body` against that schema BEFORE the
 * controller runs. On failure it throws a ValidationError (→ 422) with
 * field-level details; on success it replaces req.body with the PARSED,
 * normalized data (trimmed, lowercased, typed).
 *
 * This is the "validate at the edge" principle: reject bad input at the boundary
 * so every layer beneath (controller, service, repository) can trust its data.
 *
 * It's a higher-order function (a function returning a function) — the same
 * pattern we'll use for authorize(role) in Phase 10.
 * ────────────────────────────────────────────────────────────────────
 */

import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../errors";

export function validate(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      // Flatten Zod's issue tree into a simple { field: [messages] } map that
      // is safe and useful to return to the client.
      const details = result.error.flatten().fieldErrors;
      throw new ValidationError("Validation failed", details);
    }

    // Overwrite the body with the clean, typed, normalized data.
    req.body = result.data;
    next();
  };
}
