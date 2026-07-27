# 02 — TypeScript

> Why this project is written in TypeScript instead of JavaScript, and every compiler decision we
> made in Phase 1. Read this alongside `tsconfig.json` — they are two views of the same thing.

---

## Definition

**TypeScript** is JavaScript **plus a static type system**. You write `.ts` files; a **compiler**
(`tsc`) checks the types and then *erases* them, emitting plain `.js` that Node runs. The types
exist only at **compile time** — at runtime, it is 100% JavaScript. TypeScript adds **zero runtime
overhead** and **zero runtime features**; it is a *checker*, not a new language engine.

> Mental model: TypeScript is a **spell-checker for your code's shapes**. It reads your program the
> way a careful reviewer would and points at contradictions before your users ever hit them.

---

## A little history (why it exists)

JavaScript was created in **1995** in ten days to add small interactions to web pages. It was never
designed for 100,000-line backend systems. As apps grew, its **dynamic typing** — a variable can
hold anything, and mistakes surface only when a line actually executes — became a liability.

Microsoft released **TypeScript in 2012** to bring the safety of typed languages (C#, Java) to the
JavaScript ecosystem *without* forcing anyone off JavaScript. Today it is the default for serious
Node.js backends, and most popular libraries ship their own type definitions.

---

## Why JavaScript alone isn't enough for a backend

Consider this JavaScript:

```js
function createUser(email, isAdmin) {
  return { email, isAdmin };
}

createUser("a@b.com");          // isAdmin is undefined — silently
createUser(true, "a@b.com");    // arguments swapped — runs anyway
user.emial;                     // typo — returns undefined, no error
```

Every line above **runs without complaint** and fails later, somewhere else, at runtime — often in
production. In an *authentication* server, a silent `undefined` in the wrong place is not a cosmetic
bug; it can be a **security hole** (e.g. `isAdmin` accidentally truthy).

TypeScript rejects all three at **compile time**:

```ts
function createUser(email: string, isAdmin: boolean) {
  return { email, isAdmin };
}

createUser("a@b.com");          // ✗ Error: expected 2 arguments
createUser(true, "a@b.com");    // ✗ Error: boolean is not assignable to string
user.emial;                     // ✗ Error: property 'emial' does not exist
```

---

## How TypeScript improves backend development

- **Self-documenting APIs.** A function's types *are* its contract. `login(dto: LoginDto): Promise<Tokens>`
  tells you everything without reading the body.
- **Refactoring with confidence.** Rename a field on the `User` type and the compiler lists every
  place that must change. In JS you'd `grep` and pray.
- **Editor superpowers.** Autocomplete, inline errors, and "go to definition" all come from types.
- **Fewer tests for trivial bugs.** You don't need a test asserting "don't pass a number here" — the
  compiler guarantees it.

**Production benefit:** entire classes of runtime errors (`undefined is not a function`, wrong
argument order, misspelled property) become **impossible to ship**.

---

## How the toolchain works (internally)

```
   src/*.ts ──►  tsc (type-check + strip types)  ──►  dist/*.js  ──►  node dist/index.js
      │                                                                  (production: `npm start`)
      │
      └────────►  tsx (compile-in-memory + run, with watch)  ──►  runs instantly
                                                                   (development: `npm run dev`)
```

- **`tsc`** — the official compiler. Reads `tsconfig.json`, type-checks, emits JS to `dist/`. Used
  for the **production build** (`npm run build`) and for a pure check with `--noEmit`
  (`npm run typecheck`).
- **`tsx`** — a fast dev runner. It transpiles TypeScript **in memory** and runs it immediately, and
  `tsx watch` restarts on file changes. It **does not type-check** (it prioritizes speed), which is
  exactly why we *also* keep a separate `typecheck` script. Used for **development** (`npm run dev`).
- **`@types/node`** — the type definitions for Node's built-in APIs (`process`, `fs`, `http`, …).
  Node itself is written in C++/JS and ships no types, so this package supplies them.

**Key idea:** run fast in dev (`tsx`), verify types explicitly (`tsc --noEmit`), ship compiled JS
(`tsc` → `node`).

---

## Our `tsconfig.json`, option by option

The single most important line is:

```jsonc
"strict": true
```

This is a **master switch** that enables the whole family of strict checks. Turning it on from day
one is the difference between "JavaScript with optional hints" and "a type system that actually
protects you." The notable members:

| Option | What it forces | Why it matters for auth |
|---|---|---|
| `noImplicitAny` | Every value needs a known type; no silent `any`. | `any` disables checking — a backdoor around safety. |
| `strictNullChecks` | `null`/`undefined` aren't assignable to everything. | Forces us to handle "user not found", "token missing". |
| `noUncheckedIndexedAccess` | `arr[i]` is `T \| undefined`. | Models reality: an index can miss; forces the check. |
| `exactOptionalPropertyTypes` | `x?: string` means *absent*, not *present-and-undefined*. | Precise DTOs; avoids subtle "field was explicitly undefined" bugs. |
| `noUnusedLocals` / `noUnusedParameters` | Dead code becomes an error. | Keeps the security-critical code paths clean and reviewed. |

Other important choices:

- **`target: ES2022`** — Node 22 runs modern JS natively, so we don't waste effort down-compiling to
  old syntax.
- **`module` / `moduleResolution: NodeNext`** — resolve `import`s the way Node actually does at
  runtime, avoiding "works in tsc, breaks in node" surprises.
- **`lib: ["ES2022"]`** — include types for modern JS built-ins but **not** the DOM. This is a
  server; there is no `window` or `document`, and pretending otherwise hides bugs.
- **`rootDir: src` / `outDir: dist`** — clean separation of source and build output.
- **`esModuleInterop: true`** — lets `import express from "express"` work smoothly with CommonJS
  packages (most of the Node ecosystem).
- **`forceConsistentCasingInFileNames: true`** — Windows is case-*insensitive*, but Render/Linux is
  case-*sensitive*. This catches `./User` vs `./user` bugs on your machine before they break the deploy.
- **`skipLibCheck: true`** — don't type-check `.d.ts` files inside `node_modules`. Faster builds, and
  you're not responsible for third-party type errors.
- **`sourceMap: true`** — maps compiled JS back to your TS so stack traces and the debugger point at
  real source lines.

---

## TypeScript concepts introduced in Phase 1

You already met several. Each will recur, so learn them now:

### 1. Type annotations
`function greet(name: string): string` — `: string` after a parameter types the **input**; after the
`)` it types the **return**. The compiler verifies both.

### 2. Type aliases
`export type NodeEnv = ...` names a type so you can reuse it. `type Env = typeof env` derives a type
*from a value* — one source of truth.

### 3. Literal & union types
`"development" | "production" | "test"` is a **union** of **string literals**. The variable may hold
*only* those three exact strings — a typo like `"prod"` is a compile error. This is how TypeScript
models "one of a fixed set" without a runtime enum.

### 4. `undefined` and `strictNullChecks`
`process.env.PORT` is typed `string | undefined`. Because strict null checks are on, TypeScript
**won't let you use it as a plain string** until you've handled the `undefined` case — which is why
`readString` exists.

### 5. Type inference
We rarely wrote types for local variables (`const value = process.env[key]`). TypeScript **infers**
them. Rule of thumb: **annotate function boundaries (params/returns); let inference handle the
insides.**

### 6. `as const`
`export const env = { ... } as const` makes the object **deeply readonly** and infers the
**narrowest** types (so `nodeEnv` is the `NodeEnv` union, not just `string`). Perfect for config that
must never mutate.

---

## Common mistakes

- **Reaching for `any`.** It silences the compiler and defeats the purpose. Prefer `unknown` (forces
  you to narrow before use) when a type is genuinely unknown.
- **Assuming `tsx`/`ts-node` type-checks.** They don't (for speed). Always run `npm run typecheck`
  (and it runs in CI) — otherwise type errors reach production.
- **Committing `dist/`.** It's generated output; it belongs in `.gitignore`, not git.
- **Leaving `strict` off** "to move faster." You trade a few minutes now for runtime bugs later — the
  worst trade in backend work.
- **Forgetting `@types/*`** for a dependency that ships no types → implicit `any` everywhere.

---

## Best practices

- Turn on **`strict` from commit #1** (retrofitting it later is painful).
- Type the **boundaries** (function signatures, module exports); let inference do the rest.
- Keep a dedicated **`typecheck` script** and run it in CI, separate from the dev runner.
- Model "one of a fixed set" with **literal unions** (or enums, covered later), never loose strings.
- Prefer **`unknown` over `any`** when you must accept arbitrary input (e.g. request bodies).

---

## Interview questions

1. **Is TypeScript a runtime or compile-time tool?** Compile-time only; types are erased and Node
   runs plain JavaScript. It adds no runtime overhead.
2. **What does `strict: true` actually turn on, and why enable it early?** A family of checks
   (`strictNullChecks`, `noImplicitAny`, etc.); early adoption avoids a costly retrofit.
3. **Difference between `any` and `unknown`?** Both accept anything, but `any` disables checking on
   the value, while `unknown` forces you to narrow it before use — `unknown` is safe, `any` is not.
4. **Why is `process.env.X` typed `string | undefined`?** Env vars may be absent; strict null checks
   force you to handle the missing case.
5. **`tsc` vs `tsx` vs `ts-node`?** `tsc` compiles/type-checks to `.js`; `tsx` and `ts-node` run TS
   directly for dev (fast, `tsx` skips type-checking).
6. **What is a literal (union) type and when do you use it?** A type whose values are specific
   constants; used to model a fixed set of options safely.

---

## Summary

- TypeScript = **JavaScript + compile-time types**, erased before running. No runtime cost.
- For a security-critical backend, it turns silent runtime mistakes into **loud compile errors**.
- We enabled **`strict` mode** and Node-accurate module resolution from the very first commit.
- Dev = **`tsx`** (fast), verify = **`tsc --noEmit`**, ship = **`tsc` → `node dist`**.
- Concepts unlocked: annotations, type aliases, literal/union types, inference, `as const`,
  `string | undefined`.
- Next up (Phase 2): **[06 — Express](06-Express.md)** and the app/server split.

---

## Further reading

- TypeScript Handbook — <https://www.typescriptlang.org/docs/handbook/intro.html>
- `tsconfig` reference — <https://www.typescriptlang.org/tsconfig>
- Total TypeScript (free essentials) — <https://www.totaltypescript.com/books/total-typescript-essentials>
