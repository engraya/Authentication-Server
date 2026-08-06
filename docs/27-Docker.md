# 27 — Docker (Containerizing the App)

> A container packages the app **and its environment** — Node version, OS libraries (OpenSSL for
> Prisma), compiled code, dependencies — into one image that runs identically on your laptop, a
> teammate's machine, CI, and production. It kills "works on my machine". This chapter builds a lean,
> multi-stage image for the auth server.

---

## Why containerize

- **Reproducible**: the image pins Node 20 + OpenSSL + exact deps (via the lockfile). No "which Node
  do you have?" drift.
- **Portable**: the same image runs on Render, Fly, Railway, a VM, or Kubernetes.
- **Isolated**: dependencies live in the image, not your OS.
- **A deploy artifact**: build once, run anywhere; roll back by re-running an older image.

---

## Multi-stage build (why two `FROM`s)

Building needs a toolchain (the TypeScript compiler, all dev deps). *Running* needs none of that —
just Node, the compiled `dist/`, prod deps, and the Prisma client. A **multi-stage** build uses a
`builder` stage to compile, then copies only the results into a slim `runner` stage:

```
builder:  npm ci (all deps) → prisma generate + tsc → dist/ + generated client
                                   │  copy only what's needed
runner:   node_modules + dist + prisma  →  run
```

The build tools never ship. See [Dockerfile](../Dockerfile). Key decisions:

- **Base `node:20-slim` (Debian), not Alpine.** Prisma's query engine links against OpenSSL; Alpine
  uses musl, which needs extra care and the right `binaryTargets`. Debian slim + `openssl` is the
  low-friction, reliable choice. We install `openssl` explicitly in both stages.
- **Copy manifests before source.** `COPY package*.json` then `npm ci` **before** `COPY . .` means
  Docker caches the slow install layer and only reinstalls when dependencies change — not on every
  code edit.
- **`npm ci`, not `npm install`.** `ci` installs *exactly* the lockfile and fails if `package.json`
  and `package-lock.json` have drifted — reproducible, and a drift alarm.
- **Run as non-root (`USER node`).** The base image ships an unprivileged `node` user; a web process
  that doesn't need root shouldn't have it (container-escape blast-radius reduction).

---

## Prisma in a container: `binaryTargets`

Prisma generates a native **query-engine binary** for the platform it runs on. Generate on Windows,
run on Debian → the engine won't match and the app crashes at boot ("Query engine binary for current
platform not found"). We tell Prisma to also build the Debian engine ([schema.prisma](../prisma/schema.prisma)):

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]  // dev box + Debian-12/OpenSSL-3 runtime
}
```

`node:20-slim` is Debian 12 (OpenSSL 3), hence `debian-openssl-3.0.x`. Since we `prisma generate`
inside the builder (same base as the runner), the engine matches — and the explicit target also
covers Render's native Linux build if you deploy that way.

---

## Migrations at startup: the entrypoint

The image's [entrypoint](../docker-entrypoint.sh) applies migrations, then starts the server:

```sh
set -e
npx prisma migrate deploy   # applies pending migrations only; never resets/generates
exec node dist/server.js    # exec → node becomes PID 1, receives SIGTERM directly
```

- **`migrate deploy`** is the production-safe command: it applies committed migrations and nothing
  else. Idempotent — nothing pending is a no-op. It uses `DIRECT_URL` (docs 08) for the unpooled
  connection migrations require.
- **`exec`** matters: without it, the shell stays PID 1 and Node never gets the `SIGTERM` that our
  graceful shutdown (server.ts) listens for — deploys would hard-kill in-flight requests.
- **`set -e`**: if migrations fail, the container refuses to start rather than serving against a
  schema it doesn't expect.

> **Caveat (scale):** running `migrate deploy` on *every* container start is fine for one instance.
> With many instances starting at once, prefer a single **release/pre-deploy step** (what
> [render.yaml](../render.yaml) uses via `preDeployCommand`) so migrations run once per deploy.
> `migrate deploy` takes an advisory lock, so concurrent starts are safe but wasteful.

---

## `.dockerignore`

[.dockerignore](../.dockerignore) keeps the build context small and prevents leaking local artifacts
into image layers — most importantly **`.env` never enters the image** (config is injected at runtime,
not baked in). It also drops `node_modules`, `dist`, `.git`, `tests`, and `docs`.

---

## Build & run locally

```bash
docker build -t auth-server .

# Provide config at RUNTIME via --env-file (never bake secrets into the image):
docker run --rm -p 5000:5000 --env-file .env auth-server

# → migrations apply, then: "Auth server listening on http://localhost:5000"
curl http://localhost:5000/health
```

The image reads the same env vars as local dev (docs 03). `NODE_ENV=production` is set in the image,
so Secure cookies and terse logging switch on automatically.

---

## Common mistakes

- **Copying `.env` into the image** (or `COPY . .` without `.dockerignore`) → secrets baked into a
  layer anyone with the image can read. Inject config at runtime.
- **Single-stage build** → shipping the compiler and dev deps; a fat image with a big attack surface.
- **Copying source before installing deps** → busts the cache on every edit; slow builds.
- **Ignoring `binaryTargets`** → Prisma engine mismatch, boot crash on Debian.
- **No `exec` in the entrypoint** → Node isn't PID 1; SIGTERM is swallowed; no graceful shutdown.
- **Running as root** → unnecessary privilege inside the container.
- **`npm install` instead of `npm ci`** → non-reproducible builds; lockfile drift goes unnoticed.

---

## Best practices

- Multi-stage build; slim base; install `openssl` for Prisma; run as `USER node`.
- Manifests-then-source copy order; `npm ci` from the lockfile.
- Inject secrets at runtime (`--env-file` / platform env), never in the image.
- Set `binaryTargets` for the runtime platform.
- `exec` the server in the entrypoint; let migrations be a release step at scale.
- Keep a tight `.dockerignore`.

---

## Interview questions

1. **Why multi-stage builds?** Compile with the full toolchain in one stage; ship only the runtime
   artifacts in a slim stage — smaller image, smaller attack surface.
2. **Why copy `package*.json` before the source?** To cache the dependency-install layer so it only
   re-runs when deps change.
3. **`npm ci` vs `npm install` in Docker?** `ci` is reproducible (installs the exact lockfile) and
   fails on lockfile drift.
4. **Why does Prisma need `binaryTargets`?** Its query engine is a native binary per platform; the
   runtime OS must have a matching engine.
5. **Why `exec node ...` in the entrypoint?** So Node is PID 1 and receives SIGTERM for graceful
   shutdown instead of being hard-killed.
6. **Where should migrations run?** As a release/pre-deploy step (once per deploy), or a startup
   entrypoint for a single instance — never as an interactive/`migrate dev` command in production.

---

## Summary

- A **multi-stage** Dockerfile compiles in a `builder` and ships a slim, non-root `runner` with only
  `dist/`, prod deps, the Prisma client, and migrations.
- Prisma works in-container via `openssl` + `binaryTargets = [..., "debian-openssl-3.0.x"]`.
- The entrypoint runs `prisma migrate deploy` then `exec`s the server (PID 1 → graceful shutdown).
- Secrets stay OUT of the image (`.dockerignore` + runtime env).
- Next: **docs 28 — CI/CD** (prove every push before it ships).

---

## Further reading

- Docker multi-stage builds — <https://docs.docker.com/build/building/multi-stage/>
- Prisma in Docker — <https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-docker>
