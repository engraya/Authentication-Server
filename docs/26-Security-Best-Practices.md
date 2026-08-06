# 26 — Security Hardening (Helmet, Rate Limiting, CORS)

> The auth *logic* has been secure since Phase 5 (hashing), Phase 8 (token rotation), Phase 10
> (authorization). This chapter hardens the **transport and edge**: the HTTP headers every response
> carries, how fast a client may hammer us, and which browser origins may talk to us at all. These are
> defenses that apply to *every* route, added in one place.

---

## The three layers we add

| Concern | Attack it blunts | Tool | Where wired |
|---|---|---|---|
| Missing security headers | clickjacking, MIME sniffing, protocol downgrade | **helmet** | `app.use(helmet())` first |
| Unlimited requests | brute force, credential stuffing, mail/DB flooding | **express-rate-limit** | global on `/api` + strict on auth routes |
| Any origin can call us | cross-site request abuse, token/cookie theft via a rogue SPA | **cors** | `app.use(cors(...))` with an allowlist |

All three are **defense in depth** — none replaces the app-level defenses (hashing, generic errors,
token rotation). They reduce the *attack surface* the real logic sits behind.

---

## 1. Helmet — secure response headers

`helmet()` sets ~12 protective HTTP headers with safe defaults. The ones that matter most here:

| Header | What it does |
|---|---|
| `X-Content-Type-Options: nosniff` | stops the browser guessing (and mis-executing) a response's MIME type |
| `X-Frame-Options: SAMEORIGIN` | your pages can't be embedded in a hostile `<iframe>` → **clickjacking** defense |
| `Strict-Transport-Security` (HSTS) | after the first HTTPS visit, the browser refuses plain HTTP → blocks downgrade/MITM |
| `Content-Security-Policy` | restricts where scripts/styles/images may load from → limits **XSS** blast radius |
| `Referrer-Policy: no-referrer` | don't leak the current URL (which may hold tokens) to other sites |

It's one line, applied **before** everything so *every* response — including errors — is covered:

```ts
app.use(helmet());
```

> **API vs. web-app note.** Helmet's default CSP is tuned for a server that renders HTML. For a
> pure JSON API consumed only by a separate SPA, the CSP is largely moot (there's no HTML to inject
> into) but harmless. If this server ever serves a UI, revisit the CSP deliberately rather than
> loosening it reflexively.

---

## 2. Rate limiting — cap requests per client

Without a cap, `/login` accepts unlimited password guesses and `/forgot-password` sends unlimited
emails. A limiter counts requests **per client IP** in a rolling **window**; past the cap → **429**.

We use two tiers ([src/middlewares/rateLimit.ts](../src/middlewares/rateLimit.ts)):

- **`apiLimiter`** — broad, on the whole `/api` surface. Stops scrapers/runaways; generous enough that
  a real user never notices (default 100 / 15 min).
- **`authLimiter`** — strict, on the sensitive endpoints (`register`, `login`, `verify-email`,
  `forgot-password`, `reset-password`, `resend-verification`). A real user needs a handful of
  attempts; more is almost certainly automation (default 10 / 15 min).

```ts
export const authLimiter = rateLimit({
  windowMs: config.security.rateLimit.windowMs,
  limit: config.security.rateLimit.authMax,
  standardHeaders: "draft-7",   // send RateLimit-* headers so clients can back off
  legacyHeaders: false,         // drop the deprecated X-RateLimit-* headers
  handler: (_req, _res, next) => next(new TooManyRequestsError(...)), // ← our envelope
});
```

### The key integration: one error shape

The `handler` doesn't write its own 429 body — it calls `next(new TooManyRequestsError())`, so the
rejection flows through our **single global error handler** (docs 22) and comes out in the *same*
`ApiError` envelope as every other error. Verified:

```json
{ "success": false, "error": { "name": "TooManyRequestsError", "message": "Too many attempts. Please try again later." } }
```

