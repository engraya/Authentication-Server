# 01 — Introduction

> Part of the **Authentication Server Handbook**. This handbook grows one chapter at a time as we
> build. Read it top to bottom later and it should read like a backend-engineering textbook.

---

## What are we building?

A **production-grade Authentication Server** — the standalone service that a real SaaS company uses
to answer two questions on every request:

1. **Authentication** — *"Who are you?"* (login, tokens, sessions)
2. **Authorization** — *"What are you allowed to do?"* (roles, permissions, ownership)

It is not a UI. It is an **HTTP API** that a frontend (or another backend) talks to in order to
register users, log them in, issue and refresh tokens, verify emails, reset passwords, and protect
routes.

---

## Why a *dedicated* authentication server?

In small apps, auth logic is mixed into the main application. As a company grows, authentication
becomes a **cross-cutting concern** shared by many services (web app, mobile app, internal tools).
Extracting it into one hardened service means:

- **One place** to get security right (hashing, token signing, rate limiting).
- **One place** to audit, log, and patch when a vulnerability is found.
- **Reuse** across every product surface — the mobile app and the web app authenticate the same way.

This is exactly how the big players are structured: Google has a central identity service, GitHub
has one, Auth0/Okta sell *nothing but* this. We are building a small, honest version of the same idea.

---

## How this course works

We build in **17 phases**, one per turn, and never jump ahead:

| Phase | Topic |
|------:|-------|
| 1  | TypeScript project initialization ← *you are here* |
| 2  | Express setup |
| 3  | Authentication architecture |
| 4  | User registration |
| 5  | Password hashing |
| 6  | Login |
| 7  | JWT authentication |
| 8  | Refresh tokens |
| 9  | Authentication middleware |
| 10 | Authorization (roles & permissions) |
| 11 | Email verification |
| 12 | Forgot / reset password |
| 13 | Logout & token revocation |
| 14 | Protected routes |
| 15 | Security hardening |
| 16 | Testing |
| 17 | Deployment (Docker + CI/CD + Render) |

Every phase is delivered as a full lesson: **Goal → Theory → Why it exists → Production explanation
→ Code → Line-by-line walkthrough → Common mistakes → Best practices → Exercises → Interview
questions → Summary.**

---

## The technology stack (and why)

| Concern | Choice | One-line reason |
|---|---|---|
| Language | **TypeScript** (strict) | Catches whole categories of bugs *before* the code runs. |
| Runtime | **Node.js 22 LTS** | JavaScript on the server; great for I/O-heavy APIs. |
| Framework | **Express 5** | Its middleware pipeline *is* the mental model for HTTP servers. |
| Database | **PostgreSQL** | Relational, ACID-compliant, the SaaS default. |
| ORM | **Prisma** | Generates a fully-typed DB client — the cleanest TypeScript data layer. |
| Validation | **Zod** | One schema gives you runtime validation *and* a static type. |
| Passwords | **bcrypt** | Salted, adaptive hashing — the industry standard. |
| Tokens | **JWT** access + **opaque** refresh | Teaches stateless *and* revocable tokens together. |
| Email | **Resend** | Real transactional email delivery. |
| Tests | **Vitest + Supertest** | Modern, TypeScript-native unit + HTTP tests. |
| Deploy | **Docker → Render** via **GitHub Actions** | Reproducible builds and continuous delivery. |

Each of these gets its own deep chapter when we first use it.

---

## The token model in one picture

```
          ┌─────────────────────────────────────────────────────┐
          │  ACCESS TOKEN  (JWT, ~15 min, stateless)             │
 Browser ─┤  sent as:  Authorization: Bearer <jwt>              │
          │  verified by signature — server keeps no copy        │
          └─────────────────────────────────────────────────────┘
          ┌─────────────────────────────────────────────────────┐
          │  REFRESH TOKEN (opaque random, ~7 days, stateful)    │
 Browser ─┤  sent as:  httpOnly + Secure + SameSite cookie      │
          │  stored HASHED in Postgres — can be revoked/rotated  │
          └─────────────────────────────────────────────────────┘
```

Short-lived stateless access token for speed; long-lived revocable refresh token for control. This
combination — *cookies AND JWT together* — is why real systems use both. We unpack it fully in
Phases 7–13.

---

## Prerequisites you'll need later (not yet)

- A **PostgreSQL** database (local Docker or hosted URL) — needed in **Phase 4**.
- A **Resend API key** + a sending domain — needed in **Phase 11**.

We'll flag these again right before they're required.

---

## Summary

- We're building a dedicated, reusable **authentication service**, not just endpoints in an app.
- **Authentication = who you are; Authorization = what you can do.** Different problems.
- The whole project is **TypeScript-first** and taught **one phase at a time**.
- Next chapter: **[02 — TypeScript](02-TypeScript.md)** — why we're not writing plain JavaScript.

---

## Further reading

- OWASP Authentication Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- The Twelve-Factor App (config, deps, processes) — <https://12factor.net/>
