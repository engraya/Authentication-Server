# 08 — Authorization

> Once we know *who* a user is (authentication), authorization decides *what they may do*. We
> implement it fully in Phase 10; this chapter builds the mental model now so the architecture is
> ready for it.

---

## Definition

**Authorization (authZ)** answers: **"What are you allowed to do?"** It is the enforcement of a
**policy** deciding whether an authenticated **principal** may perform an **action** on a **resource**.

```
   authentication              authorization
  ┌───────────────┐          ┌──────────────────────────┐
  │ "Who are you?"│  ──►      │ "May THIS user do THIS   │
  │  → user #42   │          │  action on THIS resource?"│
  └───────────────┘          └──────────────────────────┘
        401 if unknown              403 if not permitted
```

You **always authenticate first**. Authorization operates on an already-known identity.

---

## 401 vs 403 (the distinction the whole chapter hangs on)

- **401 Unauthorized** — *authentication* failed/absent. "I don't know who you are." (Missing or
  invalid token.)
- **403 Forbidden** — *authorization* failed. "I know exactly who you are, and you still can't do
  this." (Valid token, insufficient rights.)

Getting these backwards is a classic bug and an interview favorite. Our error classes encode it:
`UnauthorizedError → 401`, `ForbiddenError → 403` (see `src/errors/index.ts`).

---

## Models of authorization

### RBAC — Role-Based Access Control (what we build)

Users have **roles** (`USER`, `ADMIN`); permissions attach to roles.

```
USER  ─► can read/update OWN profile
ADMIN ─► can read/update/delete ANY user
```

Simple, ubiquitous, and enough for this project. We'll add a `role` field to the user in Phase 10 and
an `authorize(...roles)` middleware that runs *after* authentication.

### Other models (context, not built)

- **ABAC** (Attribute-Based) — decisions from attributes (department, time, IP). More granular,
  more complex.
- **ReBAC** (Relationship-Based) — "can edit *because they own it* / are in the same org" (Google
  Zanzibar style).
- **Ownership checks** — a special, extremely common case: "you may edit resource X **only if you own
  it**." Even a plain `USER` editing *their own* profile is an ownership decision. We add an
  ownership guard in Phase 10.

---

## Where authorization lives in the request pipeline

Authorization is **middleware** (docs 06/18), inserted between authentication and the route handler:

```
request
  │
  ▼  express.json, logger
  ▼  authenticate      → verifies token, sets req.user      (401 on failure)
  ▼  authorize("ADMIN")→ checks req.user.role               (403 on failure)
  ▼  route handler     → runs only if BOTH passed
```

This ordering is not optional: you cannot check a role before you know the user. The pipeline model
from Phase 2 is exactly what makes layering these guards clean.

---

## Common mistakes

- **Swapping 401 and 403.** See above.
- **Authorizing on the client.** Hiding an "admin" button in the UI is UX, not security. The
  **server** must enforce every rule; the client can be modified freely by an attacker.
- **Trusting a role from the request body.** The role must come from a **verified** source (the DB /
  the validated token), never from user-supplied JSON.
- **"Broken access control"** — OWASP's #1 web risk: forgetting an ownership check so user A can read
  user B's data by changing an id in the URL. Always verify ownership on resource access.
- **Scattering checks** across controllers inconsistently. Centralize in middleware so no route is
  accidentally left unguarded.

---

## Best practices

- **Deny by default.** A route is protected unless explicitly made public.
- Enforce **on the server**, in **middleware**, consistently.
- Keep roles/permissions in a **trusted store**; derive them from the authenticated identity.
- Use **401 for authN failures, 403 for authZ failures** — precisely.
- Add **ownership checks** wherever a user acts on a specific resource.

---

## Interview questions

1. **AuthZ vs authN?** Permission vs identity; authorize after authenticate.
2. **401 vs 403 — precise difference?** Not-authenticated vs authenticated-but-forbidden.
3. **What is RBAC and when is it enough?** Permissions via roles; sufficient for most apps with a
   small, stable set of roles.
4. **Why must authorization be enforced server-side?** The client is fully controllable by the user;
   only the server is trustworthy.
5. **What is "broken access control" / an ownership check?** Failing to verify a user may act on a
   specific resource (e.g. IDOR — changing an id to access another's data).

---

## Summary

- **AuthZ = "what may you do"**, enforced as a policy over an authenticated identity.
- **401 = not authenticated; 403 = not permitted** — our error classes encode this.
- We'll use **RBAC + ownership checks**, implemented as **middleware after authentication** (Phase 10).
- Enforce **server-side, deny-by-default, consistently**.
- Next: **[22 — Error Handling](22-Error-Handling.md)** — the machinery that turns these decisions
  into correct HTTP responses.

---

## Further reading

- OWASP "Broken Access Control" (A01:2021) — <https://owasp.org/Top10/A01_2021-Broken_Access_Control/>
- OWASP Authorization Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>