### Ordering matters

`authLimiter` runs **first** in each route chain — *before* `validate`, the DB, or the mailer — so a
throttled request is rejected as cheaply as possible:

```ts
authRouter.post("/login", authLimiter, validate(loginSchema), authController.login);
```

### Two production caveats (called out, not hidden)

- **In-memory store.** The default store counts *per process*. Behind multiple instances / a load
  balancer, each has its own count, so the effective limit multiplies. Real deployments swap in a
  **shared store** (e.g. `rate-limit-redis`) so the limit is global.
- **Client IP behind a proxy.** On a platform like Render, the real client IP arrives in
  `X-Forwarded-For`; `req.ip` is the *proxy* unless you set `trust proxy`. We enable it for **exactly
  one hop** in production (see below) so the limiter keys on the real client — and does so *narrowly*,
  because trusting the whole chain would let anyone spoof `X-Forwarded-For` to dodge the limit.

```ts
if (config.isProduction) app.set("trust proxy", 1);
```

---

## 3. CORS — who may call this API from a browser

**Same-Origin Policy**: by default, a browser blocks JavaScript on `https://app.com` from reading a
response from `https://api.com` (a different origin). **CORS** is how the *server* opts specific
origins back in, via `Access-Control-Allow-*` response headers. CORS is enforced by the **browser**,
not the server — it protects *users*, not the API (curl/mobile ignore it).

Our config uses an **allowlist** ([src/app.ts](../src/app.ts)):

```ts
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || config.cors.origins.includes(origin)) return callback(null, true);
    return callback(null, false); // not allowlisted → no CORS headers; browser blocks
  },
  credentials: config.cors.credentials, // true → browser may send our refresh cookie
};
```

Verified: an allowlisted `Origin` is echoed in `Access-Control-Allow-Origin`; a stranger origin gets
no such header (the browser then blocks it); the preflight `OPTIONS` returns `204` with the
credential + method headers.

### Why `credentials: true` forbids the `*` wildcard

The refresh cookie is only sent cross-origin if `Access-Control-Allow-Credentials: true`. Browsers
**forbid** combining that with `Access-Control-Allow-Origin: *` — you must name an explicit origin.
Hence an allowlist, never a wildcard. This ties back to docs 13:

### The cross-site cookie chain (ties to docs 13)

For the refresh cookie to survive a **cross-site** SPA (different registrable domain), three things
must line up together:

1. **Server CORS:** the SPA's origin allowlisted + `credentials: true` (this chapter).
2. **Client fetch:** `fetch(url, { credentials: "include" })` so the browser attaches the cookie.
3. **Cookie attributes:** `SameSite=None; Secure` (docs 13) — `None` to be sent cross-site, `Secure`
   because browsers require it for `SameSite=None`. Our default is `SameSite=Lax`, which is correct
   for a **same-site** frontend; switch to `None` **only** when the frontend is genuinely cross-site,
   and know that it widens CSRF exposure (which is partly why the cookie is `httpOnly` + path-scoped).

---

## The hardened pipeline (order is deliberate)

```
trust proxy (prod only)        ← so req.ip / HTTPS are seen correctly
  ▼ helmet()                    ← security headers on EVERY response, incl. errors
  ▼ cors(allowlist)             ← reject/allow browser origins; answer preflights early
  ▼ express.json({limit:10kb})  ← body-size cap (a DoS defense we've had since Phase 2)
  ▼ cookieParser()
  ▼ request logger
  ▼ apiLimiter → /api routes    ← broad limiter; per-route authLimiter inside
  ▼ notFound → errorHandler
```

Security middleware sits at the **top**: a request that helmet/CORS/rate-limit rejects should never
reach routing, the DB, or the mailer.

---

## Config & env (Phase 15 additions)

