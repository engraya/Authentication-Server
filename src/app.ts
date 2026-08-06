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
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors, { type CorsOptions } from "cors";

import { config } from "./config";
import { logger } from "./utils/logger";
import { apiRouter } from "./routes";
import { apiLimiter } from "./middlewares/rateLimit";
import { notFound } from "./middlewares/notFound";
import { errorHandler } from "./middlewares/errorHandler";
import type { ApiSuccess } from "./types/api";

const app: Application = express();

// Behind a reverse proxy (Render, Nginx) the real client IP and protocol arrive
// in X-Forwarded-* headers. Trusting EXACTLY ONE hop lets req.ip reflect the
// real client (so rate limiting keys on the right address) and lets secure
// cookies see HTTPS — WITHOUT trusting a client-spoofable chain (which would let
// anyone forge their IP to dodge the rate limiter). Only in production.
if (config.isProduction) {
  app.set("trust proxy", 1);
}

// ── 1. SECURITY MIDDLEWARE (runs before everything) ─────────────────
// helmet sets a bundle of protective HTTP response headers (e.g.
// X-Content-Type-Options: nosniff, X-Frame-Options, HSTS in prod) with safe
// defaults — cheap, high-value hardening applied to every response (docs 26).
app.use(helmet());

// CORS: which browser ORIGINS may call this API. A cross-site frontend must be
// in the allowlist; requests with no Origin (curl, mobile, server-to-server)
// are allowed. `credentials: true` lets the browser send our refresh cookie
// cross-origin — which is exactly why the origin must be an explicit allowlist,
// never the "*" wildcard (a wildcard + credentials is forbidden by browsers).
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || config.cors.origins.includes(origin)) {
      return callback(null, true);
    }
    // Not allowed: don't set CORS headers (the browser blocks the response).
    // We don't throw — that would turn a cross-origin GET into a 500.
    return callback(null, false);
  },
  credentials: config.cors.credentials,
};
app.use(cors(corsOptions));

// ── 2. GLOBAL MIDDLEWARE ────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));
// Parses the Cookie header into req.cookies (needed to read the refresh token).
app.use(cookieParser());

app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

// ── 3. ROUTES ───────────────────────────────────────────────────────

// Broad rate limit across the whole API (per-route stricter caps live in the
// auth router). Applied here so every /api request is counted.
app.use("/api", apiLimiter, apiRouter);

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

// ── 4. FALL-THROUGH: 404, then the global error handler ─────────────
// notFound throws a NotFoundError; errorHandler formats EVERY error (from
// here and from all future routes) into the consistent ApiError envelope.
app.use(notFound);
app.use(errorHandler);

export default app;
