/**
 * src/app.ts
 * ────────────────────────────────────────────────────────────────────
 * Assembles the Express application. Same responsibility as Phase 2 (build,
 * don't listen), but now wired to the Phase 3 architecture: typed `config`,
 * a consistent response envelope, and EXTRACTED middleware for 404 + errors.
 *
 * Pipeline order (top → bottom):
 *   json parser → request logger → routes → notFound → errorHandler
 * ────────────────────────────────────────────────────────────────────
 */

import express, {
  type Application,
  type Request,
  type Response,
  type NextFunction,
} from "express";

import { config } from "./config";
import { logger } from "./utils/logger";
import { apiRouter } from "./routes";
import { notFound } from "./middlewares/notFound";
import { errorHandler } from "./middlewares/errorHandler";
import type { ApiSuccess } from "./types/api";

const app: Application = express();

// ── 1. GLOBAL MIDDLEWARE ────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

// ── 2. ROUTES ───────────────────────────────────────────────────────

// Feature routers, mounted under /api (e.g. POST /api/auth/register).
app.use("/api", apiRouter);

app.get("/health", (_req: Request, res: Response) => {
  // Typed with the success envelope so the shape is guaranteed at compile time.
  const body: ApiSuccess<{
    status: string;
    uptime: number;
    timestamp: string;
    environment: string;
  }> = {
    success: true,
    data: {
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: config.env,
    },
  };
  res.status(200).json(body);
});

app.get("/", (_req: Request, res: Response) => {
  const body: ApiSuccess<{ service: string; version: string; message: string }> = {
    success: true,
    data: {
      service: "authentication-server",
      version: "0.1.0",
      message: "Auth server is running. See /health for status.",
    },
  };
  res.status(200).json(body);
});

// ── 3. FALL-THROUGH: 404, then the global error handler ─────────────
// notFound throws a NotFoundError; errorHandler formats EVERY error (from
// here and from all future routes) into the consistent ApiError envelope.
app.use(notFound);
app.use(errorHandler);

export default app;