```
CORS_ORIGIN="https://app.example.com,https://admin.example.com"  # comma-separated allowlist
RATE_LIMIT_WINDOW_MS=900000   # 15 min
RATE_LIMIT_MAX=100            # global cap / IP / window
AUTH_RATE_LIMIT_MAX=10        # strict cap on sensitive routes
```

All optional with sensible defaults (`CORS_ORIGIN` defaults to the local dev origins). Parsed in
[src/config/index.ts](../src/config/index.ts) — the allowlist via a new `readList` (comma-split,
trimmed) helper.

---

## Common mistakes

- **Wildcard CORS with credentials** — forbidden by browsers, and if it *did* work it would let any
  site ride the user's cookie. Always an explicit allowlist.
- **Rate limiter after validation/DB** — you still pay the expensive work before rejecting. Put it
  **first**.
- **`trust proxy = true` (trust everything)** behind a proxy — lets clients spoof `X-Forwarded-For`
  to reset their own IP and evade the limiter. Trust a **specific** number of hops.
- **In-memory limiter on multiple instances** — the limit silently multiplies by the instance count.
- **A bespoke 429 body** — bypasses your error envelope; route it through the global handler instead.
- **Assuming CORS protects the API** — it protects *browsers*. Server-side auth (tokens, roles) is
  what actually guards data.
- **Loosening helmet's CSP reflexively** to make something work — understand what you're opening.

---

## Best practices

- Apply `helmet()` and `cors(allowlist)` **before** routes; keep the body-size cap.
- Two-tier rate limiting: broad on everything, strict on auth/mail endpoints; run the limiter first.
- Route limiter rejections through the **global error handler** for one consistent shape.
- Drive the allowlist and limits from **config/env**, not hard-coded values.
- Set `trust proxy` **narrowly** in production; use a **shared store** for limits at scale.
- Match cookie `SameSite`/`Secure` to your same-site vs. cross-site frontend (docs 13).

---

## Interview questions

1. **What does helmet do, and why apply it first?** Sets protective response headers (nosniff,
   frame-options, HSTS, CSP…) on every response — placed first so even errors carry them.
2. **How does rate limiting defend `/login`?** Caps attempts per IP per window → 429, turning
   unlimited brute force into a handful of tries.
3. **Why can't you use `Access-Control-Allow-Origin: *` with credentials?** Browsers forbid the
   combination; sending cookies cross-origin requires naming an explicit origin.
4. **Does CORS secure your API?** No — it's browser-enforced and protects users. Server-side authz
   secures the data; curl/mobile ignore CORS entirely.
5. **Why does rate limiting need `trust proxy` behind a load balancer, and why not trust the whole
   chain?** So `req.ip` is the real client, not the proxy — but trusting the whole chain lets clients
   spoof their IP via `X-Forwarded-For` and evade the limit.
6. **What breaks a refresh cookie for a cross-site SPA, and how do you fix it?** `SameSite=Lax`
   blocks it cross-site; you need `SameSite=None; Secure` + `credentials: true` + an allowlisted
   origin + `fetch(..., {credentials:"include"})`.

---

## Summary

- **helmet** hardens response headers; **express-rate-limit** caps requests (broad + strict tiers,
  429 through our envelope); **cors** gates browser origins via an allowlist with credentials.
- Security middleware runs **first**; the limiter runs **before** validation/DB/mail.
- Production notes made explicit: **shared store** for limits, narrow **`trust proxy`**, and the
  `SameSite=None; Secure` requirement for cross-site cookies.
- All verified live: helmet headers present, CORS allow/deny + preflight correct, 3 attempts then
  429 with `RateLimit-*` headers and the standard error body.
- Next: **Phase 16 — Testing** (Vitest unit + Supertest integration).

---

## Further reading

- Helmet — <https://helmetjs.github.io/>
- express-rate-limit — <https://express-rate-limit.mintlify.app/>
- OWASP CORS / Same-Origin — <https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS>
- OWASP API Security Top 10 — <https://owasp.org/API-Security/>
