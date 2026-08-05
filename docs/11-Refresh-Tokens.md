# 11 — Refresh Tokens

> The counterpart to the access token ([10](10-Access-Tokens.md)): a long-lived, **revocable**
> credential that mints new access tokens without re-login. This is where JWT's revocation weakness is
> finally solved — with a server-tracked, rotating, reuse-detecting token.

---

## The problem it solves

Access tokens are short-lived and **can't be revoked** before they expire (docs 09/10). If that were
the whole story, users would re-enter their password every 15 minutes. The refresh token fixes both
sides:

- **Longevity** — it lives for days, so the user stays logged in.
- **Control** — it's **stored server-side**, so we CAN revoke it (real logout, theft response), which
  a stateless JWT can't offer.

```
  access token   = short-lived, stateless, sent every request   → speed, scale
  refresh token  = long-lived, STATEFUL (tracked in DB), used only to get access tokens → control
```

Short token for speed; tracked token for revocation. Using both is why "cookies vs JWT" is a false
dichotomy (docs 13).

---

## Why OPAQUE, not a JWT

A refresh token is a **random opaque string** (384 bits from `crypto.randomBytes`), NOT a JWT. On
purpose:

- A JWT is **self-validating** — the server would accept it without a lookup, so it couldn't be
  revoked (the exact weakness we're fixing).
- An opaque token means **nothing** on its own; the server must **look it up** in the DB to honor it.
  That lookup is precisely what lets us mark it revoked/expired. Statefulness is the point.

---

## Why we store only a HASH (and why SHA-256, not bcrypt)

We store `sha256(token)`, never the raw token — so a database leak can't be used to steal sessions
(same reasoning as passwords, docs 15). But unlike passwords we use **SHA-256**, not bcrypt:

- Refresh tokens are **high-entropy** (256+ random bits) → brute-forcing them is infeasible regardless
  of hash speed, so bcrypt's slowness buys nothing.
- We must **look a token up by value** on every refresh. bcrypt salts each hash differently, so you
  can't query by it — you'd have to compare against every row. **SHA-256 is deterministic**, so the
  hash is an indexable key: hash the incoming token, `findUnique` by it. (`src/utils/crypto.ts`)

The raw token lives only in the client's httpOnly cookie; the DB holds only its hash.

---

## Rotation (single-use tokens)

Every time a refresh token is used, we **issue a new one and revoke the old** — the token is
**single-use**. Benefits:

- A refresh token is valid for exactly one exchange, so a leaked one has a tiny window.
- It creates a detectable pattern: if an *old* token is ever presented again, something is wrong.

```
  refresh(tokenA) ─► issue tokenB, revoke tokenA (replacedByHash = hash(B)) ─► client now holds tokenB
  refresh(tokenB) ─► issue tokenC, revoke tokenB ...
```

Our `refreshTokenService.rotate` does exactly this; the `refresh_tokens.replacedByHash` column records
the trail.

---

## Reuse detection (turning rotation into theft detection)

Because tokens are single-use, **presenting an already-revoked token is a red flag**: either the
legitimate client and an attacker both hold a copy (the token was stolen), or an old token is being
replayed. Our response is aggressive and correct:

```
  incoming refresh token
     ├─ not found            → 401 "Invalid refresh token"
     ├─ REVOKED (used before) → REUSE! revoke ALL of the user's tokens → 401
     ├─ expired              → 401 "Refresh token expired"
     └─ active               → rotate (issue new, revoke this) → 200 + new access token
```

Revoking **all** the user's tokens kills every session and forces a fresh login — so even if an
attacker stole a token, the moment either party rotates, the whole family dies. We verified this live:
reusing an old token returned **401 "Refresh token reuse detected"**, and afterwards even the *newest*
valid token was rejected — every session revoked.

> This is the single most important reason rotation exists. Rotation without reuse detection is just
> housekeeping; **with** it, rotation becomes a theft alarm.

---

## Transport: the httpOnly cookie

The raw refresh token is delivered as an **httpOnly cookie**, never in the JSON body:

```
Set-Cookie: refresh_token=<raw>; Path=/api/auth; HttpOnly; SameSite=Lax; Expires=<7d>[; Secure]
```

- **HttpOnly** — client JavaScript can't read it, so an **XSS** bug can't exfiltrate the powerful
  long-lived token. (The short access token stays in JS memory; if it leaks, it dies in minutes.)
- **Path=/api/auth** — the browser only sends it to the auth routes (refresh/logout), minimizing
  exposure.
- **SameSite=Lax** / **Secure** — CSRF and HTTPS considerations (docs 13). Secure is on in production.

This split — access token in memory, refresh token in an httpOnly cookie — is the crux of combining
JWT and cookies (docs 13).

---

## How our implementation fits together

- `refresh_tokens` table: `tokenHash @unique`, `userId`, `expiresAt`, `revokedAt?`, `replacedByHash?`.
- `refreshTokenService.issue(userId)` → random token, store its hash + expiry, return the raw value.
- `refreshTokenService.rotate(raw)` → the state machine above (not-found / revoked→reuse / expired /
  rotate).
- `authService.register|login` → issue a refresh token alongside the access token.
- `authService.refresh` → rotate, then sign a new access token for the owning user.
- `authController` → sets/reads the httpOnly cookie; `POST /api/auth/refresh` drives it.

---

## Common mistakes

- **Using a JWT as the refresh token** → can't revoke it; defeats the purpose.
- **Storing the raw token** (not a hash) → a DB leak hands out live sessions.
- **Using bcrypt** for refresh tokens → can't look them up by value (per-row salt); needless slowness.
- **No rotation** → a leaked refresh token is usable for its full lifetime.
- **Rotation without reuse detection** → you miss the theft signal rotation exists to provide.
- **Returning the refresh token in the JSON body / localStorage** → XSS can steal it; use an httpOnly
  cookie.
- **Never expiring refresh tokens** → an unbounded credential.

---

## Best practices

- **Opaque, high-entropy** refresh tokens; store only a **SHA-256 hash**.
- **Rotate** on every use (single-use) and **detect reuse** → revoke all sessions on a hit.
- Deliver via **httpOnly, Secure, SameSite** cookie scoped to the auth path.
- Bounded **expiry** (we use 7 days, configurable); pair with a short access-token TTL.
- Revoke on **logout** (Phase 13) and provide "log out everywhere" (revoke all).

---

## Interview questions

1. **Why do you need a refresh token if you already have a JWT access token?** Longevity without long
   access tokens, and server-side revocation the JWT can't provide.
2. **Why is the refresh token opaque, not a JWT?** So it must be looked up server-side and can be
   revoked; a self-validating JWT couldn't be.
3. **Why store a hash, and why SHA-256 instead of bcrypt?** Protect against DB leaks; SHA-256 is
   deterministic (indexable lookup) and tokens are high-entropy so slow hashing is unnecessary.
4. **What is rotation and what does it buy you?** Single-use tokens; small leak window and a detectable
   reuse pattern.
5. **What is reuse detection and how do you respond?** An already-revoked token reappearing signals
   theft/replay; revoke ALL the user's tokens and force re-login.
6. **Why deliver the refresh token in an httpOnly cookie?** So XSS can't read the long-lived
   credential; the short access token stays in memory.

---

## Summary

- A **refresh token** is a long-lived, **opaque**, server-tracked credential that mints access tokens —
  giving longevity **and** revocation.
- We store only its **SHA-256 hash**, **rotate** it on every use, and **detect reuse** by revoking all
  sessions when a retired token reappears (verified live).
- It rides in an **httpOnly cookie** scoped to `/api/auth`; the access token stays in memory — the
  JWT-plus-cookie combination.
- Next: **[12 — Token Lifecycle](12-Token-Lifecycle.md)** ties access + refresh together end to end.

---

## Further reading

- OAuth 2.0 Refresh Token Rotation — <https://oauth.net/2/grant-types/refresh-token/>
- Auth0: Refresh Token Rotation & Reuse Detection — <https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation>
- OWASP Session Management Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
