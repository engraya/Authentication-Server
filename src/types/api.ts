/**
 * src/types/api.ts
 * ────────────────────────────────────────────────────────────────────
 * The SHAPE of every JSON response our API sends. Defining these once means
 * every controller returns a consistent envelope, and any frontend can rely
 * on a single, predictable structure.
 *
 * We use a "discriminated union": the boolean `success` field is the
 * DISCRIMINANT. Once you check `if (body.success)`, TypeScript NARROWS the
 * type — inside that branch `data` exists; in the else branch `error` exists.
 * This is one of TypeScript's most powerful patterns for modeling
 * "either this or that, never both".
 * ────────────────────────────────────────────────────────────────────
 */

/** Success envelope. `T` is a GENERIC — the type of the payload varies per route. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** Error envelope. Shape is stable regardless of which error occurred. */
export interface ApiError {
  success: false;
  error: {
    name: string; // e.g. "ConflictError" — a stable, machine-readable code
    message: string; // human-readable, safe to show
    details?: unknown; // optional field-level info (e.g. validation issues)
  };
}

/** A response is EITHER a success OR an error — never both. */
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
