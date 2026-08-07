# Authentication Server

A production-grade authentication service written in TypeScript — JWT access tokens, rotating
opaque refresh tokens, email verification, password reset, role-based authorization, and a full
security/testing/deployment story.

It was built phase by phase as a backend-engineering course, so every file carries explanatory
comments and the [`docs/`](docs/) folder contains 32 written lessons covering the theory behind
each decision.

---

## Features

| Area | What's implemented |
| --- | --- |
| Registration | Zod-validated input, email normalization, bcrypt hashing, DB-level uniqueness (409 on duplicate) |
| Login | Generic 401 for both wrong password and unknown email, timing-equalized with a dummy hash, rehash-on-login when the stored cost factor is stale |
| Access tokens | Short-lived HS256 JWT (`sub`, `email`, `role`), sent via `Authorization: Bearer` |
| Refresh tokens | Long-lived **opaque** token, SHA-256 hashed at rest, delivered in an httpOnly cookie, **rotated** on every use, with **reuse detection** that revokes every session |
| Logout | Per-session logout (cookie-driven, idempotent) and "sign out everywhere" |
| Email verification | Single-use, expiring (24h) hashed token emailed via Resend |
| Password reset | Single-use, expiring (1h) hashed token; resetting revokes all refresh tokens |
| Authorization | `Role` enum (`USER` / `ADMIN`), `authorize(...roles)` and `authorizeSelfOrAdmin()` (IDOR guard) |
| Hardening | helmet, CORS allowlist with credentials, two-tier rate limiting, 10kb body cap, trust-proxy in prod |
| Errors | Typed `AppError` hierarchy → one global handler → a consistent JSON envelope |
| Testing | 42 Vitest tests (unit + Supertest integration against the real app with mocked repositories) |
| Deployment | Multi-stage Dockerfile, GitHub Actions CI, Render blueprint, graceful shutdown |

---

## Tech stack

- **Language / runtime:** TypeScript (strict) on Node.js 20+
- **Framework:** Express 5
- **Database:** PostgreSQL via Prisma 6
- **Validation:** Zod
- **Passwords:** bcryptjs
- **Tokens:** `jsonwebtoken` (access) + opaque random tokens stored hashed (refresh, verify, reset)
- **Email:** Resend
- **Security:** helmet, cors, express-rate-limit
- **Tests:** Vitest + Supertest
- **Deploy:** Docker → GitHub Actions → Render

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
#    then fill in DATABASE_URL, DIRECT_URL, JWT_ACCESS_SECRET, RESEND_API_KEY

# 3. Create the schema
npm run db:migrate

# 4. Run
npm run dev                 # http://localhost:5000
```

Generate a signing secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Smoke test:

```bash
curl http://localhost:5000/health
```

The app **refuses to boot** if any required env var is missing or malformed — it prints every
problem at once and exits 1. That is intentional (see [config/index.ts](src/config/index.ts)).

---

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `production` \| `test` |
| `PORT` | no | `5000` | HTTP port |
| `DATABASE_URL` | **yes** | — | Postgres connection string used by the app (pooled) |
| `DIRECT_URL` | for pooled DBs | — | Unpooled connection used **only** by Prisma Migrate |
| `JWT_ACCESS_SECRET` | **yes** | — | HS256 signing secret, **min 32 chars** |
| `JWT_ACCESS_TTL` | no | `15m` | Access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | no | `7` | Refresh-token lifetime (1–365) |
| `BCRYPT_COST` | no | `12` | bcrypt work factor (10–15) |
| `RESEND_API_KEY` | **yes** | — | Resend API key for transactional email |
| `EMAIL_FROM` | no | `Auth Server <onboarding@resend.dev>` | Sender address |
| `APP_URL` | no | `http://localhost:5000` | Base URL emailed links point at |
| `CORS_ORIGIN` | no | `localhost:3000,localhost:5173` | Comma-separated browser origin allowlist |
| `RATE_LIMIT_WINDOW_MS` | no | `900000` | Rate-limit window (15 min) |
| `RATE_LIMIT_MAX` | no | `100` | Requests / IP / window across the API |
| `AUTH_RATE_LIMIT_MAX` | no | `10` | Stricter cap on sensitive auth routes |

