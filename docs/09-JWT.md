# 09 — JWT (JSON Web Tokens)

> The mechanism that lets a stateless server recognize a logged-in user on every request. This chapter
> is JWT from first principles: structure, signing, verification, and the security model. How we *use*
> JWTs as access tokens (lifetime, transport, revocation) is [10 — Access Tokens](10-Access-Tokens.md).

---

## Definition & the problem it solves

A **JSON Web Token (JWT)** is a compact, URL-safe, **digitally signed** token that carries **claims**
(facts) about a user. It's defined by **RFC 7519**.

Recall the problem from [07 — Authentication](07-Authentication.md): HTTP is stateless, so the user
must prove "I already logged in" on every request. A JWT is one answer: at login the server issues a
signed token; the client sends it back on each request; the server **verifies the signature** and
trusts the claims inside — **without any server-side session lookup**. That statelessness is JWT's
defining advantage (and, for revocation, its defining challenge — docs 10/11).

---

## Anatomy: three Base64url parts

A JWT is three Base64url-encoded parts joined by dots:

```
   header . payload . signature

   eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9   ← header
   .eyJlbWFpbCI6Ii4uLiIsInN1YiI6Ii4uLiJ9  ← payload
   .qF5wJULTPMEk3hfp...                    ← signature
```

Our live token decoded to exactly this:

### 1. Header
```json
{ "alg": "HS256", "typ": "JWT" }
```
`alg` is the signing algorithm (we use **HS256** = HMAC-SHA256), `typ` is the token type.

### 2. Payload (claims)
```json
{ "sub": "83d16826-…", "email": "newuser7@example.com", "iat": 1785267507, "exp": 1785268407 }
```
Claims are just JSON. Some are **registered** (standardized) claims:
- **`sub`** (subject) — who the token is about; we put the **user id** here.
- **`iat`** (issued-at) and **`exp`** (expiry) — Unix timestamps; the library sets these. Our token's
  `exp - iat = 900s = 15 min`.
- Others you'll meet: `iss` (issuer), `aud` (audience), `nbf` (not-before), `jti` (token id).

Plus our custom claim `email`. **Keep the payload small** — it's sent on every request.

### 3. Signature
```
HMAC-SHA256( base64url(header) + "." + base64url(payload), secret )
```
The signature binds the header+payload to our **secret**. This is the whole security model.

---

## ⚠️ Encoded, NOT encrypted

Base64url is **encoding**, not encryption (docs 15). **Anyone can read a JWT's payload** without the
secret — we demonstrated decoding it with a one-liner. Therefore:

- **Never put secrets** (passwords, card numbers, private data) in a JWT payload.
- The payload is **public**; the **signature** is what's protected.

What the secret prevents is **forgery**: without it you cannot produce a valid signature, and changing
any byte of header/payload invalidates the existing one.

---

## Signing & verification (the trust model)

```
   SIGN (at login)                          VERIFY (each request)
   ───────────────                          ─────────────────────
   claims ─┐                                token ─┐
   secret ─┼─ HMAC-SHA256 ─► signature      secret ─┼─ recompute HMAC over header.payload
           └─ token = h.p.sig                       └─ recomputed == provided signature?
                                                        AND exp not passed?  → trust claims
```

Because verification only needs the **secret** and some CPU — **no database lookup** — any server
instance can validate a token independently. That's why JWT auth scales horizontally so well.

We proved the model end to end:
- A **genuine** token verified and returned its `{ sub, email }`.
- A **tampered** token (one signature byte flipped) was **rejected** — "Invalid access token".
- An **expired** token (1-second TTL) was **rejected** — "Access token expired".

### HS256 (symmetric) vs RS256 (asymmetric)
- **HS256** — one **shared secret** signs and verifies. Simple; perfect when the *same* service does
  both (our case). Everyone who can verify can also sign.
- **RS256** — a **private key** signs, a **public key** verifies. Use when *other* services must verify
  tokens without the power to mint them (e.g. a central auth server + many microservices), or with
  third-party identity providers. We use HS256; the concept generalizes.

---

## How we implement it (`src/services/token.service.ts`)

