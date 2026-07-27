/**
 * src/constants/httpStatus.ts
 * ────────────────────────────────────────────────────────────────────
 * Named HTTP status codes, so the codebase reads `HttpStatus.CONFLICT`
 * instead of a bare `409`. Self-documenting and typo-proof (a mistyped
 * property is a compile error; a mistyped `490` literal is not).
 *
 * WHY a `const` object with `as const` and NOT a TypeScript `enum`?
 *   - `as const` objects are a plain JS object at runtime with narrow literal
 *     types at compile time — zero surprises, tree-shakeable, easy to iterate.
 *   - TS `enum`s generate extra runtime code and have quirky reverse-mapping
 *     behavior; the modern community lean is "prefer const objects to enums".
 *   You now understand enums by contrast — see docs 25 (TS best practices).
 * ────────────────────────────────────────────────────────────────────
 */

export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// A union type of the VALUES: 200 | 201 | ... | 500. Functions can accept
// `HttpStatusCode` to guarantee only a real status code is passed.
export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus];