Full annotated template: [.env.example](.env.example).

---

## API

Base URL: `/api`. Every response uses one envelope:

```jsonc
// success
{ "success": true, "data": { /* ... */ } }

// error
{ "success": false, "error": { "name": "ConflictError", "message": "...", "details": [] } }
```

### Public

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/health` | — | Status, uptime, environment |
| `GET` | `/` | — | Service banner |
| `POST` | `/api/auth/register` | `{ email, password, name? }` | `201` + user + `accessToken`, sets refresh cookie, sends verification email (best-effort) |
| `POST` | `/api/auth/login` | `{ email, password }` | `200` + user + `accessToken`, sets refresh cookie |
| `POST` | `/api/auth/refresh` | — (cookie) | Rotates the refresh token, returns a new access token |
| `POST` | `/api/auth/logout` | — (cookie) | Revokes this session, clears the cookie, idempotent |
| `POST` | `/api/auth/verify-email` | `{ token }` | Consumes the emailed one-time token |
| `POST` | `/api/auth/forgot-password` | `{ email }` | **Always** `200` (no account enumeration) |
| `POST` | `/api/auth/reset-password` | `{ token, newPassword }` | Sets the password and revokes all sessions |

### Protected (`Authorization: Bearer <accessToken>`)

| Method | Path | Guard | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/auth/me` | `authenticate` | Current profile (never includes `passwordHash`) |
| `PATCH` | `/api/auth/me` | `authenticate` | Whitelisted fields only (`name`); identity comes from the token, never the body |
| `POST` | `/api/auth/logout-all` | `authenticate` | Revokes every refresh token, returns `sessionsRevoked` |
| `POST` | `/api/auth/resend-verification` | `authenticate` | `400` if already verified |
| `GET` | `/api/auth/users/:id` | `authorizeSelfOrAdmin("id")` | Self or admin only |
| `GET` | `/api/auth/admin/users` | `authorize("ADMIN")` | Admin-only user list |

### Token model

- **Access token** — JWT, 15 minutes, stateless, sent in the `Authorization` header. It cannot be
  revoked; it simply expires. That is the trade-off short TTLs buy.
- **Refresh token** — 48 random bytes, base64url, stored only as a SHA-256 hash, delivered in an
  httpOnly cookie scoped to `/api/auth`. Every use rotates it. Presenting an already-rotated token
  is treated as theft: **all** of that user's sessions are revoked.

---

## Project structure

```
src/
  app.ts               Express app assembly (helmet → cors → parsers → routes → 404 → errors)
  server.ts            Boot: connect DB (with retry) → listen → graceful shutdown
  config/              Validated, fail-fast, fully-typed config (single source of truth)
  constants/           HttpStatus
  types/               API envelope, AuthUser, Express Request augmentation
  errors/              AppError base + BadRequest/Unauthorized/Forbidden/NotFound/Conflict/...
  middlewares/         authenticate, authorize, validate, rateLimit, notFound, errorHandler
  validators/          Zod schemas (+ inferred input types)
  routes/              Pure wiring: method + path → middleware chain → controller
  controllers/         Thin HTTP adapters (no business rules)
  services/            Business logic (auth, token, refreshToken, verification, passwordReset, email)
  repositories/        The only place Prisma is called
  database/            Prisma client singleton + connect/disconnect
  emails/              Resend client + HTML/text templates
  utils/               password, crypto, logger
prisma/                schema.prisma + migrations
tests/                 unit/ + integration/
docs/                  32 written lessons
```

The layering rule is one-directional: **routes → controllers → services → repositories → Prisma**.
A controller never touches the database; a service never touches `req`/`res`.

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | `tsx watch src/server.ts` |
| `npm run build` | `prisma generate && tsc` → `dist/` |
| `npm start` | `node dist/server.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest, watch mode |
| `npm run db:migrate` | `prisma migrate dev` (development) |
| `npm run db:deploy` | `prisma migrate deploy` (production release step) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:studio` | Prisma Studio |

---

## Testing

```bash
npm test
```

