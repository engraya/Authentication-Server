# 28 — CI/CD (GitHub Actions)

> **CI (Continuous Integration)**: every push is automatically installed, type-checked, and tested on a
> clean machine — so "it compiles and passes" is proven, not hoped. **CD (Continuous Delivery/
> Deployment)**: a green `main` flows to production automatically. This chapter wires CI with GitHub
> Actions; CD is handled by Render's auto-deploy (docs 29).

---

## Why CI exists

- **Catches what local skips.** "Works on my machine" hides uncommitted files, a stale generated
  client, or a dep that isn't in the lockfile. A clean runner has none of your local state.
- **Protects `main`.** With a required check, a PR that breaks type-checking or a test **can't merge**.
- **Documents the build.** The workflow is an executable, version-controlled description of how to
  build and verify the project.

---

## The workflow

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on every push and PR to `main`:

```yaml
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci                 # exact lockfile; fails on drift
      - run: npx prisma generate    # schema only — no DB needed
      - run: npm run typecheck      # tsc --noEmit
      - run: npm test               # Vitest + Supertest
```

Walkthrough:

1. **checkout** — pulls the repo onto the runner.
2. **setup-node** (`cache: npm`) — installs Node 20 and caches the npm store so installs are fast.
3. **`npm ci`** — reproducible install; **fails if `package.json` and the lockfile disagree** (a real
   guard — we hand-edited `package.json` several times, so keeping the lock in sync matters).
4. **`prisma generate`** — the code imports the generated client (e.g. the `Role` enum), so it must
   exist before type-checking. It reads only the schema — **no database connection**.
5. **typecheck** — the whole project must compile under strict mode.
6. **test** — the full suite. **No secrets needed**: tests mock the DB (docs 25) and read fake config
   from `vitest.config.ts`.

### Why this needs no secrets

Because the tests never touch a real DB or Resend, the CI job needs no `DATABASE_URL`, JWT secret, or
API key. That's a direct payoff of the Phase 16 design (mock the repository seam) — CI stays simple and
can't leak credentials.

---

## Making the check *required*

The workflow reports status on a PR, but to actually *block* merges you enable it in the repo:
**Settings → Branches → Branch protection rule for `main` → Require status checks to pass →** select
the `Type-check & test` job. Now red = no merge.

---

## From CI to CD

Two common shapes:

- **Platform auto-deploy (what we use, docs 29):** Render watches `main` and redeploys on every push
  that lands. CI gates *merges into* `main`; Render deploys *from* `main`. Simple and effective.
- **Deploy from the workflow:** add a job that (e.g.) builds and pushes a Docker image or calls a
  deploy hook — gated `needs: test` so it only runs if CI is green. More control, more moving parts.

A natural next step is a **build job** (`npm run build`, or `docker build`) so the deploy artifact is
proven too; `typecheck` already compiles the code, so it's optional here.

---

## Common mistakes

- **`npm install` in CI** → non-reproducible, and lockfile drift slips through. Use `npm ci`.
- **Forgetting `prisma generate`** → type-check/tests fail because the client is missing.
- **Putting real secrets in the workflow file** → they're committed forever. Use GitHub **Actions
  secrets**, and only where actually needed (our tests need none).
- **Not making the check required** → CI reports failures but broken PRs still merge.
- **Tests that need a live DB in CI** → flaky and slow; mock the boundary (docs 25) or provision a
  service container deliberately.
- **No dependency cache** → every run reinstalls from scratch; slow feedback.

---

## Best practices

- Run on **push and PR** to `main`; make the job a **required** status check.
- **`npm ci`** + dependency cache; pin action versions (`@v4`).
- Keep CI **hermetic** — no external services, no secrets unless required.
- Mirror the **deploy build** (generate → typecheck → test → optionally build) so CI failure ≈ deploy
  failure, caught early.
- Gate any deploy job on `needs: [test]` so nothing ships from a red build.

---

## Interview questions

1. **CI vs CD?** CI = auto-build/verify every change on a clean machine; CD = auto-deliver a passing
   `main` to production.
2. **Why `npm ci` over `npm install` in CI?** Reproducible (exact lockfile) and fails on drift.
3. **How does CI protect `main`?** As a *required* status check, it blocks merging a PR that fails.
4. **Why can this suite run in CI without secrets?** The tests mock the DB and use fake config — no
   real credentials required.
5. **Why run `prisma generate` in CI?** The TypeScript imports the generated client; it must exist to
   compile — and it needs only the schema, not a DB.

---

## Summary

- A GitHub Actions workflow **installs (npm ci) → generates the Prisma client → type-checks → tests**
  on every push/PR to `main`.
- It's **hermetic and secret-free** thanks to the mocked-DB test design (docs 25).
- Make it a **required check** to keep `main` green; **CD** is Render auto-deploying from `main`.
- Next: **docs 29 — Deployment** (Render, env vars, migrations, health checks).

---

## Further reading

- GitHub Actions — <https://docs.github.com/en/actions>
- `actions/setup-node` caching — <https://github.com/actions/setup-node#caching-global-packages-data>
