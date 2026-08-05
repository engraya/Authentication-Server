# 17 — Forgot Password

> Letting users who've lost their password regain access — safely. This chapter covers the two-step
> reset flow, why "forgot" must never reveal which emails exist, one-time reset tokens, and why a
> successful reset revokes every session.

---

## The problem

A user forgets their password. We can't email it to them (we only store a **hash**, docs 15 — there's
nothing to send). So we prove inbox ownership (like email verification, docs 16) and let them *set a
new* password via a secret, short-lived link.

This is a high-value, heavily-attacked flow: a flaw here is total account takeover. So it's built with
several defenses layered together.

---

## The two-step flow

```
STEP 1 — request
  POST /api/auth/forgot-password { email }
     └─ ALWAYS 200 "if an account exists, a link has been sent"
        └─ IF the email exists: issue a PASSWORD_RESET token (1h), email the link
        └─ IF not:              do nothing (but SAME response)

STEP 2 — reset
  POST /api/auth/reset-password { token, newPassword }
     ├─ validate token (right type, unused, unexpired) → else 400
     ├─ hash newPassword, update user
     ├─ mark token used (single-use)
     └─ REVOKE ALL refresh tokens → every session dies → 200
```

Two public endpoints; the emailed one-time token is the credential for step 2 (no login required —
they've forgotten their password, after all).

---

## Defense 1: no user enumeration (the same-response rule)

`forgot-password` returns the **identical 200** whether or not the email is registered:

> "If an account exists for that email, a reset link has been sent."

If it instead said "no account found" for unknown emails, an attacker could **enumerate** which
addresses have accounts (docs 31) — fuel for phishing and credential stuffing. We verified both an
existing and an unknown email return byte-identical 200s; only the existing one actually gets a token
and email.

> **Timing caveat:** doing real work (DB + email) only for existing accounts is a *timing* side-channel
> in principle. The dominant defense is the identical response; for stricter guarantees you'd equalize
> work (e.g. queue the email so the response returns before sending, or do comparable work on the
> miss). We keep the same-response rule and note the refinement.

---

## Defense 2: one-time, short-lived, typed reset tokens

Reset tokens reuse the exact model from email verification (docs 16), tightened:

- **Opaque + hashed** — random 384-bit token; we store only `sha256(token)`; the raw token lives only
  in the emailed link. A DB leak can't be used to reset passwords.
- **Single-use** — `usedAt` is stamped on reset; replaying the link → 400 (verified).
- **Short TTL — 1 hour** (vs 24h for verification). A reset link can *change the password*, so its
  window is deliberately smaller.
- **Typed `PASSWORD_RESET`** — an email-verification token can't be used to reset a password, and
  vice-versa (same table, different `type`).
- **Latest-only** — requesting again invalidates earlier unused reset tokens.

Generic failure: any invalid/used/expired/wrong-type token returns one `400 "Invalid or expired reset
token"` — no probing signal.

---

## Defense 3: revoke all sessions on reset

A successful reset calls `revokeAllForUser` — **every** refresh token for that user is revoked. Why
this matters:

- People reset passwords precisely **because they suspect compromise**. If an attacker had an active
  session (a stolen refresh token), changing the password alone wouldn't kick them out — their refresh
  token would keep minting access tokens. Revoking all sessions **logs everyone out**, everywhere.
- It also enforces "new password = fresh start": all old sessions end; the user (and only the user)
  logs back in with the new password.

We verified this end to end: a session that refreshed fine **before** the reset was **rejected after**
it (401), and the server logged `revoked 1 session(s)`. The old password no longer logs in (401); the
new one does (200).

---

## Why this reuses Phase 11's machinery

The `VerificationToken` model was built generically (a `type` column) precisely so password reset needs
**no new table and no migration** — just `type: "PASSWORD_RESET"`, a shorter TTL, and a different email
template. Same repository, same crypto, same single-use/expiry logic (DRY). Password hashing reuses
`hashPassword` (docs 14); session revocation reuses `refreshTokenRepository.revokeAllForUser` (docs 11).

---

## Common mistakes

- **Revealing whether the email exists** ("no such user") → enumeration. Always the same response.
- **Emailing the actual password** → impossible anyway (it's hashed) and catastrophic if done.
- **Long-lived or reusable reset tokens** → a leaked link stays dangerous; make them short + single-use.
- **Not revoking sessions on reset** → an attacker with a live session survives the password change.
- **Storing the raw reset token** → a DB leak enables mass account takeover.
- **Not enforcing password policy on the new password** → weak replacements (we validate min 8/max 72).
- **Using the reset token for the wrong flow** → type it.

---

## Best practices

- `forgot-password`: **always the same 200**; only act for real accounts.
- Reset tokens: **opaque, hashed, single-use, short TTL, typed, latest-only**; **generic** errors.
- On reset: **enforce password policy**, **revoke all sessions**, and consider notifying the user by
  email ("your password was changed").
- Keep the token out of production logs (dev-only link logging).

---

## Interview questions

1. **Why can't you email a user their forgotten password?** You only store a hash — there's no password
   to send; you let them set a new one via a secret link.
2. **Why does forgot-password return the same response for known and unknown emails?** To prevent user
   enumeration.
3. **How is a reset token kept safe?** Opaque + hashed at rest, single-use, short TTL (1h), typed.
4. **Why revoke all sessions on password reset?** Resets often follow suspected compromise; otherwise a
   stolen refresh token would survive the change.
5. **Why is the reset TTL shorter than the verification TTL?** A reset link can change the password —
   higher value, so a smaller window.
6. **How did password reset avoid a new migration?** It reuses the generic, typed `VerificationToken`
   model from email verification.

---

## Summary

- Two-step reset: **forgot-password** (always the same 200 — no enumeration) then **reset-password**
  (one-time token → new hashed password → **revoke all sessions**).
- Reset tokens are **opaque, hashed, single-use, short-lived (1h), typed**, with **generic** errors.
- Reset **revokes every session** so a compromise can't survive the change — all verified live.
- Built by **reusing** the Phase 11 token model (no migration), `hashPassword`, and `revokeAllForUser`.
- Next: **Phase 13 — Logout & Token Revocation**, which makes deliberate session termination a
  first-class endpoint.

---

## Further reading

- OWASP Forgot Password Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>
- OWASP Credential Stuffing Prevention — <https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html>