42 tests across 5 files. Repositories are **mocked** rather than run against a live database, so the
suite is fast and deterministic; [vitest.config.ts](vitest.config.ts) injects fake env vars (including
a low `BCRYPT_COST` and effectively-disabled rate limits) before `config` is imported, so your real
`.env` and secrets are never touched.

- `tests/unit/` — crypto, password hashing, token signing/verification (including tampered, expired
  and wrong-secret tokens), validators.
- `tests/integration/` — Supertest against the real Express app, in-process: register/login/`me`
  happy paths and failure modes, plus assertions that `passwordHash` never leaks and the refresh
  cookie is `HttpOnly`.

---

## Docker

```bash
docker build -t auth-server .
docker run --rm -p 5000:5000 --env-file .env auth-server
```

The image is multi-stage (build tooling stays out of the runtime layer), runs as the non-root `node`
user, and its entrypoint runs `prisma migrate deploy` before `exec`-ing the server so Node becomes
PID 1 and receives `SIGTERM` for graceful shutdown.

## CI/CD

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push and PR to `main`: install →
`prisma generate` → `typecheck` → `test`. No secrets are required because the tests mock the
database.

## Deployment

[render.yaml](render.yaml) is a Render blueprint: build with `npm ci && npm run build`, run
migrations as a `preDeployCommand`, start with `npm start`, health-check `/health`. Secrets are
marked `sync: false` and injected at runtime — never baked into the image or committed.

Note that Prisma's `binaryTargets` includes `debian-openssl-3.0.x` so the generated query engine
matches the Debian runtime.

---

## Security notes

- Passwords are bcrypt-hashed (cost 12 by default) and never logged or returned.
- Refresh, verification and reset tokens are stored **hashed** — a database leak yields nothing usable.
- Login and forgot-password responses are deliberately generic and timing-equalized to prevent
  account enumeration.
- Refresh-token reuse is treated as compromise and kills every session for that user.
- Password reset revokes all refresh tokens.
- Identity for protected writes comes from the verified token, never the request body; editable
  fields are whitelisted.
- CORS uses an explicit allowlist (never `*`) because credentials are enabled.
- The error handler hides internal details in production.

---

## Documentation

The [`docs/`](docs/) folder explains the *why* behind everything above:

| | |
| --- | --- |
| Foundations | [TypeScript](docs/02-TypeScript.md) · [Node.js](docs/03-NodeJS.md) · [HTTP](docs/04-HTTP.md) · [REST](docs/05-REST.md) · [Express](docs/06-Express.md) |
| Auth theory | [Authentication](docs/07-Authentication.md) · [Authorization](docs/08-Authorization.md) · [JWT](docs/09-JWT.md) · [Access tokens](docs/10-Access-Tokens.md) · [Refresh tokens](docs/11-Refresh-Tokens.md) · [Token lifecycle](docs/12-Token-Lifecycle.md) · [Cookies vs JWT](docs/13-Cookies-vs-JWT.md) |
| Credentials | [bcrypt](docs/14-Bcrypt.md) · [Password hashing](docs/15-Password-Hashing.md) · [Login security](docs/31-Login-and-Credential-Security.md) · [Logout & revocation](docs/32-Logout-and-Token-Revocation.md) |
| Flows | [Email verification](docs/16-Email-Verification.md) · [Forgot password](docs/17-Forgot-Password.md) |
| Middleware | [Authentication middleware](docs/18-Authentication-Middleware.md) · [Authorization middleware](docs/19-Authorization-Middleware.md) · [Protected routes](docs/20-Protected-Routes.md) · [Validation](docs/21-Validation.md) · [Error handling](docs/22-Error-Handling.md) |
| Structure | [Architecture](docs/23-Project-Architecture.md) · [Folder structure](docs/24-Folder-Structure.md) · [Prisma & PostgreSQL](docs/30-Prisma-and-PostgreSQL.md) |
| Shipping | [Testing](docs/25-Testing.md) · [Security best practices](docs/26-Security-Best-Practices.md) · [Docker](docs/27-Docker.md) · [CI/CD](docs/28-CI-CD.md) · [Deployment](docs/29-Deployment.md) |

---

## License

MIT
