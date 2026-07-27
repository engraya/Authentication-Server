# 06 — Express.js

> The framework at the center of this project. If you deeply understand Express's **middleware
> pipeline**, every later phase — auth middleware, authorization, validation, error handling — is just
> a variation on one idea.

---

## Definition

**Express** is a minimal, unopinionated web framework for Node.js. Node's built-in `http` module can
create a server, but it's low-level: you'd hand-parse URLs, methods, and bodies. Express adds a thin,
ergonomic layer over `http` for **routing** (map method+path → handler) and **middleware** (a pipeline
of functions each request flows through). It ships with almost nothing else — you assemble the rest,
which is exactly why it's ideal for *learning* how a backend really works.

---

## History (why it exists)

Express (TJ Holowaychuk, 2010) became the de-facto Node web framework by staying small and composable.
Its middleware model influenced nearly every framework that followed. **Express 5** (the version we
use) modernizes internals — notably a stricter path-matching engine (so the old catch-all `"*"` is
gone; a path-less middleware handles fall-through instead) and better async behavior.

---

## The one concept to master: the middleware pipeline

A **middleware** is a function `(req, res, next) => { ... }`. Express runs the middleware you register
**in the order you register them**, passing each the same `req`/`res` objects. Each middleware can:

- **inspect/modify** `req` or `res` (e.g. parse the body, attach `req.user`),
- **end** the cycle by sending a response (`res.json(...)`), or
- **pass control** onward by calling `next()`.

```
 Incoming request
        │
        ▼
 ┌────────────────────┐
 │ express.json()     │  parse body → req.body, then next()
 └─────────┬──────────┘
           ▼
 ┌────────────────────┐
 │ request logger     │  log method+path, then next()
 └─────────┬──────────┘
           ▼
 ┌────────────────────┐
 │ route: GET /health │  matches? → res.json(...)  (cycle ends here)
 └─────────┬──────────┘
           │ no match falls through
           ▼
 ┌────────────────────┐
 │ 404 handler        │  res.status(404).json(...)
 └─────────┬──────────┘
           ▼ (only if something threw / called next(err))
 ┌────────────────────┐
 │ error handler (4-arg)│ res.status(500).json(...)
 └────────────────────┘
```

This exact pipeline is what our `app.ts` builds. Later phases **insert** middleware into it:
`authenticate` before protected routes, `authorize(role)` after that, `validate(schema)` before
controllers. Nothing new — just more stages.

### `next()` is sacred

- Call `next()` → go to the next stage.
- Call `next(err)` (pass an argument) → **skip straight to the error handler**. This is how we'll
  funnel all errors to one place in Phase 3/22.
- Call *neither* `next()` nor a response method → the request **hangs forever**. This is the single
  most common Express bug.

### Error handlers are special: FOUR arguments

Express distinguishes a normal middleware `(req, res, next)` from an **error handler**
`(err, req, res, next)` **by arity** (the number of parameters). That's why in `app.ts` the error
handler lists all four params even though `next` is unused — drop it and Express stops treating the
function as an error handler.

---

## The `app.ts` / `server.ts` split (Separation of Concerns)

We deliberately split two responsibilities:

- **`app.ts`** — *what the server does*: registers middleware, routes, error handling, then
  `export default app`. It **never calls `listen()`**.
- **`server.ts`** — *how the server boots*: reads the port, calls `app.listen()`, wires graceful
  shutdown and crash guards.

Why bother? **Testability.** In Phase 16, Supertest imports `app` and fires requests at it **without
opening a TCP port** — fast, parallel-safe integration tests. If `app.ts` called `listen()` on import,
every test run would try to bind a real port. This split is standard in production Express codebases.

---

## Key Express APIs used in Phase 2

| API | What it does |
|---|---|
| `express()` | Creates the `Application`. |
| `express.json({ limit })` | Body-parsing middleware: fills `req.body` from a JSON payload; `limit` caps size. |
| `app.use(fn)` | Register middleware for every request (or every path). |
| `app.get(path, handler)` | Register a handler for `GET path`. |
| `req.method`, `req.originalUrl`, `req.body` | Request data. |
| `res.status(code)` | Set the HTTP status. |
| `res.json(obj)` | Send a JSON body (sets `Content-Type: application/json`). |
| `app.listen(port, cb)` | Start listening; returns an `http.Server`. |

---

## TypeScript + Express

We imported **types** alongside values:

```ts
import express, { type Request, type Response, type NextFunction, type Application } from "express";
```

- `Request`, `Response`, `NextFunction` type the middleware/handler parameters so `req.body`,
  `res.json`, etc. are checked and autocompleted.
- The `type` keyword on an import (`import { type Request }`) marks it **type-only**, so it's fully
  erased at compile time and never appears in the emitted JS — cleaner output, no accidental runtime
  dependency.
- Those types come from **`@types/express`** (Express ships no types itself), the same pattern as
  `@types/node` in docs 02.
- **Foreshadowing (Phase 9):** to safely put `req.user` on the request, we'll use **module
  augmentation** to extend Express's `Request` interface — a TypeScript feature that teaches a lot
  about how declaration merging works.

---

## Common mistakes

- **Forgetting `next()`** in a middleware → the request hangs.
- **Wrong middleware order.** `express.json()` must run *before* any handler that reads `req.body`;
  `authenticate` must run *before* the route it protects.
- **Omitting the 4th arg** on an error handler → Express treats it as normal middleware and it never
  catches errors.
- **Using `"*"` for catch-all in Express 5** → throws (path parser changed); use a path-less
  `app.use(...)` instead (what we did for the 404).
- **Calling `listen()` inside the file you import in tests** → ports get bound during testing.
- **Sending two responses** (`res.json()` then `next()` into another responder) → "headers already
  sent" crash.

---

## Best practices

- Keep **`app.ts` free of `listen()`**; boot in `server.ts`.
- Order middleware intentionally: **parse → log → (auth → validate) → route → 404 → error**.
- One **global error handler** at the very end; funnel errors with `next(err)` (built out in Phase 3).
- Import Express types with **`type`** and annotate handler params.
- Cap body size (`limit`) to reduce trivial DoS surface.

---

## Interview questions

1. **What is middleware in Express?** A function `(req, res, next)` in an ordered pipeline that can
   modify req/res, end the response, or pass control with `next()`.
2. **How does Express know a function is an error handler?** By its arity — four parameters
   `(err, req, res, next)`.
3. **What happens if a middleware never calls `next()` or sends a response?** The request hangs until
   it times out.
4. **Why separate `app` from `server`?** So the app can be imported and tested without binding a port
   (Separation of Concerns + testability).
5. **`next()` vs `next(err)`?** The former advances to the next middleware; the latter jumps to the
   error handler.
6. **Why must `express.json()` come before your route handlers?** Handlers read `req.body`, which only
   exists after the body parser runs.

---

## Summary

- Express is a thin layer over Node's `http` giving us **routing** + a **middleware pipeline**.
- The pipeline — parse → log → route → 404 → error — *is* the mental model for the entire project;
  later phases just insert stages.
- `next()` advances the pipeline; error handlers are identified by **four arguments**.
- We split **`app.ts` (behavior)** from **`server.ts` (bootstrap)** for testability and clean
  separation, and typed everything with `@types/express`.
- Next phase (3): **Authentication architecture** — the folder skeleton, config, errors, and the
  theory of authn vs authz.

---

## Further reading

- Express "Using middleware" — <https://expressjs.com/en/guide/using-middleware.html>
- Express 5 migration guide — <https://expressjs.com/en/guide/migrating-5.html>
