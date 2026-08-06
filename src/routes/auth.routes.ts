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
import { authenticate } from "../middlewares/authenticate";
import { authorize, authorizeSelfOrAdmin } from "../middlewares/authorize";
import { authLimiter } from "../middlewares/rateLimit";
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateMeSchema,
} from "../validators/auth.validators";
import { authController } from "../controllers/auth.controller";

export const authRouter = Router();

// authLimiter (Phase 15): a strict per-IP cap on the sensitive endpoints —
// register/login (brute force, credential stuffing) and the email-driven flows
// (spam / inbox flooding). It runs FIRST in each chain so throttled requests
// are rejected before we touch validation, the DB, or the mailer.
authRouter.post("/register", authLimiter, validate(registerSchema), authController.register);
authRouter.post("/login", authLimiter, validate(loginSchema), authController.login);
// No body to validate — the refresh token comes from the httpOnly cookie.
authRouter.post("/refresh", authController.refresh);
// PUBLIC: logout is driven by the refresh cookie (works even if the access
// token has expired). Idempotent.
authRouter.post("/logout", authController.logout);
// PROTECTED: "sign out everywhere" needs to know which user.
authRouter.post("/logout-all", authenticate, authController.logoutAll);
// PUBLIC: the one-time token in the body is itself the credential.
authRouter.post("/verify-email", authLimiter, validate(verifyEmailSchema), authController.verifyEmail);
// PUBLIC: forgot/reset password (both driven by the emailed one-time token).
// authLimiter blunts inbox-flooding (forgot) and token-guessing (reset).
authRouter.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
authRouter.post("/reset-password", authLimiter, validate(resetPasswordSchema), authController.resetPassword);
// PROTECTED: authenticate runs first; only a valid access token reaches `me`.
authRouter.get("/me", authenticate, authController.me);
// PROTECTED WRITE: update your own profile (identity from the token, not body).
authRouter.patch("/me", authenticate, validate(updateMeSchema), authController.updateMe);
// PROTECTED: re-send the verification email to the current user. authLimiter
// too — even an authenticated user shouldn't be able to trigger a mail flood.
authRouter.post("/resend-verification", authLimiter, authenticate, authController.resendVerification);
// ADMIN-ONLY: authenticate → authorize("ADMIN") → handler.
authRouter.get("/admin/users", authenticate, authorize("ADMIN"), authController.listUsers);
// OWNERSHIP: self or admin may view a given user (docs 08/19).
authRouter.get("/users/:id", authenticate, authorizeSelfOrAdmin("id"), authController.getUserById);
