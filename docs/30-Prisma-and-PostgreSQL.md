# 30 — Prisma & PostgreSQL

> Our data layer. This chapter covers why we chose PostgreSQL + Prisma, how the schema → client →
> migration pipeline works, the connection singleton, and the repository pattern.

---

## Why PostgreSQL

**PostgreSQL** is a relational, **ACID**-compliant SQL database — the default for SaaS backends.

- **ACID** (Atomicity, Consistency, Isolation, Durability) means transactions are reliable: either
  fully applied or not at all. For auth data (accounts, tokens), correctness beats convenience.
- **Constraints** like `UNIQUE` and foreign keys let the **database itself** enforce invariants —
  e.g. "no two users share an email" holds even under concurrent requests (see the race in docs 23 /
  the auth service). The DB is the last line of defense.
- **Relational** structure fits our data: users have many refresh tokens (Phase 8), etc.

---

## Why Prisma

**Prisma** is a next-generation ORM (Object-Relational Mapper): you describe your data in a schema,
and Prisma generates a **fully-typed client**. For a TypeScript project this is the cleanest option —
every query is type-checked, and your editor autocompletes columns.

```
   prisma/schema.prisma  ──► prisma generate ──► @prisma/client  (typed queries)
   (source of truth)     ──► prisma migrate  ──► SQL migrations  (real tables)
```

One schema drives **both** the compile-time types and the actual database structure.

---

## The schema (`prisma/schema.prisma`)

Three blocks:

- **`generator client`** — tells Prisma to emit the JS/TS client.
- **`datasource db`** — `provider = "postgresql"` and `url = env("DATABASE_URL")`. The URL comes from
  the environment (Twelve-Factor; never hard-code credentials).
- **`model User`** — maps to a `users` table. Field attributes:
  - `@id @default(uuid())` — UUID primary key. **Why UUID over auto-increment?** Non-guessable and
    non-enumerable: an attacker can't walk `/users/1`, `/users/2`, and it leaks no count of users.
  - `@unique` on `email` — creates a **unique index**; the DB guarantees no duplicate emails.
  - `passwordHash` — named so it's unmistakable we store a hash, never a password.
  - `@default(now())` / `@updatedAt` — automatic audit timestamps.
  - `@@map("users")` — snake_case table name (SQL convention) while the model stays PascalCase.

We keep the model **minimal** and grow it via migrations later (role → Phase 10, email-verification →
Phase 11, refresh tokens → Phase 8) — teaching incremental schema evolution.

---

## Migrations

A **migration** is a versioned SQL script that changes the database structure. Prisma diffs your
schema against the DB and generates one.

- `prisma migrate dev --name init` (development) — creates the migration, applies it, regenerates the
  client. Run whenever you change the schema.
- `prisma migrate deploy` (production/CI) — applies already-created migrations without generating new
  ones. This is what Render runs on deploy (Phase 17).

Migrations live in `prisma/migrations/` and **are committed** — they're the history of your database
structure, and every environment applies the same ones.

---

## The client singleton (`src/database/prisma.ts`)

Each `new PrismaClient()` opens a **connection pool**. Creating many clients exhausts the database's
connection limit fast. So we create **exactly one** and import it everywhere.

The `globalThis.__prisma__` cache guards a dev-mode footgun: hot-reloaders like `tsx watch` re-run
modules on save, which could spawn a new client (and pool) on every reload. Caching on `globalThis`
makes reloads reuse the one instance.

We also expose:
- `connectDatabase()` — called at boot **before** listening, so a bad `DATABASE_URL` fails fast.
- `disconnectDatabase()` — called during graceful shutdown to close the pool cleanly.

---

## The repository pattern (`src/repositories/`)

The repository is the **only** layer that talks to Prisma. Services call `userRepository.findByEmail`
/ `.create`, never `prisma.user.*` directly. Benefits:

- **Swap-ability** — change ORM or query without touching business logic.
- **Testability** — mock the repository to unit-test services without a real DB.
- **Single place** for data-access concerns (docs 23/24).

Note the repository takes `passwordHash`, never a plaintext password — hashing happens in the service
layer above it.

---

## Managed/hosted Postgres notes

Hosted providers (Neon, Supabase, Render Postgres) give you a connection string. Two practical points:

- **SSL** — most managed Postgres requires it; append `?sslmode=require` (or the provider's variant)
  to `DATABASE_URL` if connections are refused.
- **Connection limits & pooling** — serverless/hosted DBs cap connections. Providers like Neon offer a
  **pooled** connection string (PgBouncer); use it for the app. For Prisma migrations you sometimes
  need the **direct** (unpooled) URL — providers document this. At our scale the basic string is fine;
  we revisit pooling if needed.

---

## Common mistakes

- **`new PrismaClient()` per request/module** → connection-pool exhaustion. Use the singleton.
- **Committing `.env`** with real credentials (we don't — it's git-ignored; `.env.example` documents
  the shape).
- **Not committing migrations** → environments drift. Commit `prisma/migrations/`.
- **Querying Prisma outside repositories** → data access leaks across layers.
- **Forgetting SSL** on managed Postgres → cryptic connection errors.
- **Auto-increment IDs exposed in URLs** → enumeration; prefer UUIDs for user-facing identifiers.

---

## Best practices

- **One Prisma client** (singleton); connect at boot, disconnect on shutdown.
- **Schema is the source of truth**; evolve it with committed migrations.
- Keep DB access in **repositories** only.
- Read `DATABASE_URL` from the **environment**; never hard-code credentials.
- Use **UUID** primary keys for anything user-facing.

---

## Interview questions

1. **What does Prisma generate from the schema, and why is that valuable in TypeScript?** A fully-typed
   client → compile-time-checked queries and autocomplete.
2. **Why a single PrismaClient instance?** Each client holds a connection pool; multiple instances
   exhaust DB connections.
3. **`migrate dev` vs `migrate deploy`?** Dev creates+applies+generates; deploy applies existing
   migrations only (CI/production).
4. **Why UUID over auto-increment IDs for users?** Non-guessable, non-enumerable, no info leak.
5. **How does the DB enforce unique emails under concurrency?** A `UNIQUE` index rejects the duplicate
   insert even if two requests pass an app-level check simultaneously.
6. **Why the repository layer?** Isolate data access for swap-ability and testability.

---

## Summary

- **PostgreSQL** (ACID, constraints) + **Prisma** (typed client from a schema) is our data layer.
- The **schema** drives both **generated types** and **SQL migrations**; migrations are committed.
- A **singleton client** (connect at boot, disconnect on shutdown) avoids pool exhaustion.
- The **repository** is the sole gateway to the DB, keeping services swappable and testable.
- Next (Phase 5): **password hashing** — opening the `hashPassword` black box we used here.

---

## Further reading

- Prisma docs — <https://www.prisma.io/docs>
- Prisma "Best practice for instantiating PrismaClient" — <https://www.prisma.io/docs/orm/more/help-and-troubleshooting/help-articles/nextjs-prisma-client-dev-practices>
- PostgreSQL documentation — <https://www.postgresql.org/docs/>
