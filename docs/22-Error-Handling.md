# 22 — Error Handling

> A production API is judged by how it *fails*. This chapter documents the error architecture we built
> in Phase 3: a custom error hierarchy, one global handler, operational-vs-programmer errors, and safe
> responses.

---

## The core idea: throw meaning, format once

Business logic should express *what went wrong* — "email already taken", "user not found" — without
knowing anything about HTTP. A single global handler translates that into a status code and JSON body.

```
   controller/service                 errors/            middlewares/errorHandler
  ┌────────────────────┐   throw    ┌──────────────┐    ┌────────────────────────┐
  │ throw new          │ ─────────► │ ConflictError │──► │ status 409 + safe JSON │
  │  ConflictError(...) │            │ (statusCode) │    │ (one place, always)    │
  └────────────────────┘            └──────────────┘    └────────────────────────┘
```

Benefits: **DRY** (formatting in one place), **Separation of Concerns** (logic doesn't touch HTTP),
and **consistency** (every error looks the same to clients).

---

## The error class hierarchy (`src/errors/`)

`AppError` is an **abstract base** extending the native `Error`. It adds:

- **`statusCode`** — the HTTP status this error maps to.
- **`isOperational`** — `true` for expected conditions we throw deliberately; `false`/absent for bugs.
- **`details?`** — optional structured info (e.g. per-field validation errors).
- **`name`** — set to the concrete subclass name (`"ConflictError"`), exposed as a stable, machine-
  readable code.

Concrete subclasses fix their own status:

| Class | Status | Meaning |
|---|---|---|
| `BadRequestError` | 400 | Malformed/invalid request |
| `UnauthorizedError` | 401 | Not authenticated |
| `ForbiddenError` | 403 | Not permitted |
| `NotFoundError` | 404 | Missing route/resource |
| `ConflictError` | 409 | Duplicate/state conflict |
| `ValidationError` | 422 | Semantically invalid input (+ details) |
| `TooManyRequestsError` | 429 | Rate limited |

### Two TypeScript/JS subtleties in `AppError`

- **`Object.setPrototypeOf(this, new.target.prototype)`** — when you extend a built-in like `Error`
  and compile down-level, `instanceof` can break. Restoring the prototype makes
  `err instanceof AppError` reliable — which the handler depends on.
- **`new.target`** — inside the base constructor, `new.target` is the *actual* subclass being
  constructed, so `this.name` becomes `"ConflictError"`, not `"AppError"`.

---

## Operational vs programmer errors

This distinction drives the handler's behavior:

- **Operational** (expected): bad login, email taken, not found. We *know* the right response — a
  clean 4xx with a safe, specific message. Logged briefly (WARN).
- **Programmer** (bugs): `undefined is not a function`, a null dereference, an unhandled DB failure.
  Unexpected. We return a **generic 500**, **never leak internals**, and log the **full** error (ERROR)
  so we can debug.

`isOperational` (via `instanceof AppError`) is how `errorHandler` tells them apart.

---

## The global handler (`src/middlewares/errorHandler.ts`)

Registered **last**, with **four parameters** `(err, req, res, next)` — Express identifies error
handlers by arity (docs 06). Logic:

1. `err instanceof AppError` → respond `err.statusCode` + `{ success:false, error:{ name, message,
   details? } }`; log WARN.
2. Otherwise → log the full error (ERROR); respond **500** with a generic message. In **development**
   we include the real message to aid debugging; in **production** we stay generic and safe
   (`config.isProduction`).

Every response — success or failure — uses the envelope from `src/types/api.ts`, so clients parse one
shape.

---

## Async errors and Express 5 (important)

In **Express 4**, if an `async` route handler rejected, Express did **not** catch it — you needed a
`try/catch` or an `asyncHandler(fn)` wrapper that funnels rejections into `next(err)`. This wrapper is
a famous Express pattern.

**Express 5 (what we use) changed this: a rejected promise from a route handler is automatically
forwarded to the error handler.** So we deliberately **do not** add an `asyncHandler` utility — it
would be redundant code (**YAGNI**). Knowing *why* it existed, and why it's now unnecessary, is worth
more than shipping it out of habit. (If you ever target Express 4, reintroduce it.)

Synchronous `throw`s in middleware/handlers have always been caught — which is why `notFound.ts` can
simply `throw new NotFoundError(...)`.

---

## Security: never leak internals

- No stack traces, SQL, or exception messages to clients in production.
- Don't reveal *which* part of a credential was wrong ("user not found" vs "wrong password" → say
  "invalid credentials"). Prevents **user enumeration** (expanded in Phases 6/12).
- Log details **server-side** only.

---

## Common mistakes

- **`try/catch` in every controller**, each formatting its own response → inconsistent and repetitive.
  Centralize instead.
- **Leaking error internals** to clients.
- **Forgetting the handler's 4th arg** → Express ignores it as an error handler.
- **Registering the error handler before routes** → it never runs; it must be **last**.
- **Throwing plain strings/objects.** Throw `Error`/`AppError` subclasses so `instanceof` and stacks work.

---

## Best practices

- One **abstract `AppError`** + specific subclasses; **one** global handler, registered last.
- Distinguish **operational vs programmer** errors; safe generic 500 for the latter.
- **Consistent envelope** for all responses.
- Let the **framework** catch async rejections (Express 5) rather than wrapping every handler.

---

## Interview questions

1. **Why a custom error class instead of plain `Error`?** To attach HTTP meaning (`statusCode`) and
   `isOperational`, so one handler formats everything correctly.
2. **Operational vs programmer errors?** Expected conditions with a known response vs bugs → generic
   500, full server-side log, no leaks.
3. **Why must the error handler have four parameters and be registered last?** Express detects error
   handlers by arity; it must sit after all routes to catch their errors.
4. **What is `asyncHandler` and do you need it in Express 5?** A wrapper forwarding async rejections
   to `next`; unnecessary in Express 5, which auto-forwards them.
5. **Why not return the real error message in production?** It can leak internals and enable
   enumeration attacks.

---

## Summary

- **Throw meaning, format once:** an abstract `AppError` hierarchy + one global handler.
- **`isOperational`/`instanceof`** separates expected 4xx from unexpected 500s; internals never leak.
- The handler is **last** and **4-arg**; every response uses the **consistent envelope**.
- **Express 5 auto-catches async rejections**, so we skip `asyncHandler` (YAGNI).
- Next: **[23 — Project Architecture](23-Project-Architecture.md)** — how these pieces fit into layers.

---

## Further reading

- Node.js error-handling guide — <https://nodejs.org/en/learn/error-handling>
- Express error handling — <https://expressjs.com/en/guide/error-handling.html>
