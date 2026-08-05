# 13 — Cookies vs JWT

> A famously confused topic. The short version: **they aren't alternatives.** "JWT" is a token
> *format*; "cookie" is a *transport/storage* mechanism. This chapter untangles them and explains the
> storage tradeoffs behind our design (access token in memory, refresh token in an httpOnly cookie).

---

## The category error

People ask "should I use cookies or JWT?" — but they answer different questions:

- **JWT** = *what* the token is (a signed, self-describing token — docs 09).
- **Cookie** = *how* a value is stored in the browser and sent to the server (automatically, via the
  `Cookie` header).

You can put a JWT in a cookie. You can put an opaque token in a cookie. You can send a JWT in an
`Authorization` header instead. **Format and transport are independent axes.** The real questions are:

1. What **format** is the token? (JWT vs opaque — docs 09/11)
2. **Where** does the client store it, and **how** is it sent? (memory + header vs cookie)

---

## Storage options and their tradeoffs

Where a browser client keeps a token determines what can steal it.

| Storage | Sent how | XSS (script theft) | CSRF | Persists reload? |
|---|---|---|---|---|
| **JS memory** (variable) | you add `Authorization` header | **Safe-ish** — not in a readable store | N/A (no auto-send) | No |
| **localStorage** | you add header | **Vulnerable** — any script can read it | N/A | Yes |
| **Cookie (httpOnly)** | browser sends automatically | **Safe** — JS can't read it | **Vulnerable** (mitigate w/ SameSite) | Yes |

Two different threats drive the choice:

- **XSS** (malicious JavaScript running on your page) can read anything JS can read — so `localStorage`
  and non-httpOnly cookies are exposed. An **httpOnly** cookie is invisible to JS.
- **CSRF** (a forged cross-site request riding the browser's auto-sent cookie) only affects things the
  browser sends **automatically** — i.e. **cookies**. Tokens you attach manually via a header aren't
  auto-sent, so they're not CSRF-able.

There's no single "safe" box — each option trades one risk for another. The mitigation is to match
storage to each token's risk profile.

---

## Our design: use BOTH, deliberately

We split the two tokens across the two mechanisms so each sits where its risk is lowest:

```
  access token (JWT, ~15m)      → returned in body → client keeps in MEMORY → Authorization: Bearer
     ├─ XSS: if stolen, dies in minutes (short TTL)
     └─ CSRF: not auto-sent (manual header) → immune

  refresh token (opaque, ~7d)   → httpOnly cookie (Path=/api/auth, SameSite=Lax[, Secure])
     ├─ XSS: httpOnly → JS can't read it → can't be exfiltrated
     └─ CSRF: SameSite=Lax + path scope + it only mints tokens (mitigated; see below)
```

Reasoning:
- The **long-lived, powerful** refresh token is the one you most want to protect from XSS → **httpOnly
  cookie**.
- The **short-lived** access token can live in **memory**: even if XSS grabs it, it expires in minutes,
  and being header-sent it's CSRF-immune.

This is exactly why mature systems "combine cookies and JWT" — not confusion, but putting each token
where it's safest.

---

## Cookie attributes we use (and why)

Seen live in our `Set-Cookie: refresh_token=…; Path=/api/auth; HttpOnly; SameSite=Lax; Expires=…`:

- **HttpOnly** — JS can't read the cookie → XSS can't steal the refresh token. (The key control.)
- **Secure** — cookie only sent over HTTPS. On in production; off on localhost `http` for dev.
- **SameSite** — controls cross-site sending, the main CSRF lever:
  - `Strict` — never sent on cross-site requests (safest; can break some top-level nav flows).
  - `Lax` (ours) — sent on top-level navigations but not cross-site subrequests; a good default.
  - `None` — always sent; **requires `Secure`**. Needed when the frontend is on a **different origin**
    from the API (a cross-site SPA). Then you also need CORS with credentials and CSRF defenses.
- **Path=/api/auth** — the browser only attaches it to auth routes (refresh/logout), so it's not sent
  with ordinary API calls — less exposure.
- **Expires/Max-Age** — bounds its lifetime to the refresh TTL.

> Deployment note (Phase 15/17): if your frontend and API are on **different domains**, you'll switch
> to `SameSite=None; Secure` and add CORS `credentials: true` + an origin allowlist, plus CSRF
> protection. Same-site or same-origin setups can keep `Lax`.

---

## When you'd choose differently

- **Server-rendered app, same origin** → a single httpOnly session/JWT cookie is often simplest; CSRF
  handled by SameSite + tokens.
- **Third-party API consumers / mobile** → no cookies; bearer tokens in headers (memory/secure
  storage), refresh via a token endpoint.
- **Microservices verifying tokens they didn't issue** → JWT (often RS256) so they can verify without
  a shared session store (docs 09).

Our choice (SPA-style: memory access token + httpOnly refresh cookie) is a widely used, balanced
default.

---

## Common mistakes

- **Framing it as "cookies vs JWT"** — different axes; you usually use both.
- **Storing the refresh token (or any long-lived token) in `localStorage`** → XSS steals it.
- **Assuming cookies are automatically safe** → they carry CSRF risk; set `SameSite`/`Secure`.
- **Forgetting `Secure` with `SameSite=None`** → browsers reject the cookie.
- **Not scoping the cookie `Path`** → the token is sent more widely than necessary.
- **Putting sensitive data in a JWT** because "it's in a cookie" → the payload is still readable (docs
  09).

---

## Best practices

- Decide **format** and **storage** separately, per token and per threat model.
- **Short access token in memory** (header-sent) + **long refresh token in an httpOnly, Secure,
  SameSite cookie** — our default.
- Set **HttpOnly + Secure + SameSite** and a minimal **Path** on auth cookies.
- For **cross-origin** frontends: `SameSite=None; Secure` + CORS credentials + CSRF defenses.

---

## Interview questions

1. **Cookies vs JWT — how do you respond?** They're different axes (format vs transport); JWTs can live
   in cookies or headers; you typically combine them.
2. **XSS vs CSRF — which storage is vulnerable to which?** localStorage/JS-readable → XSS; auto-sent
   cookies → CSRF. httpOnly stops XSS reads; SameSite mitigates CSRF.
3. **Why put the refresh token in an httpOnly cookie but the access token in memory?** Protect the
   long-lived token from XSS; the short one is low-risk and header-sent (CSRF-immune).
4. **What does `SameSite` do, and when do you need `None`?** Controls cross-site cookie sending;
   `None` (+`Secure`) is required for cross-origin frontends.
5. **Is data in a JWT hidden because it's in a cookie?** No — the payload is only encoded; never store
   secrets in it.

---

## Summary

- **"Cookies vs JWT" is a false choice**: format (JWT/opaque) and storage (memory/localStorage/cookie)
  are independent.
- Threats split cleanly: **XSS** reads JS-accessible storage; **CSRF** rides auto-sent cookies.
- Our design puts each token where its risk is lowest: **access token in memory** (short, header-sent,
  CSRF-immune) + **refresh token in an httpOnly, Secure, SameSite, path-scoped cookie** (XSS-safe).
- Cross-origin deployments adjust `SameSite`/CORS/CSRF accordingly (Phase 15/17).
- This completes the token model (Phases 7–8). Next build step: **Phase 9 — Authentication
  Middleware**, which verifies the access token to protect routes.

---

## Further reading

- MDN: Set-Cookie & SameSite — <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie>
- OWASP CSRF Prevention Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- OWASP XSS Prevention Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html>
