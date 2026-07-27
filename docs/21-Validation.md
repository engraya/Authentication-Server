# 21 — Validation

> Untrusted input is the source of most security bugs. This chapter explains why we validate at
> runtime with Zod, how the reusable `validate()` middleware works, and the "validate at the edge"
> principle.

---

## Definition

**Validation** is checking that incoming data matches the rules your system requires — correct types,
formats, lengths, ranges — *before* you act on it. **Sanitization/normalization** is cleaning it
(trimming whitespace, lowercasing emails) so downstream code sees consistent values.

---

## Why TypeScript is not enough

A natural question: "we have types — isn't `req.body: RegisterInput` sufficient?" **No.** Recall from
docs 02 that **types are erased at compile time**. At runtime, `req.body` is whatever JSON an
untrusted client sent — it could be `{}`, `{ email: 123 }`, or a 10 MB blob. TypeScript can't check
data that only exists when the program *runs*.

```
   compile time (types)                runtime (real requests)
  ┌────────────────────┐              ┌──────────────────────────┐
  │ "trust me, it's a  │   ERASED     │ attacker sends anything: │
  │  RegisterInput"    │  ─────────►  │ {email:123}, null, [], … │  ← types can't help here
  └────────────────────┘              └──────────────────────────┘
                                       Zod checks it HERE, at runtime.
```

So we need a **runtime** guard. That's Zod.

---

## Why Zod specifically

Zod is a **schema declaration + validation** library with a killer TypeScript feature: **one schema
gives you both** a runtime validator **and** a static type (via `z.infer`). No drift between "what we
check" and "what we type".

```ts
export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
  name: z.string().trim().min(1).max(100).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>; // derived, always in sync
```

Change a rule, and the type updates automatically. This is the single-source-of-truth payoff and why
Zod beats hand-written validators or class-validator decorators for a TypeScript backend.

---

## The `validate()` middleware (validate at the edge)

`src/middlewares/validate.ts` is a **higher-order function**: `validate(schema)` returns a middleware.
It runs before the controller and:

1. `schema.safeParse(req.body)` — checks without throwing.
2. On failure → throws `ValidationError` (→ **422**) carrying a `{ field: [messages] }` map from
   `error.flatten().fieldErrors`.
3. On success → **replaces `req.body`** with the parsed, normalized data (trimmed, lowercased, typed).

```
request ─► validate(registerSchema) ─► controller ─► service ─► repository
             │ safeParse                 (every layer below can now
             │ ✗ → 422 ValidationError    TRUST req.body completely)
             │ ✓ → req.body = clean data
```

**"Validate at the edge"** means: reject bad input at the boundary, so no downstream layer ever has to
re-check. The controller, service, and repository all operate on already-clean, already-typed data.

`safeParse` vs `parse`: `parse` throws on failure; `safeParse` returns a `{ success, data | error }`
result we branch on. We use `safeParse` for explicit control over the error we raise.

---

## Why normalize (not just validate)

`email: z.string().trim().toLowerCase().email()` doesn't only check — it **transforms**. `"  A@B.COM "`
becomes `"a@b.com"`. This matters: without normalization, `A@B.com` and `a@b.com` would become two
separate accounts, and the `@unique` email index wouldn't catch it. Normalize identifiers *before*
they hit the database.

`password.max(72)`: bcrypt only uses the first 72 bytes of input (docs 14/15). Capping length both
reflects that reality and blocks absurdly long inputs (a cheap DoS vector via slow hashing).

---

## Common mistakes

- **Relying on TypeScript types for runtime safety.** They're erased; untrusted input needs runtime
  validation.
- **Validating in the controller/service instead of at the edge.** Leads to duplicated, inconsistent
  checks and layers that can't trust their inputs.
- **Not normalizing identifiers** (email casing/whitespace) → duplicate accounts, broken uniqueness.
- **Leaking raw validation-library internals** to clients. We return a clean field→messages map, not
  Zod's full issue tree.
- **Trusting query params/headers/params** the same as body without validating them too (we'll add
  param validation where needed).

---

## Best practices

- **One Zod schema per input**, with `z.infer` for the type — single source of truth.
- Validate (and normalize) **at the edge** via reusable middleware.
- Return **422** with **field-level** messages for validation failures (docs 04/22).
- Cap sizes/lengths to blunt trivial DoS.
- Keep schemas in `validators/`, separate from business logic.

---

## Interview questions

1. **Why validate at runtime if you already have TypeScript types?** Types are compile-time only and
   erased; runtime input from clients is untrusted and must be checked when the code runs.
2. **What does Zod give you that hand-written validation doesn't?** One schema → runtime validation
   *and* an inferred static type, kept automatically in sync.
3. **What is "validate at the edge"?** Reject/normalize input at the boundary so all downstream layers
   can trust it.
4. **`parse` vs `safeParse`?** `parse` throws on invalid input; `safeParse` returns a result object to
   branch on.
5. **Why normalize email before storing?** So case/whitespace variants map to one account and the
   unique index works.
6. **Which status code for validation failure, and what body?** 422 (or 400) with a field→messages map.

---

## Summary

- Types are erased; **runtime validation is mandatory** for untrusted input.
- **Zod** gives one schema → validator + inferred type (single source of truth).
- The reusable **`validate(schema)`** middleware rejects bad input with a **422 + field errors** and
  hands clean, normalized data to the rest of the pipeline.
- **Validate and normalize at the edge**; downstream layers then trust their data.
- Next in the build: this feeds directly into **user registration** and, in Phase 5, **password
  hashing**.

---

## Further reading

- Zod documentation — <https://zod.dev/>
- OWASP Input Validation Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html>