- `signAccessToken(user)` → `jwt.sign({ email }, secret, { subject: user.id, expiresIn })`. `subject`
  sets `sub`; `expiresIn` sets `exp`; `iat` is automatic.
- `verifyAccessToken(token)` → `jwt.verify(token, secret)`, then narrows the result and confirms our
  claims. It **translates library errors** into our `UnauthorizedError` (401): `TokenExpiredError` →
  "Access token expired", `JsonWebTokenError` (bad signature/malformed) → "Invalid access token" — so
  the global handler responds consistently. This is the only module that imports `jsonwebtoken`.
- The **secret** comes from `config.jwt.accessSecret`, which is **required and length-checked** at boot
  (a short secret is brute-forceable → forgeable tokens).

---

## Common attacks & how we're protected

- **`alg: none` attack** — historically, some libraries accepted a token whose header said "no
  signature". Modern `jsonwebtoken` with a secret rejects this; never allow `none`.
- **Algorithm confusion (RS/HS)** — tricking a verifier into treating an RS256 public key as an HS256
  secret. Mitigation: pin the expected algorithm. (With HS256-only and a private secret, not
  applicable to us, but know it.)
- **Weak secret** — brute-force the secret → forge tokens. Mitigation: long random secret (we enforce
  ≥32 chars) and rotate it if leaked.
- **Tampering** — any change invalidates the signature (demonstrated).
- **Leaked/`stolen` token** — valid until `exp`; this is JWT's hard problem, mitigated by **short
  lifetimes** + **refresh-token revocation** (docs 10/11, Phase 8).
- **Reading sensitive data from the payload** — don't store it there; it's public.

---

## Common mistakes

- Believing the payload is **encrypted** — it's readable; keep secrets out.
- **Long-lived** access tokens — a leak becomes a long breach; keep them short.
- **No expiry** (`exp`) — a token valid forever.
- **Weak/committed secret** — forgeable tokens; keep it long, random, and in the environment.
- Putting **too much** in the payload — it's sent every request; bloats headers.
- Trying to "log out" by deleting the client token only — the token stays valid until `exp` (revocation
  is docs 10/11).

---

## Best practices

- **HS256** with a **long random secret** (env, ≥32 chars); pin the algorithm on verify.
- **Always set `exp`**; keep access tokens **short** (minutes).
- Minimal, **non-sensitive** payload; use `sub` for the user id.
- **Verify** signature *and* expiry every request; map errors to **401** consistently.
- Plan revocation via **refresh tokens** (Phase 8), not by trusting the client to discard tokens.

---

## Interview questions

1. **What are the three parts of a JWT?** Header, payload, signature (Base64url, dot-separated).
2. **Is a JWT encrypted?** No — encoded. The payload is readable; the signature provides integrity/
   authenticity. Never store secrets in it.
3. **How does signature verification work, and why does it scale?** Recompute the HMAC with the secret
   and compare; no DB lookup, so any instance can verify independently.
4. **HS256 vs RS256?** Symmetric shared secret vs asymmetric private-sign/public-verify; RS256 suits
   multi-service/third-party verification.
5. **What's the `alg: none` attack?** Forging a token with no signature; reject `none` and pin the
   algorithm.
6. **Why can't you instantly revoke a JWT, and what's the mitigation?** A valid signature stays valid
   until `exp`; mitigate with short lifetimes + refresh-token revocation.

---

## Summary

- A **JWT** is a signed, URL-safe token of **claims**: `header.payload.signature` (Base64url).
- The payload is **encoded, not encrypted** — public; trust comes from the **signature** over a
  **secret**, verified with no DB lookup (hence great horizontal scaling).
- We sign with **HS256** + a required, length-checked secret; every token has a short **`exp`**; verify
  errors map to **401**. Genuine/tampered/expired behavior all confirmed live.
- JWT's weakness is **revocation** — addressed next.
- Next: **[10 — Access Tokens](10-Access-Tokens.md)** — lifetime, transport, and the revocation story.

---

## Further reading

- RFC 7519 (JWT) — <https://datatracker.ietf.org/doc/html/rfc7519>
- jwt.io (decoder + intro) — <https://jwt.io/>
- OWASP JWT for Java (concepts apply broadly) — <https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html>
