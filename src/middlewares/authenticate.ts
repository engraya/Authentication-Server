/**
 * src/middlewares/authenticate.ts
 * ────────────────────────────────────────────────────────────────────
 * The gatekeeper for protected routes. It:
 *   1. reads the `Authorization: Bearer <token>` header,
 *   2. verifies the access token (signature + expiry),
 *   3. attaches the identity to `req.user`,
 *   4. calls next() — or throws UnauthorizedError (→ 401) so the request never
 *      reaches the handler.
 *
 * It's stateless: verification is pure crypto (docs 09), no DB hit — so it's
 * cheap to put in front of many routes. Placed in the pipeline BEFORE any
 * handler that needs a logged-in user (docs 18).
 * ────────────────────────────────────────────────────────────────────
 */

import type { Request, Response, NextFunction } from "express";

import { verifyAccessToken } from "../services/token.service";
import { UnauthorizedError } from "../errors";

const BEARER_PREFIX = "Bearer ";

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  // Must exist and use the Bearer scheme (docs 10).
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token === "") {
    throw new UnauthorizedError("Missing access token");
  }

  // Throws UnauthorizedError on bad signature / expiry (token.service maps the
  // jsonwebtoken errors for us), which Express routes to the global handler.
  const payload = verifyAccessToken(token);

  // Attach the identity for downstream handlers. `sub` is the user id (docs 09).
  // `role` comes straight from the verified token, so authorize() (docs 19) can
  // check permissions without touching the database.
  req.user = { id: payload.sub, email: payload.email, role: payload.role };

  next();
}
