# 32 — Logout & Token Revocation

> Ending a session on purpose. This chapter covers `logout` (revoke the current refresh token + clear
> the cookie), `logout-all` (revoke every session), why the access token is deliberately *not* revoked,
> and the cookie-clearing gotcha. Complements [12 — Token Lifecycle](12-Token-Lifecycle.md).

---

## What "logout" actually means here

Our sessions have two tokens (docs 12):

- a **stateless access token** (JWT, ~15 min) — verified by signature, no server record;
- a **stateful refresh token** (opaque, tracked in the DB) — the thing that keeps a session alive.

So logout targets the **refresh token**: revoke it server-side and delete its cookie. After that, the
client can't renew — the session is over. The access token is left alone; it simply **expires** within
its short TTL.

```
POST /api/auth/logout   (refresh cookie sent automatically)
   ├─ revoke that refresh token in the DB   (server-side: it can never refresh again)
   └─ clear the refresh cookie              (browser drops it)
   → 200
```

---

## Why the access token is NOT revoked (the key idea)

You **cannot un-sign a JWT** — any server can verify it by signature until `exp`, with no DB lookup
(docs 09). So there's no built-in way to "cancel" an access token. Two options exist:

1. **Let it expire** (what we do) — because the TTL is short (15 min), the window where a
   just-logged-out access token still works is tiny and acceptable for most apps.
2. **Maintain a denylist** — store revoked token ids (`jti`) and check every request against it. This
   works but reintroduces a per-request lookup — trading away the statelessness that made JWTs
   attractive. Reserve it for high-sensitivity systems.

We chose **short TTL + refresh revocation**: logout kills the *refreshable* session immediately, and
the access token dies on its own moments later. The client also **discards its in-memory access
token** on logout, so in practice it stops being sent right away.

> This is the concrete answer to the classic "but JWTs can't be revoked" objection: you don't revoke
> the access token — you revoke the refresh token (which *is* stateful) and keep the access token
> short.

We verified revocation works: after `logout`, refreshing with that cookie returned **401** — the token
was gone server-side, not merely cleared from the browser.

---

## `logout` vs `logout-all`

- **`POST /logout`** (public, cookie-driven) — revoke the **current** refresh token only. It's
  **public** because it relies on the cookie, not the access token, so it still works if the access
  token has already expired. It's **idempotent**: no cookie, an expired cookie, or a double logout all
  return **200** — logout should never error.
- **`POST /logout-all`** (protected) — revoke **every** refresh token for the user ("sign out
  everywhere"). It needs `authenticate` to know *which* user. Returns how many sessions were revoked
  (we saw `sessionsRevoked: 2`). Useful after a password change, a lost device, or suspected
  compromise. (Password reset already does this automatically, docs 17.)

---

## The cookie-clearing gotcha

`res.clearCookie(name, options)` only deletes the cookie if the **options match** those used to set it
— specifically **`path`** (and the security flags). A cookie set with `Path=/api/auth` will **not** be
cleared by a bare `clearCookie("refresh_token")`; the browser treats them as different cookies and
keeps the old one. So `clearRefreshCookie` mirrors `setRefreshCookie` exactly.

Mechanically, "clearing" a cookie means sending a `Set-Cookie` with an **expiry in the past** — we saw
`Set-Cookie: refresh_token=; Expires=Thu, 01 Jan 1970 …; HttpOnly; SameSite=Lax; Path=/api/auth`, which
tells the browser to drop it.

> Defense in depth: we **both** revoke server-side **and** clear the cookie. Clearing alone would be
> insecure (a copied cookie value would still work); revoking alone would leave a dead cookie lingering
> in the browser. Do both.

---

## Common mistakes

- **Only clearing the cookie, not revoking the token** → anyone who copied the refresh token can still
  use it. Always revoke server-side too.
- **Mismatched `clearCookie` options** (wrong/absent `path`) → the cookie isn't actually cleared.
- **Making logout error on a missing/expired cookie** → logout must be idempotent (always 200).
- **Requiring a valid access token to log out** → users with an expired access token can't sign out;
  drive logout from the cookie instead.
- **Believing clearing the client token "logs out" a JWT** → the access token stays valid until `exp`;
  revoke the refresh token and keep the access TTL short.
- **Forgetting "log out everywhere"** after password change / device loss.

---

## Best practices

- Logout = **revoke the refresh token** + **clear the cookie** (both), returning **200 idempotently**.
- Make `logout` **cookie-driven and public**; make `logout-all` **authenticated**.
- Keep the access token **short-lived**; have the client **discard it** on logout.
- Match `clearCookie` options to `cookie` options exactly (esp. `path`).
- Consider a **denylist** only if you truly need instant access-token invalidation.

---

## Interview questions

1. **What does logout revoke, and what does it leave alone?** Revokes the refresh token + clears the
   cookie; leaves the access token to expire (can't be un-signed).
2. **Why can't you revoke a JWT access token directly?** It's verified by signature with no server
   record; valid until `exp`. Options: short TTL (ours) or a denylist (per-request lookup).
3. **Why is `logout` public but `logout-all` protected?** Logout uses the cookie (works with an expired
   access token); logout-all needs the authenticated user's id.
4. **Why must logout be idempotent?** A double logout / missing cookie shouldn't error — always 200.
5. **What's the cookie-clearing gotcha?** `clearCookie` must use the same `path`/flags as the original,
   or the browser won't delete it.
6. **Why revoke server-side AND clear the cookie?** Clearing alone leaves a usable copied token;
   revoking alone leaves a dead cookie — do both.

---

## Summary

- Logout revokes the **refresh token** (server-side) and **clears the cookie**; the **access token**
  expires on its own — the deliberate trade for JWT statelessness.
- **`logout`** is public + cookie-driven + idempotent; **`logout-all`** is authenticated and revokes
  every session.
- Clearing a cookie requires **matching options** (path/flags) and sends a past-dated `Set-Cookie`.
- Verified live: post-logout refresh → 401, idempotent repeats → 200, logout-all revoked 2 sessions.
- This completes the token/session model. Next: **Phase 14 — Protected Routes** (consolidating the
  authenticated surface) and onward to hardening/testing/deploy.

---

## Further reading

- OWASP Session Management Cheat Sheet (logout) — <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- MDN: Set-Cookie / cookie deletion — <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie>
