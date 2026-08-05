/**
 * src/services/token.service.ts
 * ────────────────────────────────────────────────────────────────────
 * Creates and verifies ACCESS TOKENS (short-lived JWTs). This is the only
 * module that knows about the `jsonwebtoken` library — everything else deals
 * in our typed payload. Full theory: docs/09-JWT.md and docs/10-Access-Tokens.md.
 *
 * A JWT is three Base64url parts joined by dots:  header.payload.signature
 *   - header    : { alg: "HS256", typ: "JWT" }
 *   - payload   : our claims (who the user is + standard fields like exp)
 *   - signature : HMAC-SHA256(header.payload, secret)
 * The payload is only ENCODED, not encrypted — anyone can read it. The
 * SIGNATURE is what makes it trustworthy: without the secret you cannot produce
 * a valid one, and changing any byte invalidates it. So: never put secrets in
 * the payload; do rely on the signature for integrity/authenticity.
 * ────────────────────────────────────────────────────────────────────
 */

import jwt, { type SignOptions } from "jsonwebtoken";
import { Role } from "@prisma/client";

import { config } from "../config";
import { UnauthorizedError } from "../errors";

// The claims WE put in an access token. `sub` (subject) is a registered JWT
// claim conventionally holding the user id; `email` and `role` are our claims.
// `role` travels IN the token so authorization needs no DB lookup (docs 19).
export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  role: Role;
}

// Minimal shape we need from a user to mint a token (structural typing: any
// object with these fields fits — we don't import the full Prisma User).
interface TokenUser {
  id: string;
  email: string;
  role: Role;
}

// Runtime set of valid role strings, derived from the Prisma enum, used to
// validate the `role` claim when verifying an incoming token.
const VALID_ROLES = new Set<string>(Object.values(Role));

/**
 * Sign a short-lived access token for a user.
 * `subject` sets the standard `sub` claim; `expiresIn` sets `exp`. The library
 * also stamps `iat` (issued-at) automatically.
 */
export function signAccessToken(user: TokenUser): string {
  const payload = { email: user.email, role: user.role };
  const options: SignOptions = {
    subject: user.id,
    // config.jwt.accessTtl is a plain string ("15m"); jsonwebtoken's types want
    // its own ms-string/number union. `NonNullable` drops `undefined` so it
    // satisfies our strict `exactOptionalPropertyTypes` compiler setting.
    expiresIn: config.jwt.accessTtl as NonNullable<SignOptions["expiresIn"]>,
  };
  return jwt.sign(payload, config.jwt.accessSecret, options);
}

/**
 * Verify a token's signature + expiry and return the typed payload.
 * Translates the library's error types into our UnauthorizedError (401) so the
 * global handler responds consistently. Used by the auth middleware (Phase 9).
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret);

    // `verify` returns `string | JwtPayload`; narrow it and confirm our claims.
    if (
      typeof decoded === "string" ||
      typeof decoded.sub !== "string" ||
      typeof decoded.email !== "string" ||
      typeof decoded.role !== "string" ||
      !VALID_ROLES.has(decoded.role)
    ) {
      throw new UnauthorizedError("Invalid access token");
    }

    return { sub: decoded.sub, email: decoded.email, role: decoded.role as Role };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("Access token expired");
    }
    if (err instanceof jwt.JsonWebTokenError) {
      // Covers bad signature, malformed token, etc.
      throw new UnauthorizedError("Invalid access token");
    }
    throw err; // anything else is unexpected
  }
}
