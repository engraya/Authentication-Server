# 20 — Protected Routes

> A protected route is any endpoint that requires a valid identity to reach. This chapter shows how the
> `authenticate` middleware ([18](18-Authentication-Middleware.md)) turns an ordinary route into a
> protected one, using our first example: `GET /api/auth/me`.

---

## Public vs protected

- **Public route** — anyone can call it: `register`, `login`, `refresh` (it authenticates via the
  cookie, not a user session), `health`.
- **Protected route** — requires a verified access token; `req.user` is present. Our first: **`GET
  /api/auth/me`**, which returns the current user's profile.

The ONLY difference in code is the middleware in the chain:

```ts
authRouter.post("/login", validate(loginSchema), authController.login); // public
authRouter.get("/me", authenticate, authController.me);                 // protected
```

`authenticate` runs first; if the token is missing/invalid/expired it 401s and `me` never executes.

---

## The `/me` request flow

```
GET /api/auth/me
  Authorization: Bearer <access token>
        │
        ▼ authenticate            verify token → req.user = { id, email }   (401 if bad)
        ▼ authController.me        guard req.user → authService.getMe(id)
        ▼ authService.getMe        userRepository.findById(id) → toPublicUser (401 if user gone)
        ▼ 200 { success, data:{ user } }
```

### Why re-fetch the user from the DB?
The token proves *who* the caller is (its `sub` claim), but it's a ~15-minute snapshot. Reading the
**live** record means the profile reflects any changes since the token was issued (name updated, etc.)
and lets us detect an account that was **deleted** mid-session (→ 401 "Account no longer exists"). The
token is for *identity*; the database is for *current state*.

We still return a **`PublicUser`** (docs 23) — the `passwordHash` is stripped by the type system, so a
protected profile route can't leak it. Verified: `/me` with a valid token returns the user and **no
`passwordHash`**.

---

## Verified behavior

| Request | Result |
|---|---|
| No `Authorization` header | **401** "Missing or malformed Authorization header" |
| Malformed header (`token abc`) | **401** (not the Bearer scheme) |
| Tampered token | **401** "Invalid access token" |
| Expired token | **401** "Access token expired" |
| Valid token | **200** + user profile (no hash) |

That expired-token 401 is exactly the signal a frontend intercepts to call `/refresh` (docs 12) and
retry — the mechanism that keeps a user logged in without long-lived access tokens.

---

## Write routes: identity from the token, never the body (`PATCH /me`)

Reading your own profile is `GET /me`; **changing** it is `PATCH /me`. The rule that makes it safe:
the target user is **always `req.user.id`** (from the verified token) — never an id in the request
body or URL. So a user can only ever edit *themselves*.

```
PATCH /api/auth/me   { name }
   ▼ authenticate            req.user = { id, ... }
   ▼ validate(updateMeSchema) trims + bounds `name` (422 on empty/too long); STRIPS unknown keys
   ▼ controller.updateMe      authService.updateMe(req.user.id, { name })   ← id from token
   ▼ 200 { user }             returns the updated PublicUser
```

Two defenses working together, both verified:

- **Identity from the token.** We tested `PATCH /me` with a *sneaky* `{ name, id: "…someone-else…" }`
  body — the extra `id` is **ignored** (Zod's `z.object` strips unknown keys, and the service uses
  `req.user.id` regardless). You cannot edit another user by smuggling an id.
- **Whitelist editable fields.** `updateMeSchema` allows **only** `name`. A user must not be able to
  set their own `role`, `email`, or `isEmailVerified` through a self-service endpoint — those need
  dedicated, more-guarded flows (admin action, re-verification). Never spread `req.body` straight into
  an update.

## The protected surface (consolidated)

| Route | Guards | Who |
|---|---|---|
| `GET /me` | `authenticate` | any logged-in user (self) |
| `PATCH /me` | `authenticate` + `validate` | any logged-in user (self) |
| `POST /resend-verification` | `authenticate` | current user |
| `POST /logout-all` | `authenticate` | current user |
| `GET /users/:id` | `authenticate` + `authorizeSelfOrAdmin` | self or admin |
| `GET /admin/users` | `authenticate` + `authorize("ADMIN")` | admin only |

