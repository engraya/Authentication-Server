# 24 — Folder Structure

> Every folder in `src/` earns its place. This chapter is the map: what each directory is for, when
> to use it, and — importantly — when it should *not* exist. Folders marked *(planned)* are
> introduced in the phase noted.

---

## The layout

```
src/
├─ config/          Typed, validated configuration (single source of truth).      [Phase 1/3]
├─ constants/       Fixed values: HTTP status codes, enums, token TTLs.           [Phase 3]
├─ types/           Shared TypeScript types (API envelope, module augmentation).  [Phase 3]
├─ errors/          AppError base + concrete HTTP error classes.                   [Phase 3]
├─ utils/           Small, dependency-free helpers (logger; later token helpers). [Phase 2]
├─ middlewares/     Pipeline stages: notFound, errorHandler; later auth/validate. [Phase 3]
├─ interfaces/      Service/DTO contracts (interfaces between layers).   (planned) [Phase 4]
├─ validators/      Zod schemas per route + a validate() middleware.     (planned) [Phase 4]
├─ repositories/    Data access — the only layer touching Prisma.        (planned) [Phase 4]
├─ services/        Business logic (HTTP-free).                          (planned) [Phase 4]
├─ controllers/     Thin HTTP adapters: req → service → res envelope.    (planned) [Phase 4]
├─ routes/          Express routers mapping paths → middleware → controller.(planned)[Phase 4]
├─ database/        Prisma client singleton + connection lifecycle.      (planned) [Phase 4]
├─ emails/          Resend client + email templates.                     (planned) [Phase 11]
├─ app.ts           Assembles the Express app (no listen).                         [Phase 2]
└─ server.ts        Bootstraps: listen + graceful shutdown.                        [Phase 2]

prisma/schema.prisma   DB schema & migrations.                           (planned) [Phase 4]
docs/                  This handbook (numbered chapters).                          [ongoing]
tests/                 Vitest unit + Supertest integration.              (planned) [Phase 16]
```

> **Why some folders don't exist yet:** creating empty directories "for later" is a mild YAGNI
> violation (and git won't even track them). We add each folder in the phase that first needs it, so
> the structure always reflects real, working code — not aspiration.

---

## Folder-by-folder: purpose · when to use · when NOT to

### `config/`
- **Purpose:** read + validate env vars once; export a typed `config`. Fail-fast on bad config.
- **Use when:** any value differs across environments or is secret.
- **Not when:** it's a true constant (that's `constants/`). Don't scatter `process.env` elsewhere.

### `constants/`
- **Purpose:** fixed, environment-independent values (`HttpStatus`, role names, token TTLs).
- **Use when:** a literal is reused or benefits from a name (`HttpStatus.CONFLICT` > `409`).
- **Not when:** the value is configurable/secret → `config/`.

### `types/`
- **Purpose:** shared types and **module augmentation** (e.g. adding `req.user` to Express in Phase 9).
- **Use when:** a type is used across layers, or you're extending a library's types.
- **Not when:** a type is local to one file — declare it inline there.

### `errors/`
- **Purpose:** the `AppError` hierarchy; the vocabulary of failure.
- **Use when:** you need to signal a specific HTTP failure from anywhere (`throw new ConflictError`).
- **Not when:** it's a one-off internal condition better handled locally.

### `utils/`
- **Purpose:** small, generic, side-effect-light helpers (logger; later `hashToken`, etc.).
- **Use when:** logic is reused and belongs to no specific domain.
- **Not when:** it's business logic (→ `services/`) or data access (→ `repositories/`). A bloated
  "utils dump" is a code smell — keep helpers focused.

### `middlewares/`
- **Purpose:** reusable pipeline stages (`notFound`, `errorHandler`; later `authenticate`,
  `authorize`, `validate`).
- **Use when:** a concern is cross-cutting (runs for many routes).
- **Not when:** logic is specific to one controller — put it in the controller/service.

### `validators/` *(Phase 4)*
- **Purpose:** Zod schemas describing valid input + a `validate()` middleware.
- **Not when:** trivially covered by types (types don't run at runtime — untrusted input still needs
  runtime validation).

### `repositories/` *(Phase 4)*
- **Purpose:** the **only** place Prisma/DB queries live.
- **Not when:** you're tempted to query the DB from a service/controller — always go through here.

### `services/` *(Phase 4)*
- **Purpose:** business logic, HTTP-free. The heart of the app.
- **Not when:** you reach for `req`/`res` — that means the code belongs in a controller.

### `controllers/` *(Phase 4)*
- **Purpose:** thin adapters — read the request, call one service, return the envelope.
- **Not when:** you're writing rules or DB queries — push those down a layer.

### `routes/` *(Phase 4)*
- **Purpose:** wire method+path → middleware chain → controller. No logic.

### `database/` *(Phase 4)*
- **Purpose:** the Prisma client **singleton** (one instance app-wide) and connection lifecycle
  (connect on boot, disconnect on graceful shutdown).

### `emails/` *(Phase 11)*
- **Purpose:** the Resend client and email templates (verification, reset).

### `app.ts` / `server.ts`
- **Purpose:** assemble the app vs boot the process — split for testability (docs 06).

---

## Common mistakes

- **Creating all folders upfront** and leaving them empty — noise; add on demand.
- **A giant `utils/`** that becomes a junk drawer — split by real purpose.
- **DB queries in controllers/services** — must live in `repositories/`.
- **`process.env` scattered** instead of centralized in `config/`.
- **Business logic in `routes/`** — routes only wire.

---

## Best practices

- One folder = one **responsibility**; add a folder when a real need appears.
- Keep the **dependency direction** clean (controllers → services → repositories).
- Co-locate the **schema, controller, service, repository, route** of a feature conceptually even if
  split by layer, so a feature is easy to trace end to end.
- Let the folder structure **mirror the architecture** (docs 23), so the map matches the territory.

---

## Interview questions

1. **Why not create every folder at the start?** YAGNI — empty structure is noise and untracked by
   git; add folders when code needs them.
2. **What's the difference between `config/` and `constants/`?** Environment-dependent/secret values
   vs fixed, environment-independent values.
3. **Where do database queries belong and why?** `repositories/` only — to isolate data access and
   keep services/controllers swappable and testable.
4. **What is module augmentation and where does it live?** Extending a library's types (e.g. adding
   `req.user`) in `types/` — used in Phase 9.
5. **How do you keep `utils/` from rotting?** Keep helpers small and purposeful; move domain logic to
   services, data access to repositories.

---

## Summary

- Each folder maps to a **single responsibility** and mirrors the layered architecture (docs 23).
- Folders appear **when a phase needs them**, not speculatively (KISS/YAGNI).
- Clear homes: config vs constants, middleware vs controller, service vs repository — no leaks.
- With the architecture and structure documented, Phase 4 starts filling the *(planned)* layers with
  the first real feature: **user registration**.

---

## Further reading

- "Structuring a Node.js/Express app" (community patterns) — <https://expressjs.com/en/starter/generator.html>
- SOLID principles overview — <https://en.wikipedia.org/wiki/SOLID>
