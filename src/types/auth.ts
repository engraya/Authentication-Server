/**
 * src/types/auth.ts
 * ────────────────────────────────────────────────────────────────────
 * The identity we attach to an authenticated request. Deliberately minimal —
 * id + email + role. `role` is included so the authorize() middleware (docs 19)
 * can make access decisions WITHOUT a database lookup, keeping it stateless.
 *
 * `Role` is imported from the generated Prisma client, so our app types stay in
 * lockstep with the database enum — add a role in schema.prisma and it flows
 * through here automatically.
 * ────────────────────────────────────────────────────────────────────
 */

import type { Role } from "@prisma/client";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}
