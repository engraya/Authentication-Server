# 18 — Authentication Middleware

> The gate that turns "we issue tokens" into "we enforce them." This chapter covers the `authenticate`
> middleware: reading the Bearer token, verifying it, attaching `req.user`, and the TypeScript
> module augmentation that makes `req.user` type-safe.

---

## What it is

**Authentication middleware** is an Express middleware placed *before* a route handler that requires a
logged-in user. It verifies the access token and, on success, attaches the caller's identity to the
request; on failure it short-circuits with **401** so the handler never runs.

```
request ─► express.json ─► cookieParser ─► [authenticate] ─► route handler
                                              │
                                    valid token? ── no ──► 401 (handler skipped)
                                              │
                                             yes ──► req.user = { id, email } ─► next()
```

Recall the pipeline model (docs 06/23): middleware is just a function `(req, res, next)` that either
calls `next()` to continue or ends the request. `authenticate` is the canonical guard.

---

## What it does, step by step (`src/middlewares/authenticate.ts`)

1. **Read** `Authorization: Bearer <token>`. Missing or not starting with `Bearer ` → throw
   `UnauthorizedError` ("Missing or malformed Authorization header").
2. **Extract** the token after the `Bearer ` prefix; empty → 401.
3. **Verify** it with `verifyAccessToken` (signature + expiry, docs 09). Invalid/expired throws
   `UnauthorizedError` — which the token service already mapped from the `jsonwebtoken` errors.
4. **Attach** `req.user = { id: payload.sub, email: payload.email }`.
5. **`next()`** — the handler now runs with a guaranteed identity.

It's **stateless**: verification is pure cryptography, **no database hit**, so it's cheap to place in
front of many routes. (Contrast a session model, which would look up a session store every request.)

### Why throw instead of `res.status(401)`?
Consistency. Throwing `UnauthorizedError` routes through the **one** global error handler (docs 22),
so every auth failure gets the same envelope and logging. The middleware stays tiny.

---

## `req.user` and module augmentation (the TypeScript piece)

Express's `Request` has no `user` property, so `req.user = ...` would be a **compile error** and reads
would be untyped. Casting to `any` everywhere would throw away type safety. Instead we use **module
augmentation** — adding to another package's types without editing it:

```ts
// src/types/express.d.ts
import type { AuthUser } from "./auth";
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser; // optional — undefined on public routes
    }
  }
}
```

Now `req.user` is typed as `AuthUser | undefined` **everywhere**. Two design points:

- **Optional (`?`)** because on a **public** route nobody authenticated — `req.user` really is
  `undefined` there. The type reflects reality and forces handlers to handle the not-authenticated
  case (our `me` handler guards `if (!req.user)` before use, which also **narrows** the type).
- We keep `AuthUser` **minimal** (id + email) — exactly what the token proves. Anything richer (roles,
  full profile) is read fresh from the DB when needed, so it can't go stale inside a 15-minute token.

`declare global` is required because the file has an `import` (making it a module); without an import,
a bare `namespace Express {}` would also work as ambient. The file is a `.d.ts`, so it emits no
JavaScript — augmentation is purely compile-time; at runtime `req.user = …` is an ordinary property.

---

## Placement & reuse

- Put `authenticate` **before** any handler needing a user: `router.get("/me", authenticate,
  controller.me)`.
- Apply it to a **group** by mounting on a sub-router: `protectedRouter.use(authenticate)` then add
  routes — every route inherits the guard (a pattern we'll use as protected routes grow, docs 20).
- It runs **before** authorization (roles/ownership, docs 08/19): you must know *who* before deciding
  *what they may do*.

---

## Common mistakes

- **Reading `req.user` without the augmentation** → `any`/compile errors, or unsafe casts everywhere.
- **Making `req.user` non-optional** → hides the reality that public routes have no user; invites
  unchecked access.
- **Doing a DB lookup in the middleware** for every request when the token already proves identity —
  unnecessary; fetch the full user only in handlers that need it.
- **Returning 403 for missing/invalid token** — that's **401** (not authenticated); 403 is for
  authenticated-but-forbidden (docs 08).
- **Formatting the 401 inline** instead of throwing → inconsistent responses; throw the typed error.
- **Putting `authenticate` after the handler** or forgetting it entirely → an unprotected route.

---

## Best practices

- **Stateless verification** in the middleware; keep it cheap and DB-free.
- **Throw `UnauthorizedError`**; let the global handler format it.
- Type `req.user` via **module augmentation**, keep it **optional** and **minimal**.
- Guard `if (!req.user)` in handlers (defensive + type narrowing), or use a typed helper.
- Compose with **authorization** middleware next in the chain (Phase 10).

---

## Interview questions

1. **What does authentication middleware do and where does it sit?** Verifies the token and attaches
   identity, before any protected handler; 401s on failure.
2. **Why is it stateless, and what's the benefit?** It verifies a JWT by signature (no DB) → cheap and
   horizontally scalable.
3. **How do you make `req.user` type-safe in TypeScript?** Module augmentation of Express's `Request`
   interface (a `.d.ts` declaring `user?: AuthUser`).
4. **Why is `req.user` optional?** Public routes have no authenticated user; the type must model that
   and force handling.
5. **401 vs 403 in this middleware?** Missing/invalid token → 401 (not authenticated); permission
   checks that fail → 403 (authorization, docs 08).
6. **Why throw instead of writing the response directly?** So all auth failures flow through one
   consistent global error handler.

---

## Summary

- `authenticate` reads the **Bearer** token, **verifies** it statelessly, sets **`req.user`**, and
  calls `next()` — throwing **401** otherwise, via the global handler.
- **Module augmentation** makes `req.user` type-safe and **optional** (undefined on public routes),
  keeping the identity **minimal** (id + email).
- Place it **before** protected handlers and **before** authorization.
- Next: **[20 — Protected Routes](20-Protected-Routes.md)** — applying this guard, and the `/me` route
  it unlocks.

---

## Further reading

- Express: Using middleware — <https://expressjs.com/en/guide/using-middleware.html>
- TypeScript: Declaration merging / module augmentation — <https://www.typescriptlang.org/docs/handbook/declaration-merging.html>
