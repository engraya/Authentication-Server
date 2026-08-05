# 31 — Login & Credential Security

> Login looks trivial — "check email and password" — but it's one of the most attacked endpoints on
> the internet. This chapter covers credential verification and the defenses we built in Phase 6:
> generic errors, timing equalization, and rehash-on-login. Password internals: [14](14-Bcrypt.md) /
> [15](15-Password-Hashing.md).

---

## The login flow

```
POST /api/auth/login  { email, password }
        │
        ▼ validate(loginSchema)         normalize email, require non-empty password (422 on fail)
        ▼ authController.login          thin adapter → service → 200 + user
        ▼ authService.login
             ├─ findByEmail(email)
             │     ├─ NOT found → dummy bcrypt compare → 401 "Invalid email or password"
             │     └─ found:
             │           ├─ verifyPassword(attempt, hash) == false → 401 (same message)
             │           └─ true:
             │                 ├─ if passwordNeedsRehash → re-hash + save (best-effort)
             │                 └─ return public user
        ▼ 200 OK { success:true, data:{ user } }   (Phase 7 adds tokens here)
```

Note the status codes (docs 04): **200** on success (we didn't *create* anything, we verified an
existing resource — contrast with register's **201**); **401** for bad credentials; **422** for
malformed input.

---

## Why login validation differs from registration

The login schema requires only a **non-empty** password — NOT the registration `min(8)` policy. Two
reasons:

1. **Don't leak the policy.** An attacker probing login shouldn't learn your password rules from
   validation messages.
2. **Legacy passwords.** A user whose password predates a policy change must still be able to log in.
   Policy is enforced at **registration and reset**, never at login.

Email is normalized identically (`trim().toLowerCase()`) so the input matches the stored, normalized
value — which is why `"AHMAD@Example.com "` logs into the `ahmad@example.com` account.

---

## User enumeration — and the two ways we prevent it

**User enumeration** is an attacker discovering *which emails have accounts* — valuable for targeted
phishing, credential stuffing, and password-spray attacks. A login endpoint can leak this two ways:

### 1. Response CONTENT

If "no such user" returns *"Email not found"* but a bad password returns *"Wrong password"*, the
attacker learns which emails exist. **Fix:** one **generic** message — `"Invalid email or password"` —
and the same **401** for both. We verified this: wrong-password and unknown-email return byte-identical
responses.

### 2. Response TIMING (the subtle one)

Even with identical messages, timing can leak. The natural code path is:

```
  user not found  → return immediately                 (~a few ms: just a DB miss)
  user found      → run bcrypt.compare (~hundreds of ms) → return
```

An attacker measuring response time sees the fast path and infers "no account here." **Fix:** on the
not-found path, perform a **dummy bcrypt comparison** against a throwaway hash so *both* paths spend
the same ~hundreds of milliseconds. We measured it: wrong-password ≈ unknown-email ≈ ~0.59 s — the fast
tell is gone.

```
  without dummy compare:   found ~600ms │ not-found ~3ms   ← leaks
  with dummy compare:      found ~600ms │ not-found ~600ms ← equal ✅
```

> This is the same principle as bcrypt's own **constant-time** hash comparison (docs 15), applied at
> the request level: never let *time* answer a question your *content* refuses to.

---

## Rehash-on-login (transparent security upgrades)

The only moment the server legitimately holds a user's **plaintext** password is during a successful
login. That's the perfect (and only) opportunity to strengthen their stored hash if our cost factor
has since increased:

```
  login success
     └─ passwordNeedsRehash(storedHash)?   // stored cost < configured cost?
          └─ yes → hashPassword(plaintext) at current cost → updatePasswordHash()
```

We proved it: a user registered at cost 10 logged in under cost 12 and their stored hash silently
became `$2b$12$…`, with an audit log line — no reset required.

**Best-effort by design:** the re-hash is wrapped in try/catch and logged on failure. A hiccup writing
the upgraded hash must **never** turn a valid login into an error — the user still logged in
successfully; we just try again next time.

---

## What login still needs (later phases)

- **Tokens.** Right now a successful login just returns the user. **Phase 7** issues a short-lived
  **access JWT** and a **refresh token** here — that's what actually keeps the user "logged in".
- **Rate limiting / lockout.** Nothing yet stops an attacker from trying thousands of passwords.
  **Phase 15** adds per-IP/per-account rate limiting (→ **429**) and considers lockout/backoff.
- **Account state.** Once email verification exists (**Phase 11**), login may check `isEmailVerified`.

---

## Common mistakes

- **Distinct error messages/status** for bad-email vs bad-password → enumeration.
- **Fixing the message but not the timing** → enumeration via response time (the mistake most people
  miss).
- **Applying the registration password policy at login** → leaks policy, locks out legacy users.
- **Blocking login when the best-effort rehash fails** → self-inflicted outage.
- **Returning the password hash** in the user object (our `PublicUser`/`Omit` prevents it — docs 23).
- **No rate limiting** → unlimited online guessing.
- **Logging the submitted password** (or full body) — never.

---

## Best practices

- **One generic error** (same message + 401) for all credential failures.
- **Equalize timing** on the not-found path (dummy hash compare).
- Validate login **loosely** (non-empty password); enforce policy at registration/reset.
- **Rehash on login** to raise the work factor over time — best-effort, never blocking.
- Plan for **rate limiting/lockout** (Phase 15) and never log secrets.

---

## Interview questions

1. **What is user enumeration and why does it matter?** Learning which emails have accounts; fuels
   phishing, credential stuffing, password spraying.
2. **Two ways a login endpoint leaks account existence, and the fixes?** Response content (→ generic
   message + same status) and response timing (→ dummy hash compare to equalize).
3. **Why return 200 for login but 201 for register?** Register creates a resource; login only verifies
   an existing one.
4. **Why is login validation looser than registration?** To avoid leaking policy and to not lock out
   users whose passwords predate a policy change.
5. **What is rehash-on-login and why best-effort?** Upgrading the stored hash's cost during a
   successful login (when plaintext is available); best-effort so a write failure never blocks login.
6. **What's still missing from this login for production?** Tokens (Phase 7), rate limiting/lockout
   (Phase 15), and (later) an email-verified check.

---

## Summary

- Login = **validate → find user → verify password → (rehash) → respond**, with **200/401/422** codes.
- Prevent **user enumeration** on BOTH axes: identical **content** (generic 401) and equalized
  **timing** (dummy bcrypt compare on the not-found path) — both measured and confirmed.
- Validate login **loosely**; enforce policy elsewhere.
- **Rehash-on-login** transparently upgrades security, best-effort and non-blocking.
- Next: **[09 — JWT](09-JWT.md)** / **Phase 7** — issue an access token + refresh token on successful
  login so the user stays authenticated across requests.

---

## Further reading

- OWASP Authentication Cheat Sheet (incl. generic errors) — <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- OWASP WSTG — Testing for Account Enumeration — <https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/03-Identity_Management_Testing/04-Testing_for_Account_Enumeration_and_Guessable_User_Account>
- OWASP Credential Stuffing Prevention — <https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html>
