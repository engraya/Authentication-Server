# 29 — Deployment (Render) & Going Live

> The final step: run the auth server on the public internet, safely. This chapter covers deploying to
> **Render**, the production environment variables, running migrations on deploy, health checks, and a
> go-live checklist that ties together every hardening decision from Phases 1–16.

---

## Two paths to production

Everything is in place for either:

| Path | How | When |
|---|---|---|
| **Native buildpack** ([render.yaml](../render.yaml)) | Render builds with Node directly: `npm ci && npm run build`, then `npm run start` | Simplest; no Docker knowledge needed |
| **Container** ([Dockerfile](../Dockerfile), docs 27) | Render (or anywhere) runs the image | Portable across hosts; identical local/prod runtime |

Pick one. Below uses the **native** path via a committed Blueprint; the Docker path is docs 27.

---

## The Blueprint (`render.yaml`)

Committing [render.yaml](../render.yaml) makes the deployment **infrastructure-as-code** — versioned
and reviewable instead of dashboard clicks:

```yaml
services:
  - type: web
    runtime: node
    buildCommand: npm ci && npm run build         # install + prisma generate + tsc
    preDeployCommand: npm run db:deploy           # prisma migrate deploy (once per deploy)
    startCommand: npm run start                   # node dist/server.js
    healthCheckPath: /health
    envVars:
      - { key: NODE_ENV, value: production }
      - { key: DATABASE_URL, sync: false }        # set as a dashboard secret
      # ...
```

- **`buildCommand`** compiles the app and generates the Prisma client.
- **`preDeployCommand`** runs migrations **once per deploy, before the new instance goes live** — the
  correct place for `migrate deploy` (vs. per-instance startup; see docs 27). It uses `DIRECT_URL`.
- **`startCommand`** boots the compiled server. Render **injects `PORT`**; our config reads it, so we
  never hard-code a port.
- **`healthCheckPath: /health`** — Render polls it and only routes traffic once it returns 200.

---

## Environment variables (production)

Set these as **dashboard secrets** (`sync: false` — never committed). They mirror [.env.example](../.env.example):

| Var | Notes |
|---|---|
| `NODE_ENV` | `production` — enables Secure cookies + terse logging (config) |
| `DATABASE_URL` | **Pooled** connection (app runtime) |
| `DIRECT_URL` | **Unpooled** connection (migrations) — Neon: host without `-pooler` |
| `JWT_ACCESS_SECRET` | ≥ 32 random chars; the app **refuses to boot** without it (docs 03/09) |
| `JWT_ACCESS_TTL` | e.g. `15m` |
| `RESEND_API_KEY` | Resend key; a verified sending domain for real delivery |
| `EMAIL_FROM` | `Auth <no-reply@yourdomain.com>` once your domain is verified |
| `APP_URL` | Public base URL for emailed verification/reset links |
| `CORS_ORIGIN` | Allowlisted frontend origin(s), comma-separated (docs 26) |

Our **fail-fast config** (docs 03) is the safety net: a missing/short secret makes the instance exit
at boot, so Render's health check fails and it **won't route traffic to a broken deploy**.

---

## Migrations in production

- Use **`prisma migrate deploy`** (our `db:deploy` script) — applies committed migrations only, never
  generates or resets. Destructive commands (`migrate dev`, `migrate reset`) never run in production.
- It connects via **`DIRECT_URL`** because a pooler (Neon `-pooler`, PgBouncer) can't run schema
  changes (docs 08).
- Migrations are **committed to the repo** (`prisma/migrations/`), so every environment applies the
  same ordered history.

---

## Health checks & the platform contract

`GET /health` returns `{ status: "ok", uptime, timestamp, environment }` (docs 02). The platform uses
it to decide an instance is alive before sending traffic and to restart a hung one. It pairs with the
production hygiene we already built:

- **Graceful shutdown** (server.ts): on `SIGTERM` (every deploy/restart) we stop accepting
  connections, drain in-flight requests, close the DB pool, then exit — no dropped requests.
- **`trust proxy` in production** (app.ts, docs 26): behind Render's proxy, `req.ip` and HTTPS are
  read correctly, so rate limiting keys on the real client and Secure cookies work.

