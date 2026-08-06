/**
 * src/middlewares/rateLimit.ts
 * ────────────────────────────────────────────────────────────────────
 * Rate limiting (Phase 15). Caps how many requests a single client (by IP)
 * may make inside a rolling time window. Past the cap → 429 Too Many Requests.
 *
 * WHY: without a limit, an attacker can hammer /login with thousands of
 * password guesses (credential stuffing / brute force), or spam /forgot-password
 * and /register to flood inboxes and fill the DB. A limiter turns those from
 * "unlimited attempts" into "a handful per window", which is fatal to automation
 * but invisible to a real user.
 *
 * We build limiters from `express-rate-limit`. The KEY integration choice: its
 * `handler` forwards a `TooManyRequestsError` to `next(...)`, so a rate-limit
 * rejection flows through our ONE global error handler and comes out in the
 * SAME ApiError envelope as every other error (docs 22) — not a bespoke 429.
 *
 * NOTE (production): the default store is IN-MEMORY, so each server instance
 * counts independently. Behind multiple instances / a load balancer you'd swap
 * in a SHARED store (e.g. Redis) so the limit is global. Fine for one instance
 * and for teaching; called out in docs 26.
 * ────────────────────────────────────────────────────────────────────
 */

import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

import { config } from "../config";
import { TooManyRequestsError } from "../errors";

/**
 * Broad limiter for the whole API. Generous — it exists to stop pathological
 * abuse (scrapers, runaway clients), not to inconvenience normal use.
 */
export const apiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: config.security.rateLimit.windowMs,
  limit: config.security.rateLimit.max,
  // Send the standardized `RateLimit-*` headers (how many remain, when it
  // resets) so a well-behaved client can back off; drop the legacy `X-*` ones.
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Route the rejection through our global error handler for a consistent body.
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError());
  },
});

/**
 * Strict limiter for SENSITIVE auth endpoints (login, register, password reset,
 * verification). A much smaller cap: a real user needs only a few attempts;
 * anything more is almost certainly automated abuse.
 */
export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: config.security.rateLimit.windowMs,
  limit: config.security.rateLimit.authMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError("Too many attempts. Please try again later."));
  },
});
