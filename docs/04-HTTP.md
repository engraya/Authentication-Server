# 04 — HTTP

> Every interaction between a frontend and our auth server is an HTTP message. Authentication lives
> and dies on HTTP details — headers carry tokens, status codes signal auth failures, methods decide
> safety. Learn the protocol precisely.

---

## Definition

**HTTP** (HyperText Transfer Protocol) is a **request/response**, **text-based**, **stateless**
protocol. A client sends a *request*; a server sends back one *response*; the connection carries no
memory of previous exchanges. That statelessness is the single most important fact for
authentication — see below.

---

## History (why it exists)

HTTP began at CERN (Tim Berners-Lee, ~1991) to fetch documents. HTTP/1.1 (1997) added persistent
connections; HTTP/2 (2015) added multiplexing; HTTP/3 (2022) runs over QUIC/UDP. The **semantics** —
methods, status codes, headers — have stayed remarkably stable, which is why learning them once pays
off for decades.

---

## Anatomy of a request

```
POST /auth/login HTTP/1.1            ← method  path  version   (the "request line")
Host: api.example.com                ┐
Content-Type: application/json       │  HEADERS (metadata about the request)
Authorization: Bearer eyJhbGci...    │
Content-Length: 44                   ┘
                                     ← blank line separates headers from body
{"email":"a@b.com","password":"..."} ← BODY (the payload; not present on GET)
```

## Anatomy of a response

```
HTTP/1.1 200 OK                      ← version  status-code  reason   (the "status line")
Content-Type: application/json       ┐
Set-Cookie: refreshToken=...; HttpOnly  │  HEADERS
Content-Length: 68                   ┘
                                     ← blank line
{"accessToken":"eyJ...","user":{...}}← BODY
```

Our `/health` endpoint produces exactly this shape: status `200`, `Content-Type: application/json`
(set automatically by `res.json()`), and a JSON body.

---

## Methods (verbs) — and their contracts

| Method | Meaning | Safe? | Idempotent? | Auth-server example |
|---|---|---|---|---|
| GET | Read a resource | ✅ (no side effects) | ✅ | `GET /me`, `GET /health` |
| POST | Create / perform an action | ❌ | ❌ | `POST /auth/register`, `POST /auth/login` |
| PUT | Replace a resource wholesale | ❌ | ✅ | `PUT /me` (replace profile) |
| PATCH | Partially update | ❌ | ❌ | `PATCH /me` (change one field) |
| DELETE | Remove a resource | ❌ | ✅ | `DELETE /sessions/:id` (revoke) |

- **Safe** = doesn't change server state (so `GET /health` must never mutate anything — a rule we
  followed).
- **Idempotent** = doing it twice has the same effect as once. Matters for retries: a network retry
  of an idempotent request is safe.

---

## Status codes (the ones this project uses)

| Code | Name | When we return it |
|---|---|---|
| **200** | OK | Successful GET/login/refresh with a body |
| **201** | Created | After `POST /auth/register` creates a user |
| **204** | No Content | Successful action with nothing to return (e.g. logout) |
| **400** | Bad Request | Malformed/invalid input (validation failure) |
| **401** | Unauthorized | *Not authenticated* — missing/invalid/expired token or bad credentials |
| **403** | Forbidden | *Authenticated but not allowed* — wrong role/ownership |
| **404** | Not Found | No such route or resource (our fall-through handler) |
| **409** | Conflict | Registering an email that already exists |
| **422** | Unprocessable Entity | Well-formed but semantically invalid (alt. to 400 for validation) |
| **429** | Too Many Requests | Rate limit tripped (Phase 15) |
| **500** | Internal Server Error | Unhandled server-side error (our global handler) |

> **401 vs 403 is a classic interview trap.** 401 = "I don't know who you are" (authentication).
> 403 = "I know who you are, and you can't do this" (authorization). We'll enforce this distinction in
> Phases 9–10.

Code classes: **1xx** informational, **2xx** success, **3xx** redirect, **4xx** *client* error (you
sent something wrong), **5xx** *server* error (we messed up).

---

## Headers that matter for authentication

- **`Authorization: Bearer <jwt>`** — how the client sends the access token on each request (Phase 7/9).
- **`Set-Cookie` / `Cookie`** — how the server plants and the browser returns the refresh-token cookie
  (Phase 8). Attributes `HttpOnly`, `Secure`, `SameSite` are security-critical (Phase 13 docs 13).
- **`Content-Type: application/json`** — tells the server how to parse the body; `express.json()`
  only parses when this is set.
- **`WWW-Authenticate`** — a server hint accompanying some 401s.

---

## Why "stateless" is THE authentication problem

HTTP forgets you between requests. But an app needs to know "this is the same logged-in user across
many requests." Since the protocol won't remember, the **client must present proof of identity on
every single request**. The two ways to carry that proof:

1. A **session id in a cookie** the server looks up (stateful — server remembers). 
2. A **self-describing token** (JWT) the server verifies by signature (stateless — server remembers
   nothing).

Our design uses **both**: a stateless JWT access token *and* a server-tracked refresh token. HTTP's
statelessness is the reason this whole project exists. (Full treatment in docs 09–13.)

---

## Common mistakes

- **Returning 200 for errors** with an `{ error }` body. Clients and monitoring rely on status codes;
  use the right 4xx/5xx.
- **Confusing 401 and 403.** See above.
- **Putting secrets in the URL/query string.** URLs are logged everywhere (proxies, server logs,
  browser history). Tokens go in headers or `HttpOnly` cookies, never `?token=...` (except one-time
  email links, which we design carefully in Phase 11–12).
- **Mutating state on GET.** Breaks caching and the "safe" contract; crawlers can trigger it.

---

## Best practices

- Choose the **most specific correct status code**; don't default everything to 200/500.
- Keep **GET safe and idempotent**; use POST for actions with side effects.
- Send/consume auth material via **headers and `HttpOnly` cookies**, never query strings.
- Always set an accurate **`Content-Type`**.

---

## Interview questions

1. **What does "HTTP is stateless" mean and why does it matter for auth?** No memory between
   requests, so identity must be proven on every request (via cookie/token).
2. **401 vs 403?** Not authenticated vs authenticated-but-forbidden.
3. **Which methods are safe/idempotent and why does it matter?** GET is safe; GET/PUT/DELETE
   idempotent — governs safe retries and caching.
4. **Where should an access token travel?** In the `Authorization: Bearer` header (or a secure
   cookie), never in the URL.
5. **Difference between 200, 201, and 204?** OK-with-body, created-a-resource, success-no-body.

---

## Summary

- HTTP = stateless request/response with **methods, status codes, headers, body**.
- Auth rides on HTTP: tokens in headers/cookies, failures as **401/403**, correct codes everywhere.
- Statelessness is *why* we need tokens/sessions — the backbone of Phases 7–13.
- Next: **[05 — REST](05-REST.md)**, how we organize these methods and paths into a clean API.

---

## Further reading

- MDN HTTP overview — <https://developer.mozilla.org/en-US/docs/Web/HTTP>
- MDN HTTP status codes — <https://developer.mozilla.org/en-US/docs/Web/HTTP/Status>
