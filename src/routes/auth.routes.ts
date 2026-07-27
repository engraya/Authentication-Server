/**
 * src/routes/auth.routes.ts
 * ────────────────────────────────────────────────────────────────────
 * The /auth router: wires method + path → middleware chain → controller.
 * No logic here — routing is pure wiring (docs 23).
 *
 * The chain for register reads top to bottom:
 *   validate(registerSchema) runs FIRST (rejects bad input with 422),
 *   then authController.register runs only if validation passed.
 * ────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";

import { validate } from "../middlewares/validate";
import { registerSchema } from "../validators/auth.validators";
import { authController } from "../controllers/auth.controller";

export const authRouter = Router();

authRouter.post("/register", validate(registerSchema), authController.register);
