/**
 * src/routes/index.ts
 * ────────────────────────────────────────────────────────────────────
 * The root API router. Mounts every feature router under its prefix, so
 * app.ts has ONE thing to mount. As we add features (/me in Phase 14, etc.)
 * they register here — app.ts never changes.
 * ────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";

import { authRouter } from "./auth.routes";

export const apiRouter = Router();

// All auth endpoints live under /auth (e.g. POST /auth/register).
apiRouter.use("/auth", authRouter);
