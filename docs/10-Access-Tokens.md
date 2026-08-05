# 10 — Access Tokens

> A JWT ([09](09-JWT.md)) is a *format*. An **access token** is a *role*: the short-lived credential a
> client presents on each request to prove it's authenticated. This chapter covers lifetime, transport,
> and why access tokens are deliberately short — which sets up refresh tokens ([11](11-Refresh-Tokens.md),
> Phase 8).

---

## Definition

An **access token** is a credential that grants access to protected resources for a **short** period.
In our system it's a **JWT** signed with HS256, carrying `sub` (user id) and `email`, expiring in
**~15 minutes**. On each request to a protected route, the client sends it and the server verifies it
(the auth middleware in Phase 9).

---

## The lifecycle (where we are in it)

```
  register / login ──► server signs access token ──► returns it in the JSON body
        │                                                     │
        │                                                     ▼
        │                        client stores it and sends it on each request
        │                                                     │
        ▼                                                     ▼
  (Phase 8: also issue a refresh token)          Authorization: Bearer <token>
                                                              │
                                                              ▼
                                          server verifies (Phase 9) ──► 200 or 401
                                                              │
                                              ~15 min later: token expires
                                                              │
                                       (Phase 8: use refresh token to get a new one)
```

Right now (Phase 7) we do the **issue** step: `register` and `login` return
`data.accessToken`. Verifying it to protect routes is **Phase 9**; renewing it is **Phase 8**.

---

## Why so short-lived? (the core design tension)

A JWT can't be un-issued — a valid signature stays valid until `exp` (docs 09). So the **only** built-in
limit on a stolen token is its **lifetime**. That creates a tension:

- **Long-lived** access token → convenient (rare re-auth) but a leak = a long breach window, and no
  way to revoke.
- **Short-lived** access token → a leak is useful only briefly, but the user would have to log in
  every few minutes.

**Resolution:** a short access token (minutes) **plus** a long-lived, **revocable refresh token**
(days) that silently mints new access tokens. Short token for safety; refresh token for convenience and
control. That's why we set `JWT_ACCESS_TTL=15m` now and build refresh tokens in **Phase 8**.

> This is the practical answer to "JWTs can't be revoked": you don't revoke the access token — you keep
> it brief and revoke the **refresh** token, which *is* tracked server-side.

---

## Transport: how the client sends it

The standard is the HTTP **Authorization** header with the **Bearer** scheme:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ...
```

"Bearer" means "whoever bears (holds) this token may use it" — so protecting it matters. Our Phase 9
middleware will read this header, extract the token, and `verifyAccessToken` it.

### Where does the client STORE it? (a real tradeoff — full treatment in docs 13)
- **In memory (JS variable)** — safest against theft (cleared on refresh; not readable by other
  scripts), but lost on page reload.
- **localStorage** — persists, but readable by **any** JavaScript → vulnerable to **XSS** token theft.
  Common but risky.
- **httpOnly cookie** — not readable by JS (XSS-resistant), sent automatically, but needs **CSRF**
  protection and careful `SameSite` settings.

We return the **access token in the JSON body** (client decides storage — memory is recommended), and
in Phase 8 we'll put the **refresh token in an httpOnly cookie** — combining both approaches, which is
exactly why "cookies vs JWT" is a false choice (docs 13).

---

## Why the access token is returned on REGISTER too

We issue a token on `register` as well as `login`, so a newly registered user is **immediately
authenticated** — no forced second round-trip to log in. Common UX in real products. (When email
verification arrives in Phase 11, we may gate certain actions on `isEmailVerified`, but the user can
still be "logged in".)

---

## Common mistakes

- **Long-lived access tokens** — the #1 mistake; keep them minutes, not days/weeks.
- **Treating logout as "delete the client token"** — the token is still valid until `exp`; real
  revocation needs the refresh-token layer (Phase 8/13).
- **Storing the token in localStorage** without weighing XSS risk.
- **Sending the token in the URL/query string** — it lands in logs, history, referrers. Use the
  Authorization header.
- **No expiry**, or forgetting to verify expiry server-side.
- **Overloading the token** with data that changes (roles/permissions can go stale until expiry —
  a reason to keep lifetimes short).

---

## Best practices

- **Short TTL** (we use 15m), tunable via `JWT_ACCESS_TTL`.
- Transport via **`Authorization: Bearer`**; never the URL.
- Return the access token in the **body**; pair with a **refresh token** for longevity (Phase 8).
- Keep claims **minimal and non-sensitive**; verify signature **and** expiry every request.
- Store client-side with the **XSS/CSRF tradeoffs** in mind (docs 13).

---

## Interview questions

1. **What is an access token and why is it short-lived?** A short-lived credential proving
   authentication; brief because a JWT can't be revoked before `exp`, so lifetime bounds a leak.
2. **How is it sent to the server?** `Authorization: Bearer <token>`.
3. **Why issue a token on register, not just login?** So the new user is immediately authenticated.
4. **Access token vs refresh token?** Short-lived, stateless, sent every request vs long-lived,
   revocable, used only to mint new access tokens.
5. **Where should a client store an access token, and what are the risks?** Memory (safest),
   localStorage (XSS risk), httpOnly cookie (CSRF considerations).
6. **How do you actually revoke access if the JWT itself can't be?** Short access TTL + revoke the
   server-tracked refresh token.

---

## Summary

- An **access token** is the short-lived (~15 min) **JWT** a client presents (via **Bearer** header)
  to prove authentication.
- It's deliberately brief because JWTs can't be revoked before expiry — a leak's damage is time-boxed.
- We **issue** it on `register` and `login` (in the JSON body) now; we **verify** it (Phase 9) and
  **renew/revoke** it via **refresh tokens** (Phase 8) next.
- Storage and cookie-vs-header tradeoffs: **[13 — Cookies vs JWT](13-Cookies-vs-JWT.md)**.
- Next build step: **Phase 8 — Refresh Tokens**.

---

## Further reading

- OAuth 2.0 Access Tokens — <https://oauth.net/2/access-tokens/>
- Auth0: Token Best Practices — <https://auth0.com/docs/secure/tokens/token-best-practices>
- OWASP Session Management Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
