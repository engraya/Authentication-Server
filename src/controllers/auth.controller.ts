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
import { verificationService } from "../services/verification.service";
import { passwordResetService } from "../services/passwordReset.service";
import { HttpStatus } from "../constants/httpStatus";
import { config } from "../config";
import { UnauthorizedError } from "../errors";
import type {
  RegisterInput,
  LoginInput,
  VerifyEmailInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  UpdateMeInput,
} from "../validators/auth.validators";
import type { ApiSuccess } from "../types/api";
import type { PublicUser } from "../services/auth.service";

/**
 * Write the raw refresh token into an httpOnly cookie. `httpOnly` means client
 * JavaScript can't read it → an XSS bug can't steal the refresh token (docs 13).
 * `secure`/`sameSite`/`path` come from config. `expires` bounds its lifetime.
 */
function setRefreshCookie(res: Response, rawToken: string, expiresAt: Date): void {
  res.cookie(config.refresh.cookie.name, rawToken, {
    httpOnly: true,
    secure: config.refresh.cookie.secure,
    sameSite: config.refresh.cookie.sameSite,
    path: config.refresh.cookie.path,
    expires: expiresAt,
  });
}

/**
 * Remove the refresh cookie from the browser. The options (name, path, and the
 * security flags) MUST MATCH those used when setting it, or the browser treats
 * it as a different cookie and won't clear it — a classic logout bug.
 */
function clearRefreshCookie(res: Response): void {
  res.clearCookie(config.refresh.cookie.name, {
    httpOnly: true,
    secure: config.refresh.cookie.secure,
    sameSite: config.refresh.cookie.sameSite,
    path: config.refresh.cookie.path,
  });
}

