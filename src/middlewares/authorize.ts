/**
 * src/middlewares/authorize.ts
 * ────────────────────────────────────────────────────────────────────
 * ROLE-based authorization (docs 08/19). A higher-order middleware: call
 * `authorize("ADMIN")` and it returns a guard that allows the request only if
 * the authenticated user's role is in the allowed set.
 *
 * ORDER MATTERS: this runs AFTER `authenticate` (which sets req.user). You must
 * know WHO before deciding WHAT they may do:
 *
 *     router.get("/admin/users", authenticate, authorize("ADMIN"), handler)
 *
 * Status codes (docs 08):
 *   - no req.user (somehow not authenticated) → 401 UnauthorizedError
 *   - authenticated but wrong role            → 403 ForbiddenError
 * ────────────────────────────────────────────────────────────────────
 */

import type { Request, Response, NextFunction } from "express";
import type { Role } from "@prisma/client";

import { UnauthorizedError, ForbiddenError } from "../errors";

export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Defensive: authorize must be chained after authenticate. If req.user is
    // missing, the route wasn't authenticated → 401, not 403.
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    if (!allowedRoles.includes(req.user.role)) {
      // Authenticated, but this role isn't permitted → 403 (docs 08).
      throw new ForbiddenError("You do not have permission to access this resource");
    }

    next();
  };
}

/**
 * OWNERSHIP authorization: allow the request only if the caller is acting on
 * THEIR OWN resource (req.user.id === the id in the route param) OR is an ADMIN.
 *
 * This guards against "broken access control" / IDOR — where user A reads user
 * B's data just by changing an id in the URL (docs 08). Reusable across any
 * route whose param names the owning user.
 *
 *     router.get("/users/:id", authenticate, authorizeSelfOrAdmin("id"), handler)
 */
export function authorizeSelfOrAdmin(paramName = "id") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const targetId = req.params[paramName];
    const isSelf = targetId === req.user.id;
    const isAdmin = req.user.role === "ADMIN";

    if (!isSelf && !isAdmin) {
      throw new ForbiddenError("You do not have permission to access this resource");
    }

    next();
  };
}
