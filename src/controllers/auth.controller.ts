/**
 * src/controllers/auth.controller.ts
 * ────────────────────────────────────────────────────────────────────
 * The HTTP ADAPTER for auth. Thin by design: read the (already-validated)
 * request, call ONE service method, and shape the response envelope. No
 * business rules, no DB access here.
 *
 * Note there is NO try/catch: if the service throws, Express 5 forwards the
 * rejected promise straight to our global error handler (docs 22). Controllers
 * stay clean.
 * ────────────────────────────────────────────────────────────────────
 */

import type { Request, Response } from "express";

import { authService } from "../services/auth.service";
import { HttpStatus } from "../constants/httpStatus";
import type { RegisterInput } from "../validators/auth.validators";
import type { ApiSuccess } from "../types/api";
import type { PublicUser } from "../services/auth.service";

export const authController = {
  /** POST /auth/register */
  async register(req: Request, res: Response): Promise<void> {
    // req.body was replaced by the validate() middleware with parsed, typed
    // data, so this cast reflects a guarantee already enforced at the edge.
    const input = req.body as RegisterInput;

    const user = await authService.register(input);

    // 201 Created: a new resource now exists (docs 04).
    const body: ApiSuccess<{ user: PublicUser }> = {
      success: true,
      data: { user },
    };
    res.status(HttpStatus.CREATED).json(body);
  },
};