export const authController = {
  /** POST /auth/register */
  async register(req: Request, res: Response): Promise<void> {
    // req.body was replaced by the validate() middleware with parsed, typed
    // data, so this cast reflects a guarantee already enforced at the edge.
    const input = req.body as RegisterInput;

    const { user, accessToken, refreshToken, refreshTokenExpiresAt } =
      await authService.register(input);

    // Refresh token → httpOnly cookie (never the JSON body).
    setRefreshCookie(res, refreshToken, refreshTokenExpiresAt);

    // 201 Created: a new resource now exists (docs 04).
    const body: ApiSuccess<{ user: PublicUser; accessToken: string }> = {
      success: true,
      data: { user, accessToken },
    };
    res.status(HttpStatus.CREATED).json(body);
  },

  /** POST /auth/login */
  async login(req: Request, res: Response): Promise<void> {
    const input = req.body as LoginInput;

    const { user, accessToken, refreshToken, refreshTokenExpiresAt } =
      await authService.login(input);

    setRefreshCookie(res, refreshToken, refreshTokenExpiresAt);

    // 200 OK: no new resource created; we verified an existing one (docs 04).
    const body: ApiSuccess<{ user: PublicUser; accessToken: string }> = {
      success: true,
      data: { user, accessToken },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * POST /auth/refresh
   * Reads the refresh token from the httpOnly cookie (NOT the body), rotates it,
   * sets the new cookie, and returns a fresh access token.
   */
  async refresh(req: Request, res: Response): Promise<void> {
    const rawToken = req.cookies?.[config.refresh.cookie.name] as string | undefined;
    if (!rawToken) {
      throw new UnauthorizedError("Missing refresh token");
    }

    const { user, accessToken, refreshToken, refreshTokenExpiresAt } =
      await authService.refresh(rawToken);

    setRefreshCookie(res, refreshToken, refreshTokenExpiresAt);

    const body: ApiSuccess<{ user: PublicUser; accessToken: string }> = {
      success: true,
      data: { user, accessToken },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * GET /auth/me  (PROTECTED — runs after the authenticate middleware)
   * Returns the current authenticated user's profile.
   */
  async me(req: Request, res: Response): Promise<void> {
    // authenticate guarantees req.user is set; guard anyway so the type narrows
    // and we never trust an unauthenticated request by accident.
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const user = await authService.getMe(req.user.id);

    const body: ApiSuccess<{ user: PublicUser }> = {
      success: true,
      data: { user },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * PATCH /auth/me  (PROTECTED)
   * Update the current user's own profile. Identity comes from req.user (the
   * verified token), NEVER from the body — a user can only edit themselves.
   */
  async updateMe(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const input = req.body as UpdateMeInput;
    const user = await authService.updateMe(req.user.id, input);

    const body: ApiSuccess<{ user: PublicUser }> = {
      success: true,
      data: { user },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * GET /auth/users/:id  (PROTECTED + OWNERSHIP)
   * Reachable only via authenticate + authorizeSelfOrAdmin, so by the time we
   * get here the caller is allowed to see this user (self or admin).
   */
  async getUserById(req: Request, res: Response): Promise<void> {
    const user = await authService.getUserById(req.params.id as string);

    const body: ApiSuccess<{ user: PublicUser }> = {
      success: true,
      data: { user },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * POST /auth/verify-email  (PUBLIC — the token IS the credential)
   * Consumes the one-time token from the emailed link and marks the email verified.
   */
  async verifyEmail(req: Request, res: Response): Promise<void> {
    const { token } = req.body as VerifyEmailInput;

    await verificationService.verifyEmail(token);

    const body: ApiSuccess<{ message: string }> = {
      success: true,
      data: { message: "Email verified successfully" },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * POST /auth/logout  (PUBLIC — driven by the refresh cookie)
   * Revokes the current refresh token and clears the cookie. Idempotent: even
   * with no/expired cookie it returns 200, so logout never errors.
   *
   * NOTE: the ACCESS token is NOT revoked — it's stateless and can't be
   * un-signed. It simply expires within its short TTL (docs 10/12). "Logout"
   * means "end the refreshable session"; the client also discards its access
   * token from memory.
   */
  async logout(req: Request, res: Response): Promise<void> {
    const rawToken = req.cookies?.[config.refresh.cookie.name] as string | undefined;
    if (rawToken) {
      await authService.logout(rawToken);
    }
    clearRefreshCookie(res);

    const body: ApiSuccess<{ message: string }> = {
      success: true,
      data: { message: "Logged out" },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * POST /auth/logout-all  (PROTECTED)
   * Revokes EVERY refresh token for the current user ("sign out everywhere")
   * and clears this browser's cookie.
   */
  async logoutAll(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const revoked = await authService.logoutAll(req.user.id);
    clearRefreshCookie(res);

    const body: ApiSuccess<{ message: string; sessionsRevoked: number }> = {
      success: true,
      data: { message: "Logged out of all sessions", sessionsRevoked: revoked },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * POST /auth/forgot-password  (PUBLIC)
   * ALWAYS returns 200 with the same message, whether or not the email exists —
   * so it can't be used to discover which emails are registered (docs 17/31).
   */
  async forgotPassword(req: Request, res: Response): Promise<void> {
    const { email } = req.body as ForgotPasswordInput;

    await passwordResetService.requestReset(email);

    const body: ApiSuccess<{ message: string }> = {
      success: true,
      data: {
        message: "If an account exists for that email, a reset link has been sent.",
      },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * POST /auth/reset-password  (PUBLIC — the token is the credential)
   * Sets a new password and revokes all existing sessions.
   */
  async resetPassword(req: Request, res: Response): Promise<void> {
    const { token, newPassword } = req.body as ResetPasswordInput;

    await passwordResetService.resetPassword(token, newPassword);

    const body: ApiSuccess<{ message: string }> = {
      success: true,
      data: { message: "Password has been reset. Please log in with your new password." },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * POST /auth/resend-verification  (PROTECTED)
   * Re-sends the verification email to the current, not-yet-verified user.
   */
  async resendVerification(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    await verificationService.resendVerification(req.user.id);

    const body: ApiSuccess<{ message: string }> = {
      success: true,
      data: { message: "Verification email sent" },
    };
    res.status(HttpStatus.OK).json(body);
  },

  /**
   * GET /auth/admin/users  (PROTECTED + ADMIN-ONLY)
   * Reachable only via authenticate + authorize("ADMIN").
   */
  async listUsers(_req: Request, res: Response): Promise<void> {
    const users = await authService.listUsers();

    const body: ApiSuccess<{ users: PublicUser[]; count: number }> = {
      success: true,
      data: { users, count: users.length },
    };
    res.status(HttpStatus.OK).json(body);
  },
};