> **Free tier reality:** Render's free instances **sleep when idle**, so the first request after a
> lull is a slow cold start — and our serverless Postgres (Neon) *also* wakes from suspend, which is
> exactly why `connectDatabase` retries with backoff (docs 30). Fine for a demo; use a paid tier (and
> a warm DB) for anything real.

---

## Go-live checklist (everything comes together)

- [ ] **Secrets set** in the platform; none in the repo. `.env` is git-ignored; only `.env.example`
      is committed.
- [ ] **`JWT_ACCESS_SECRET`** is long + random (not the dev value).
- [ ] **HTTPS** enforced (Render provides TLS; helmet adds HSTS — docs 26).
- [ ] **CORS_ORIGIN** = your real frontend origin(s); credentials on; no wildcard (docs 26).
- [ ] **Cookie `SameSite`**: `Lax` for same-site, `None; Secure` for a cross-site SPA (docs 13/26).
- [ ] **Rate limits** tuned; a **shared store** if running multiple instances (docs 26).
- [ ] **Migrations** applied via `migrate deploy`; `DIRECT_URL` set.
- [ ] **Health check** green; **graceful shutdown** verified on redeploy.
- [ ] **CI required** on `main` (docs 28); deploys only from green builds.
- [ ] **Email** sending from a **verified domain** (not the shared sandbox).
- [ ] **Logs** monitored; no secrets or `passwordHash` ever logged.

---

## Common mistakes

- **Secrets in the repo / render.yaml** — use dashboard secrets (`sync: false`).
- **`migrate dev`/`reset` in production** — data loss. Only `migrate deploy`.
- **Migrations through the pooled URL** — they fail; use `DIRECT_URL`.
- **Hard-coding the port** instead of reading the platform's `PORT`.
- **No health check** — traffic routed to an instance that isn't ready.
- **Forgetting `trust proxy`** — rate limiting keys on the proxy IP; Secure cookies misbehave.
- **Wildcard/dev CORS in prod** — blocks the real frontend or over-exposes the API.
- **Shipping the dev JWT secret** — forgeable tokens.

---

## Best practices

- **Infrastructure-as-code** (`render.yaml` / Dockerfile) so deploys are reproducible and reviewable.
- **Config from the environment**; fail-fast validation guards bad deploys at boot.
- **`migrate deploy` as a release step**; migrations committed and ordered.
- **Health check + graceful shutdown + `trust proxy`** for zero-drop deploys behind a proxy.
- **CI-gated `main`**, deploy only from green; monitor logs.

---

## Interview questions

1. **Why `migrate deploy` (not `migrate dev`) in production, and why `DIRECT_URL`?** `deploy` only
   applies committed migrations (no reset/generate); a pooler can't run schema changes, so migrations
   need the direct connection.
2. **How does the app avoid serving traffic when misconfigured?** Fail-fast config exits at boot →
   health check fails → the platform doesn't route to it.
3. **What makes a deploy zero-downtime for in-flight requests?** Graceful shutdown on SIGTERM (drain +
   close pool) plus a health-gated rollout.
4. **Why `trust proxy` in production?** So `req.ip`/HTTPS reflect the real client behind the proxy —
   needed for correct rate limiting and Secure cookies.
5. **Where do secrets live, and how does the app read them?** In the platform's secret store, injected
   as env vars; the app reads them through the validated `config` module — never from the repo.

---

## Summary

- Deploy via a committed **Blueprint** (or the **Docker** image): build → **migrate deploy** (release
  step, `DIRECT_URL`) → start → **health-checked** rollout.
- **Production config** comes from platform secrets; **fail-fast** validation blocks broken deploys.
- Going live leans on everything prior: **helmet/CORS/rate-limit** (26), **graceful shutdown** &
  **`trust proxy`**, **CI-gated `main`** (28), and **verified-domain email** (11).
- 🎉 **That completes the 17-phase build** — a production-grade authentication server, engineered and
  documented end to end.

---

## Further reading

- Render Blueprints — <https://render.com/docs/blueprint-spec>
- Prisma migrate in production — <https://www.prisma.io/docs/orm/prisma-migrate/workflows/production-and-testing>
- The Twelve-Factor App — <https://12factor.net/>