Everything else (`register`, `login`, `refresh`, `logout`, `verify-email`, `forgot-password`,
`reset-password`, `health`) is **public** — several are "credential-in-the-request" routes (the cookie
or a one-time token *is* the credential), not unauthenticated-by-mistake.

## Gating on email verification (a documented pattern)

Some apps require a **verified email** before certain actions. That's an authorization rule with a
twist: verification status **changes** (unlike a role snapshot, it flips exactly once), so a guard
should read it **fresh from the DB**, not from a token claim that could be stale:

```ts
// sketch — add when a route actually needs it
async function requireVerifiedEmail(req, res, next) {
  const user = await userRepository.findById(req.user!.id);
  if (!user?.isEmailVerified) throw new ForbiddenError("Email not verified"); // 403
  next();
}
```

We **don't** ship this middleware yet: no current route needs it, and a guard with no consumer is
dead code (**YAGNI**, docs 23). It's documented here so the pattern is ready the moment a
verification-gated feature appears.

## Protecting groups of routes (as the app grows)

Adding `authenticate` per route is fine for a few; for many, mount it on a **sub-router** so every
route under it inherits the guard:

```ts
const protectedRouter = Router();
protectedRouter.use(authenticate);           // one guard for all below
protectedRouter.get("/me", controller.me);
protectedRouter.patch("/me", controller.updateMe);
// ...
```

Order matters (docs 06): middleware registered earlier runs first. Authentication comes **before**
authorization (roles/ownership, docs 08/19) — you must know *who* before deciding *what they may do*.
We'll layer `authorize(...)` on top in Phase 10.

---

## Common mistakes

- **Forgetting the middleware** on a route that needs it → an accidentally public endpoint (a top
  OWASP issue — "broken access control", docs 08).
- **Trusting a client-supplied id** (e.g. `/users/:id`) instead of `req.user.id` for "my own data" →
  anyone can read others' data. Derive identity from the **token**, not the URL/body.
- **Returning sensitive fields** from a protected route — still strip to `PublicUser`.
- **Not re-checking existence** — a valid token for a deleted user should 401, not 500.
- **Confusing 401 and 403** — unauthenticated is 401; forbidden is 403.

---

## Best practices

- Guard protected routes with `authenticate`; group with a sub-router when there are several.
- Derive "current user" from **`req.user`** (the verified token), never from client input.
- Read **live state** from the DB for profile data; return **`PublicUser`** only.
- Keep **authentication before authorization** in the chain.
- Treat "token valid but user missing" as **401**.

---

## Interview questions

1. **What makes a route "protected"?** An auth middleware in its chain that requires a valid token and
   sets `req.user`.
2. **Why re-fetch the user in `/me` instead of trusting the token's claims?** The token is a snapshot;
   the DB has current state and reveals deletion.
3. **How should "get my own data" derive the user id?** From `req.user.id` (verified token), never from
   a URL/body parameter.
4. **How do you protect many routes at once?** Mount `authenticate` on a sub-router so all child routes
   inherit it.
5. **What's the ordering of authentication vs authorization, and why?** Authentication first (who), then
   authorization (what they may do).

---

## Summary

- A **protected route** is just a route with `authenticate` in front; `GET /api/auth/me` is our first.
- `/me` verifies the token, then reads the **live** user (returning a `PublicUser`), 401-ing on
  missing/invalid/expired tokens or a deleted account — all verified.
- Group protection with a **sub-router**; always derive identity from **`req.user`**, and keep
  **auth before authz**.
- Next: **Phase 10 — Authorization** — roles, permissions, and ownership on top of authentication.

---

## Further reading

- OWASP A01: Broken Access Control — <https://owasp.org/Top10/A01_2021-Broken_Access_Control/>
- Express: Router-level middleware — <https://expressjs.com/en/guide/using-middleware.html#middleware.router>
