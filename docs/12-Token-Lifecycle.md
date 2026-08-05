# 12 — Token Lifecycle

> How the access token ([10](10-Access-Tokens.md)) and refresh token ([11](11-Refresh-Tokens.md)) work
> together across a session — from login, through silent renewal, to logout. This is the mental model
> that ties Phases 6–13 into one story.

---

## The full lifecycle

```
   ┌─────────┐  credentials
   │  LOGIN  │  verified (docs 31)
   └────┬────┘
        │  issue access token (JWT, ~15m)  + refresh token (opaque, ~7d, hashed in DB)
        ▼
   access token → JS memory        refresh token → httpOnly cookie (Path=/api/auth)
        │                                   │
        ▼                                   │
   ┌──────────────────────────┐             │
   │ AUTHENTICATED REQUESTS   │             │
   │ Authorization: Bearer AT │             │
   │ server verifies signature│  (Phase 9)  │
   └────┬─────────────────────┘             │
        │  ~15 min passes                    │
        ▼                                     │
   access token EXPIRES → 401                 │
        │                                     │
        ▼                                     ▼
   ┌────────────────────────────────────────────────┐
   │ POST /api/auth/refresh   (cookie sent           │
   │  automatically)                                 │
   │   rotate: revoke old refresh, issue new one     │
   │   sign a NEW access token                       │
   └────┬───────────────────────────────────────────┘
        │  new AT (memory) + new refresh cookie
        ▼
   ...loop: authenticated requests → expiry → refresh → ...
        │
        ▼
   ┌─────────┐
   │ LOGOUT  │  revoke the refresh token; clear the cookie (Phase 13)
   └─────────┘  access token still valid until its short exp, then gone
```

---

## Stage by stage

### 1. Login → issue both tokens
Credentials verified (docs 31). Server signs a short **access token** and issues a long **refresh
token** (stores its hash). Access token → response body (client keeps it in memory); refresh token →
httpOnly cookie.

### 2. Authenticated requests → verify the access token
Client sends `Authorization: Bearer <access token>`. The server verifies the **signature + expiry**
with no DB lookup (Phase 9 middleware). Fast and stateless — the refresh token is NOT sent on these
requests (the cookie is scoped to `/api/auth`).

### 3. Access token expires → 401
After ~15 minutes the access token's `exp` passes; the next request gets a 401 "Access token expired".
This is expected, not an error state.

### 4. Refresh → rotate + new access token
The client calls `POST /api/auth/refresh`; the browser sends the refresh cookie automatically. The
server **rotates** the refresh token (revoke old, issue new — reuse-detected, docs 11) and signs a
**new access token**. The client resumes. This is usually **silent** — a frontend interceptor catches
the 401, calls refresh, and retries the original request.

### 5. Logout → revoke + clear (Phase 13)
Logout **revokes** the refresh token server-side and **clears** the cookie. The current access token
can't be un-signed, but it dies within its short TTL — which is the whole reason it's short.

---

## Why this design (the tradeoffs it balances)

| Goal | Handled by |
|---|---|
| Fast, scalable per-request auth (no DB lookup) | stateless **access token** (JWT) |
| Staying logged in for days | long-lived **refresh token** |
| Real logout / revocation | refresh token is **stateful** (DB) + revoked on logout |
| Limit damage of a leaked access token | **short TTL** (minutes) |
| Limit damage of a leaked refresh token | **rotation** + **reuse detection** + httpOnly cookie |
| Resist XSS stealing the long-lived token | refresh token in **httpOnly cookie** |

No single token type achieves all of this; the **pair** does.

---

## Failure & attack paths (and the system's answer)

- **Access token stolen** → usable only until its short `exp`; can't be refreshed without the cookie.
- **Refresh token stolen** → attacker can mint access tokens *until* either party rotates; the first
  reuse triggers **detection** → all sessions revoked (docs 11).
- **Refresh token expired** → 401; user logs in again.
- **User deleted mid-session** → refresh finds no user → 401 (our `authService.refresh` guards this).
- **Server restart** → no impact: access tokens verify by signature; refresh tokens live in the DB.
  (Contrast an in-memory session store, which would lose all sessions.)

---

## Common mistakes

- **Long access-token TTL** to avoid refreshing → defeats the whole point; keep it short and refresh.
- **Not rotating** refresh tokens → a leak lasts the full lifetime and reuse is undetectable.
- **Sending the refresh token on every request** → unnecessary exposure; scope its cookie to
  `/api/auth`.
- **Treating a 401 from expiry as a hard logout** → it's the trigger to refresh, not to sign out.
- **Forgetting to clear/revoke on logout** → "logout" that doesn't actually end the session.

---

## Best practices

- **Short access TTL + rotating refresh token**; refresh silently on 401.
- Keep the refresh token **out of JS** (httpOnly cookie) and **scoped** to the auth path.
- **Revoke on logout**; support **revoke-all** ("log out everywhere").
- Make the client's refresh flow **idempotent/queued** so concurrent 401s don't double-refresh (a
  frontend concern to be aware of).

---

## Interview questions

1. **Walk through the token lifecycle from login to logout.** Issue AT+RT → Bearer requests → AT
   expires (401) → refresh rotates RT + issues new AT → … → logout revokes RT + clears cookie.
2. **What happens when the access token expires?** A 401 triggers a refresh; the client gets a new AT
   and retries — usually invisibly.
3. **Why doesn't the refresh token go out on every request?** It's not needed and increases exposure;
   the cookie is path-scoped to the auth routes.
4. **What survives a server restart, and why?** Both: access tokens verify by signature; refresh
   tokens are in the DB — unlike an in-memory session store.
5. **How is a stolen refresh token contained?** Rotation + reuse detection revoke all sessions on the
   first replay; httpOnly limits theft in the first place.

---

## Summary

- The lifecycle: **login issues both tokens → Bearer requests verify the access token → on expiry,
  refresh rotates the refresh token and mints a new access token → logout revokes + clears**.
- The **pair** balances speed/scale (stateless AT) with control/revocation (stateful RT), while short
  TTL + rotation + reuse detection + httpOnly cookies bound the damage of any leak.
- Next: **[13 — Cookies vs JWT](13-Cookies-vs-JWT.md)** — the storage/transport tradeoffs behind these
  choices.

---

## Further reading

- Auth0: Tokens & Sessions — <https://auth0.com/docs/secure/tokens>
- OWASP Session Management Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
