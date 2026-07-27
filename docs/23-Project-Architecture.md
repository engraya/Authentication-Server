# 23 — Project Architecture

> How the pieces fit together. This chapter explains the **layered architecture** we're adopting — the
> flow of a request through distinct responsibilities — and the principles behind it.

---

## The problem layering solves

A naive Express app puts *everything* in the route handler: parse input, query the DB, hash
passwords, format the response. It works for ten lines and collapses at a thousand: untestable,
unreadable, impossible to change one concern without risking another.

**Layered architecture** splits a request into a pipeline of single-responsibility stages, each
depending only on the layer beneath it.

---

## The layers (request → response)

```
   HTTP request
        │
        ▼
 ┌──────────────┐   routes/        Map method+path → middleware chain → controller.
 │   ROUTE      │                  No logic; just wiring.
 └──────┬───────┘
        ▼
 ┌──────────────┐   middlewares/   Cross-cutting concerns that run before controllers:
 │  MIDDLEWARE  │                  authenticate, authorize, validate(schema), rate-limit.
 └──────┬───────┘
        ▼
 ┌──────────────┐   controllers/   HTTP adapter: read req (body/params/user), call ONE
 │  CONTROLLER  │                  service method, shape the res envelope. No business rules.
 └──────┬───────┘
        ▼
 ┌──────────────┐   services/      The BUSINESS LOGIC. "Register = ensure email unique, hash
 │   SERVICE    │                  password, create user, issue tokens, send email." Knows
 │              │                  nothing about HTTP (no req/res here).
 └──────┬───────┘
        ▼
 ┌──────────────┐   repositories/  DATA ACCESS. The only layer that talks to Prisma/DB.
 │  REPOSITORY  │                  "findUserByEmail", "createUser". Swappable, mockable.
 └──────┬───────┘
        ▼
      database (PostgreSQL via Prisma)
```

Supporting (non-layer) folders: `config/`, `constants/`, `types/`, `interfaces/`, `errors/`,
`utils/`, `validators/`, `emails/`. Detailed in [24 — Folder Structure](24-Folder-Structure.md).

### Why the strict direction (controller → service → repository)?

- **Controllers know HTTP, not business rules.** Swap Express for Fastify and services are untouched.
- **Services know business rules, not HTTP or SQL.** They're pure logic → the easiest, most valuable
  code to unit-test (Phase 16).
- **Repositories know the database, nothing else.** Swap Prisma or mock the DB in tests without
  touching logic.

A request flows **down**; each layer calls only the one below. HTTP concerns never leak into services;
SQL concerns never leak into controllers.

---

## Worked example (previewing Phase 4–7)

`POST /auth/register`:

1. **route** `authRouter.post("/register", validate(registerSchema), authController.register)`
2. **middleware** `validate(registerSchema)` — rejects bad input with a 422 before logic runs.
3. **controller** `register` — reads `req.body`, calls `authService.register(dto)`, returns `201` +
   the success envelope.
4. **service** `register` — checks email uniqueness (throws `ConflictError` if taken), hashes the
   password, calls the repository, issues tokens, triggers a verification email.
5. **repository** `createUser` — the single Prisma `insert`.

Notice: the **service** throws `ConflictError`; it never formats a response. The **global error
handler** (docs 22) turns it into a 409. Clean separation, top to bottom.

---

## Principles applied

- **Separation of Concerns** — each layer, one job.
- **Single Responsibility (SOLID's S)** — a module changes for one reason only.
- **DRY** — shared helpers (errors, envelope, config) defined once.
- **KISS / YAGNI** — we add a layer/abstraction when a concrete need appears, not preemptively (e.g.
  we skipped `asyncHandler` in Express 5; we won't add a `repository` until Phase 4 needs the DB).
- **Dependency direction** — high-level policy (services) doesn't depend on low-level details
  (Express, Prisma); those are injected/imported at the edges. This is the spirit of Dependency
  Inversion, kept pragmatic.

> **Guard against over-engineering.** Layers are a tool, not a religion. For this project's size,
> thin controllers + focused services + simple repositories are exactly right. We won't add DI
> containers, CQRS, or hexagonal ports "because enterprise" — that's complexity YAGNI warns against.

---

## How large companies organize backends

Bigger orgs extend these same ideas: a dedicated **auth microservice** (what we're modeling); shared
**DTO/validation** contracts; **repository/adapter** layers to swap data stores; and clear module
boundaries so teams work independently. The layering scales *conceptually* even when the deployment
grows from one service to many.

---

## Common mistakes

- **Fat controllers** doing DB queries and business logic — untestable, duplicated.
- **Business logic in routes** — routes should only wire middleware to a controller.
- **HTTP in services** (`res.json` inside a service) — couples logic to the framework; breaks reuse
  and testing.
- **SQL/Prisma outside repositories** — data access leaks everywhere; swapping stores becomes a rewrite.
- **Premature abstraction** — building generic layers before a second use case exists.

---

## Best practices

- Keep controllers **thin**, services **HTTP-free**, repositories **DB-only**.
- Requests flow **one direction**: route → middleware → controller → service → repository.
- Throw **typed errors** from services; format them in **one** handler.
- Add structure **when a real need arrives** (KISS/YAGNI), not speculatively.

---

## Interview questions

1. **Why layer a backend into controller/service/repository?** Separation of concerns → testable,
   maintainable, swappable; each layer changes for one reason.
2. **Why keep HTTP out of the service layer?** So business logic is framework-agnostic and unit-
   testable without req/res.
3. **What belongs in a repository?** Only data access (the DB queries) — nothing about HTTP or rules.
4. **How does layering aid testing?** Services are pure logic (unit tests); repositories can be mocked;
   controllers become thin adapters.
5. **When should you NOT add a layer/abstraction?** When no concrete need exists yet — YAGNI/KISS.

---

## Summary

- A request flows **route → middleware → controller → service → repository → DB**, each layer with one
  responsibility and depending only on the one below.
- Controllers speak **HTTP**, services speak **business logic**, repositories speak **database** — no
  leaks across boundaries.
- Guided by **SoC, SRP, DRY, KISS, YAGNI**; structure is added on demand, not speculatively.
- Next: **[24 — Folder Structure](24-Folder-Structure.md)** — every folder, its reason, and when it
  should *not* exist.

---

## Further reading

- Martin Fowler, "PresentationDomainDataLayering" — <https://martinfowler.com/bliki/PresentationDomainDataLayering.html>
- The Twelve-Factor App — <https://12factor.net/>
