# 07 — Authentication

> The conceptual bedrock of this entire project. Before we store a single user, we must be precise
> about what authentication *is*, what it is *not*, and the two fundamental strategies for doing it.

---

## Definition

**Authentication (authN)** answers one question: **"Who are you?"** It is the process of verifying
that a party is who they claim to be, by checking **credentials** (something they know, have, or are)
against a trusted record.

It is *not* the same as **authorization** (authZ), which answers **"What are you allowed to do?"** —
covered fully in [08 — Authorization](08-Authorization.md). A useful mnemonic:

> **AuthN = identity. AuthZ = permission.** You authenticate *first*, then authorize.

---

## The vocabulary (get these exactly right)

- **Identity** — *who* a user is (a specific account, e.g. user #42, `ahmad@example.com`).
- **Credentials** — the proof of identity a user presents. Three classic **factors**:
  - **Knowledge** — something you *know* (password, PIN).
  - **Possession** — something you *have* (phone receiving an OTP, a hardware key).
  - **Inherence** — something you *are* (fingerprint, face).
  - Combining two or more = **Multi-Factor Authentication (MFA)**.
- **Principal** — the authenticated entity making a request (often "the current user").
- **Session** — a period of authenticated interaction. *How* we remember it splits into the two
  strategies below.

---

## Why authentication exists (the problem)

Recall from [04 — HTTP](04-HTTP.md): **HTTP is stateless.** The server forgets you the instant a
response is sent. Yet an app must treat many separate requests as coming from "the same logged-in
person." So on **every** request the client must present **proof of a prior successful login**. How
we mint, transport, and verify that proof *is* authentication engineering. Everything in Phases 4–14
is an answer to "how do we carry identity across stateless requests, securely?"

---

## The two strategies

### 1. Stateful (session-based) authentication

The server remembers.

```
login  ─► verify credentials ─► create a Session record on the server
                                 (store it: memory / Redis / DB)
                              ─► send the client a Session ID (usually a cookie)

request ─► client sends the Session ID cookie
        ─► server LOOKS UP the session in its store ─► knows who you are
logout ─► server DELETES the session record  ✅ instant, reliable revocation
```

- **Pros:** trivial to revoke (delete the record); the ID reveals nothing on its own.
- **Cons:** the server must **store and look up** state on every request; harder to scale across many
  instances (they must share the session store — hence Redis).

### 2. Stateless (token-based) authentication

The server remembers *nothing*; the token is self-describing and verified by cryptographic signature.

```
login  ─► verify credentials ─► create a signed TOKEN (JWT) containing user id + expiry
                              ─► send the token to the client

request ─► client sends the token (Authorization header)
        ─► server VERIFIES THE SIGNATURE (no lookup) ─► trusts the contents
logout ─► ...tricky. A valid signature stays valid until expiry ⚠️
```

- **Pros:** no server-side session store; any instance can verify independently → scales beautifully.
- **Cons:** **revocation is hard** — you can't "un-issue" a signed token; you rely on short lifetimes.

### Why THIS project combines both

Neither is perfect, so production systems (and we) blend them:

- **Access token = stateless JWT**, short-lived (~15 min). Fast, no lookup, scales.
- **Refresh token = stateful opaque token**, stored hashed in Postgres, long-lived (~7 days).
  Because it's tracked server-side, we can **revoke** it → real logout and token invalidation.

Short-lived stateless token for *speed*; long-lived tracked token for *control*. This is the crux of
Phases 7–13, and why "cookies vs JWT" (docs 13) is a false dichotomy — mature systems use both.

---

## How real companies authenticate users

- **Google** — a central Identity service; after login, short-lived tokens plus long-lived,
  revocable sessions; heavy MFA and device/risk signals. You "sign in with Google" via **OAuth 2.0 /
  OpenID Connect** — delegating authN to Google (a topic we reference but don't build here).
- **GitHub** — password + mandatory 2FA for many actions; **Personal Access Tokens** and OAuth apps
  for API access (scoped, revocable tokens — the same stateful-token idea).
- **Banks** — layered: password + OTP/possession factor + device fingerprinting + strict short
  sessions and aggressive re-authentication for sensitive actions. Higher risk → more factors.

The common thread: **verify identity, then carry a revocable proof across stateless requests, with
lifetime and factors scaled to risk.** That's precisely the model we implement.

---

## Common mistakes

- **Confusing authN with authZ.** Verifying identity ≠ granting permission. Different phases,
  different failure codes (401 vs 403).
- **Storing passwords, ever.** We store a *hash*, never the password (Phase 5). More: docs 14/15.
- **Relying on stateless tokens for instant logout.** A signed JWT is valid until it expires; you
  need a refresh-token/denylist strategy to truly revoke (Phase 13).
- **Long-lived access tokens.** A leaked 30-day JWT is a 30-day breach. Keep access tokens short.
- **Trusting client-supplied identity** (e.g. a `userId` in the body). Identity must come from a
  verified token/session, never from unauthenticated input.

---

## Best practices

- Authenticate on **every** request via a verified token/session — never trust prior requests.
- **Short-lived access + revocable refresh**; scale factors (MFA) to risk.
- Emit **401** for "not authenticated" and reserve **403** for "not permitted" (docs 08).
- Keep the identity source **server-verifiable** (signature or session lookup), never client-asserted.

---

## Interview questions

1. **AuthN vs authZ?** Identity ("who are you") vs permission ("what may you do"); authenticate then
   authorize; 401 vs 403.
2. **Stateful vs stateless auth — tradeoffs?** Session store + easy revocation + scaling cost vs
   no-store + easy scaling + hard revocation.
3. **Why do production systems use both access and refresh tokens?** Short stateless token for
   speed/scale; long-lived tracked token for revocation/control.
4. **What are the three authentication factors?** Knowledge, possession, inherence; combining them =
   MFA.
5. **Why can't you instantly revoke a plain JWT?** A valid signature stays valid until expiry; you
   need short lifetimes plus server-side refresh-token revocation or a denylist.

---

## Summary

- **AuthN = "who are you"**, verified from credentials; distinct from authZ.
- HTTP's statelessness forces us to carry a **proof of login on every request**.
- Two strategies — **stateful (server remembers)** and **stateless (signed token)** — each with a
  clear tradeoff around **scaling vs revocation**.
- Our design **combines** them: stateless JWT access + stateful refresh token.
- Next: **[08 — Authorization](08-Authorization.md)** — once we know *who*, decide *what they may do*.

---

## Further reading

- OWASP Authentication Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- OAuth 2.0 (delegated authN, for context) — <https://oauth.net/2/>
