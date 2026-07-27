# 05 — REST APIs

> REST is the design discipline that turns a pile of HTTP endpoints into a coherent, predictable API.
> Our auth server follows REST conventions so any frontend developer can guess how it works.

---

## Definition

**REST** (Representational State Transfer) is an **architectural style** — a set of constraints, not a
library or protocol — described by Roy Fielding in his 2000 PhD dissertation. A "RESTful" HTTP API
models the system as **resources** (nouns) identified by **URLs**, manipulated with **HTTP methods**
(verbs), exchanging **representations** (usually JSON).

The core idea: **URLs are nouns, methods are verbs.**

```
GET    /users        → list users
POST   /users        → create a user
GET    /users/42     → read user 42
PATCH  /users/42     → update user 42
DELETE /users/42     → delete user 42
```

Not RESTful (verbs in the URL — a common beginner smell):

```
POST /createUser     ✗
GET  /getUser?id=42  ✗
POST /deleteUser     ✗
```

---

## The constraints that matter to us

REST defines several constraints; the two most relevant here:

- **Statelessness.** Each request carries everything the server needs to handle it — including
  authentication. The server keeps no per-client session in memory between requests. This aligns
  perfectly with token-based auth (docs 09–12) and lets us run **multiple server instances** behind a
  load balancer (an in-memory session on instance A is useless when the next request hits instance B).
- **Uniform interface.** Consistent resource URLs + standard methods + standard status codes, so the
  API is predictable and self-describing.

---

## A pragmatic note: auth endpoints aren't purely "resourceful"

Strict REST models resources, but login/logout/refresh are **actions**, not nouns. The widely
accepted, pragmatic convention is a small `/auth` action namespace:

```
POST /auth/register        → create account            (201)
POST /auth/login           → issue tokens               (200)
POST /auth/logout          → revoke session             (204)
POST /auth/refresh         → rotate access token        (200)
POST /auth/verify-email    → confirm email              (200)
POST /auth/forgot-password → email a reset link         (200/202)
POST /auth/reset-password  → set new password           (200)
GET  /me                   → current user's profile     (200)
```

This is exactly the layout we'll build. It's how most real auth APIs (including many commercial ones)
are shaped — resource-style where natural (`/me`), action-style where honest (`/auth/login`).

---

## Designing good responses

- Return the **right status code** (see docs 04) — the status *is* part of the API.
- Use a **consistent JSON envelope**. We'll standardize on shapes like:
  ```json
  { "data": { ... } }                         // success
  { "error": "Conflict", "message": "..." }   // failure
  ```
- **Never leak internals** in errors (stack traces, SQL, whether an email exists — the last one is a
  security concern we handle in Phase 12/17).
- **Version** the API when it stabilizes (e.g. `/api/v1/...`) so you can evolve without breaking
  clients. We'll introduce a version prefix when routes solidify.

---

## Common mistakes

- **Verbs in URLs** (`/getUser`, `/updateUserProfile`). Use nouns + HTTP methods.
- **Everything is POST and returns 200.** Wastes the expressiveness of methods and status codes.
- **Inconsistent shapes** — one endpoint returns `{user}`, another returns the user object bare.
  Frontends hate surprises; pick one envelope.
- **Stateful hacks** (storing per-user data in a module-level variable). Breaks the moment you run two
  instances — and you *will* on Render.

---

## Best practices

- **Nouns for resources, verbs for actions**, `/auth/*` namespace for auth flows.
- **Stateless** request handling — all identity travels in the token/cookie, nothing in server memory.
- **Consistent envelopes + correct status codes** everywhere.
- Plan for **versioning** before external clients depend on you.

---

## Interview questions

1. **What is REST?** An architectural style modeling resources via URLs and HTTP methods, with
   constraints like statelessness and a uniform interface.
2. **Why does REST statelessness pair well with token auth?** Each request self-authenticates, so the
   server needs no session memory and can scale horizontally.
3. **Is `POST /login` "RESTful"?** Not strictly (it's an action), but it's the accepted pragmatic
   convention; REST is a guideline, not dogma.
4. **How do you keep an API predictable?** Consistent URLs, methods, status codes, and response
   envelopes; versioning for breaking changes.

---

## Summary

- REST = **resources (URLs) + methods (verbs) + representations (JSON)** under a few constraints.
- **Statelessness** is the constraint that makes token auth and horizontal scaling work.
- Auth flows use a pragmatic **`/auth/*` action namespace**; profile is the RESTful `/me`.
- Consistency (codes + envelopes) is what makes an API pleasant to consume.
- Next: **[06 — Express](06-Express.md)**, the framework that implements all of this.

---

## Further reading

- MDN "What is REST?" — <https://developer.mozilla.org/en-US/docs/Glossary/REST>
- Microsoft REST API design guidelines — <https://github.com/microsoft/api-guidelines>
