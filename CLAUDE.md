# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

A production-grade authentication service in TypeScript (Express 5 + Prisma + PostgreSQL), built as
a **teaching course**. Two consequences that shape every change:

1. **Comments are part of the product.** Files open with a block comment explaining the module's
   responsibility and the *why* behind its design, and non-obvious lines carry inline rationale.
   Match that density — terse, comment-free code is out of style here.
2. **`docs/` is the companion textbook.** 32 numbered lessons. Code comments cross-reference them as
   `(docs 14)`. If a change introduces a genuinely new concept, add or extend the relevant doc.

## Commands

```bash
npm run dev          # tsx watch src/server.ts
npm run typecheck    # tsc --noEmit  — the reliable local gate
npm test             # vitest run (42 tests)
npm run build        # prisma generate && tsc → dist/
npm run db:migrate   # prisma migrate dev   (dev only)
npm run db:deploy    # prisma migrate deploy (production release step)
```

Run a single test file: `npx vitest run tests/unit/password.test.ts`

## Architecture

Strictly one-directional layering:

```
routes → controllers → services → repositories → Prisma
```

- **routes/** — pure wiring only: method + path → middleware chain → controller. No logic.
- **controllers/** — thin HTTP adapters. Read the (already-validated) request, call **one** service
  method, shape the `ApiSuccess` envelope. **No try/catch** — Express 5 auto-forwards rejected
  promises to the global error handler. No DB access.
- **services/** — all business logic. Knows nothing about `req`/`res`. Throws typed domain errors
  from `src/errors/`; the handler maps them to HTTP.
- **repositories/** — the *only* place `prisma` is called.
- **config/** — the single source of truth for env. Everything is read, validated and frozen here;
  never read `process.env` elsewhere (exception: `utils/logger.ts` checks `NODE_ENV` directly to
  stay silent in tests without importing config).

Other conventions:

- Every response uses the `ApiSuccess<T>` / `ApiError` discriminated union in `src/types/api.ts`.
  Type the body explicitly at the call site so the shape is compile-time guaranteed.
- New errors extend `AppError` (`src/errors/`) — never throw bare `Error` for expected conditions.
- Validation lives in `src/validators/*.ts` as Zod schemas; export the `z.infer` type alongside and
  wire it with `validate(schema)` in the route. Controllers cast `req.body` to that inferred type.
- Never return a raw Prisma `User`. Go through `toPublicUser()` (`Omit<User, "passwordHash">`).
- Adding an env var means: `config/index.ts` (with a `require*`/`optional*` helper) **and**
  `.env.example` **and** the README table — in the same change.

## Security invariants — don't regress these

- Login and forgot-password responses are intentionally generic and timing-equalized. Do not add
  distinguishing messages, status codes, or early returns that skip the dummy bcrypt compare.
- Refresh / verification / reset tokens are opaque random bytes stored **SHA-256 hashed**. Raw values
  live only in the cookie or the emailed link.
- Refresh tokens rotate on every use; presenting a rotated token revokes **all** of the user's
  sessions. Password reset also revokes all sessions.
- The refresh token goes in the httpOnly cookie only — **never** in a JSON body.
- `clearRefreshCookie` must mirror `setRefreshCookie`'s attributes (especially `path`) or browsers
  won't clear it.
- Identity for protected routes comes from `req.user` (the verified token), never the request body.
  Self-service writes use an explicit field whitelist (`updateMeSchema` = `name` only).
- CORS uses an explicit allowlist; a wildcard is impossible because credentials are enabled.

## Prisma / database

- Migrations must use `DIRECT_URL` (unpooled). A connection pooler such as Neon's `-pooler` host
  cannot run schema migrations. The app itself uses the pooled `DATABASE_URL`.
- Never run `prisma migrate dev` or `migrate reset` against production — the release step is
  `db:deploy`.
- `binaryTargets` includes `debian-openssl-3.0.x` for the Docker/Render runtime. Keep it.
- The hosted database (Neon) auto-suspends; `connectDatabase` retries on boot. A first request after
  idle may be slow or fail — warm up with `/health`.

## Testing

- `vitest.config.ts` injects fake env (`NODE_ENV=test`, fake `DATABASE_URL`, a ≥32-char JWT secret,
  `BCRYPT_COST=10`, huge rate limits) **before** `config` is imported. dotenv won't override it, so
  the real `.env` is untouched. Add new required env vars there too or every test breaks.
- Mock at the **repository** seam with `vi.mock` — that's the payoff of the layered architecture.
  Don't mock Prisma itself or stand up a live database.
- Integration tests import `app` (not `server`) and drive it in-process with Supertest. Keep the
  app/server split intact.
- `tsconfig.json` excludes `tests/`, so `npm run typecheck` does not type-check tests; Vitest
  transpiles them via esbuild.

## Local environment quirks (Windows dev box)

These are environment artifacts, not bugs — don't chase them:

- **Exit codes lie.** The sandbox's script gate makes npm lifecycle scripts (`npm install`,
  `npm test`, `npm run build`) and `prisma generate` exit 1 *even when they succeed*. Verify by the
  printed output — e.g. Vitest's `Test Files 5 passed / Tests 42 passed` summary, or the presence of
  `dist/server.js` — not by the exit code. CI on Linux is unaffected.
- **npm may not save new deps** to `package.json` even though `node_modules` is populated. After
  installing, check `package.json` and hand-add the entry (version from
  `node_modules/<pkg>/package.json`). A later install will *prune* anything missing from it.
- Installs are slow and the registry is flaky: use `--fetch-timeout=600000 --no-audit --no-fund`,
  and `--legacy-peer-deps` for packages with large optional peer graphs. Avoid `--prefer-offline`
  (stale-cache `ETARGET`). If a bin link is missing after an install, run the *same* install again.
- Stay on **Prisma 6** and **Vitest 2.x** — 7.x / 4.x both fail to install here.
- For curl-based manual testing, put cookie jars in `/tmp` (the scratchpad is cleaned between
  sessions and `curl -c` fails silently); `-o /dev/null` breaks `-c` on this setup — use `-i`.

## Git

Nothing is committed automatically. `.env` is git-ignored and must stay that way.
