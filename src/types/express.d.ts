/**
 * src/types/express.d.ts
 * ────────────────────────────────────────────────────────────────────
 * MODULE AUGMENTATION — a TypeScript feature that lets us ADD to types declared
 * in another package without editing it. Here we add an optional `user` field to
 * Express's `Request`, so `req.user` is TYPED everywhere after our authenticate
 * middleware sets it. (docs 18)
 *
 * WHY it's needed: Express's built-in Request has no `user` property, so
 * `req.user = ...` would be a compile error and reads would be untyped. Rather
 * than cast to `any` at every call site (throwing away type safety), we teach
 * the compiler about the field ONCE, here.
 *
 * `user` is OPTIONAL because on a PUBLIC route no one has authenticated, so
 * `req.user` is genuinely `undefined` there — the type reflects reality and
 * forces callers to handle the "not authenticated" case.
 * ────────────────────────────────────────────────────────────────────
 */

import type { AuthUser } from "./auth";

// Merge into Express's global namespace. This file has an `import`, so it's a
// module — hence `declare global` to reach the ambient Express namespace.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
