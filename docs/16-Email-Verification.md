# 16 — Email Verification

> Proving a user actually owns the email they signed up with. This chapter covers the verification
> token flow, why it mirrors the refresh-token security model, single-use + expiry, and sending via
> Resend.

---

## Why verify email at all

Anyone can type *someone else's* address at signup. Verification proves **control** of the inbox,
which:

- stops people registering with addresses they don't own (impersonation, spam signups),
- ensures password-reset and notifications reach a real, reachable inbox,
- gives you a trust signal to gate sensitive features behind (`isEmailVerified`).

The mechanism: email a **secret link**; only someone with access to that inbox can open it, which
proves ownership.

---

## The flow

```
register ─► create user (isEmailVerified = false)
         ─► issue verification token: store sha256(token), email link with RAW token   (best-effort)
                                   │
   user opens email ──────────────┘
         ▼
   POST /api/auth/verify-email { token }
         ├─ hash token → look up → check type + not used + not expired
         ├─ valid   → mark token used (single-use) + set isEmailVerified = true → 200
         └─ invalid → 400 "Invalid or expired verification token"

   resend: POST /api/auth/resend-verification (authenticated)
         └─ if already verified → 400; else issue a fresh token (old ones invalidated)
```

We keep the account usable before verification (they're still "logged in") and gate only what needs
it — a common UX choice. You could instead block login until verified; that's a policy decision.

---

## Token security — same discipline as refresh tokens

Verification tokens reuse the exact model from [11 — Refresh Tokens](11-Refresh-Tokens.md):

- **Opaque + high entropy** — `generateOpaqueToken()` (384 random bits). Unguessable.
- **Stored hashed** — we save `sha256(token)`, never the raw value; the raw token lives only in the
  emailed link. A DB leak can't be used to verify-hijack accounts. (SHA-256, not bcrypt — high entropy
  + we need an indexable lookup, docs 11.)
- **Single-use** — `usedAt` is stamped on consumption; a used token is rejected. Blocks **replay** of a
  link that leaked (forwarded email, browser history, proxy logs).
- **Expiring** — 24h TTL. A stale link stops working, shrinking the window a leaked link is useful.
- **Typed** — the `type` column (`EMAIL_VERIFICATION` vs `PASSWORD_RESET`) means a reset token can't be
  used to verify email or vice-versa. One table, two flows, no cross-use.
- **Latest-only** — issuing a new token deletes earlier unused ones, so only the most recent link is
  valid.

We verified all of this: a valid token → 200 and `isEmailVerified: true`; the **same token again** →
400 (single-use); an unknown token → 400.

---

## Generic (non-revealing) errors

Verify failures return **one** generic `400 "Invalid or expired verification token"` — we don't say
*which* (unknown vs used vs expired). Like the login enumeration defense (docs 31), a specific message
would help an attacker probe token/account state. Same principle, applied here.

---

## Sending email with Resend (`src/emails/`, `email.service.ts`)

- **`resend.client.ts`** — one `Resend(apiKey)` instance (singleton, like Prisma).
- **`templates.ts`** — pure functions returning `{ subject, html, text }`. We always include a
  **plain-text** part alongside HTML (multipart) for clients that block HTML and for deliverability.
- **`email.service.ts`** — renders the template and calls Resend, returning success/failure.

Two deliberate choices:

- **Best-effort at signup** — sending is wrapped so a transient email outage **never fails
  registration** (the user can resend). Registration and email delivery are decoupled.
- **Dev link logging** — in non-production we `log` the verification link, so the flow is testable
  without an inbox and independent of Resend's test-mode recipient rules.

> **Resend test mode:** without a verified domain, `onboarding@resend.dev` only delivers to your own
> Resend account email, and rejects obviously-fake domains (e.g. `example.com`). To receive a real
> message, register with your Resend account's email or verify a sending domain and set `EMAIL_FROM`
> to an address on it. The API integration is the same either way.

---

## Common mistakes

- **Storing the raw token** → a DB leak lets an attacker verify/hijack accounts. Store the hash.
- **No expiry or no single-use** → leaked links stay usable / replayable.
- **Putting the token in the URL and logging full URLs** in production → tokens leak into logs. (We log
  the link only in dev.)
- **Failing registration when the email send fails** → brittle signup; make it best-effort + resend.
- **Not typing the token** → a password-reset token could verify an email (or vice-versa).
- **Revealing which failure occurred** → aids probing; return a generic error.
- **Auto-verifying on register** (skipping the click) → defeats the purpose; the *inbox access* is the
  proof.

---

## Best practices

- **Opaque, hashed, single-use, expiring, typed** tokens; only the newest link valid.
- **Best-effort send** decoupled from registration; provide **resend**.
- **Multipart** (text + HTML) emails; keep templates pure.
- **Generic** verify errors; **dev-only** link logging.
- Keep secrets (`RESEND_API_KEY`) in the environment; never commit them.

---

## Interview questions

1. **Why verify email, and how does a link prove ownership?** Only someone with inbox access can open
   the secret link → proves control of the address.
2. **How are verification tokens stored, and why?** As a SHA-256 hash (raw token only in the link), so a
   DB leak can't be used to verify accounts.
3. **What makes a verification token safe against replay?** Single-use (`usedAt`) + expiry; the link
   works once, briefly.
4. **Why type the token (EMAIL_VERIFICATION vs PASSWORD_RESET)?** To prevent cross-use of one flow's
   token in another.
5. **Why is sending best-effort at signup?** So a transient email failure doesn't break registration;
   the user can resend.
6. **Why return a generic verify error?** To avoid leaking token/account state to a prober.

---

## Summary

- Email verification proves **inbox ownership** via a secret link; the user starts `isEmailVerified:
  false` and flips to `true` on click.
- Tokens are **opaque, hashed, single-use, expiring, typed** — the refresh-token discipline reused,
  with **generic** failure messages.
- Sending uses **Resend** (multipart templates, singleton client), **best-effort** at signup with a
  **resend** path and **dev link logging** for testability.
- Next: **[17 — Forgot Password](17-Forgot-Password.md)** / **Phase 12**, which reuses this exact
  token model for password reset.

---

## Further reading

- Resend docs — <https://resend.com/docs>
- OWASP Forgot Password / secure token guidance — <https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>
