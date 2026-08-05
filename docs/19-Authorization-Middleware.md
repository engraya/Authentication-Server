# 19 — Authorization Middleware

> The enforcement layer for [08 — Authorization](08-Authorization.md). This chapter covers the
> `authorize(...roles)` and `authorizeSelfOrAdmin(...)` middleware: role checks, ownership checks, why
> the role lives in the token, and the all-important 401-vs-403 distinction — in working code.

---

## Where it sits

Authorization runs **after** authentication (docs 18): you must know *who* the caller is before you
can decide *what they may do*. The chain reads left to right:

```
router.get("/admin/users", authenticate, authorize("ADMIN"), controller.listUsers)
                              │              │                  │
                     sets req.user     checks req.user.role   runs only if both pass
                     (401 if no token) (403 if wrong role)
```

If `authenticate` rejects, `authorize` never runs; if `authorize` rejects, the handler never runs.
This is the middleware pipeline (docs 06) used as layered security.

---

## Role-based: `authorize(...roles)` (`src/middlewares/authorize.ts`)

A **higher-order** middleware — call it with the allowed roles, it returns a guard:

```ts
export function authorize(...allowedRoles: Role[]) {
  return (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError("Authentication required"); // 401
    if (!allowedRoles.includes(req.user.role))
      throw new ForbiddenError("You do not have permission..."); // 403
    next();
  };
}
```

Same factory pattern as `validate(schema)` (docs 21). `Role` is the Prisma-generated union
(`"USER" | "ADMIN"`), so `authorize("MANGER")` is a **compile error** — typos can't create a
permanently-open route.

---

## Ownership: `authorizeSelfOrAdmin(paramName)`

Roles aren't enough. "A user may read **their own** profile" is an **ownership** rule: allowed if the
caller *is* the target, or is an admin.

```ts
export function authorizeSelfOrAdmin(paramName = "id") {
  return (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError(...);            // 401
    const isSelf  = req.params[paramName] === req.user.id;
    const isAdmin = req.user.role === "ADMIN";
    if (!isSelf && !isAdmin) throw new ForbiddenError(...);     // 403
    next();
  };
}
```

This directly defends against **IDOR / broken access control** (OWASP A01, docs 08): without it, user
A could read user B's data just by changing the id in `/users/:id`. We verified both branches: a USER
reading their own id → 200, reading another's → 403, and an ADMIN reading anyone → 200.

> Ownership often can't be fully generic, because "owns" depends on the resource (a post's `authorId`,
> an order's `userId`, …). This helper covers the common "the route param *is* the owning user id"
> case; richer ownership is checked in the service with the loaded resource.

---

## Why the role travels IN the token

`authorize` reads `req.user.role`, which came from the **access token's `role` claim** (set by
`authenticate`). We deliberately put the role in the JWT so authorization needs **no database
lookup** — it stays as fast and stateless as authentication (docs 09).

**The tradeoff (know this for interviews):** a token is a ~15-minute snapshot. If you *demote* a user
(ADMIN → USER), their existing access token still says ADMIN until it expires. Mitigations:

- **Short access-token TTL** (ours is 15m) bounds the stale window — usually acceptable.
- For instant effect, **revoke their refresh token** (they can't renew) and/or check a
  server-side flag on sensitive actions.
- The alternative — **look up the role from the DB every request** — is always fresh but adds a query
  to every protected call. We chose the stateless token + short TTL; the "verify against DB" option is
  a valid design for high-sensitivity systems.

We saw this concretely: after promoting a user to ADMIN, they had to **log in again** to get a token
carrying the new role.

---

## 401 vs 403 (the distinction this middleware makes concrete)

- **401 Unauthorized** — *not authenticated*: no/invalid token. Comes from `authenticate` (or the
  defensive `!req.user` guard). "I don't know who you are."
- **403 Forbidden** — *authenticated but not permitted*: valid token, insufficient role/ownership.
  Comes from `authorize`. "I know who you are, and you still can't."

Verified: an unauthenticated call to `/admin/users` → **401**; a normal USER's call → **403**. Mixing
these up is a classic bug and a guaranteed interview question.

---

## Common mistakes

- **Swapping 401 and 403** — unauthenticated is 401; forbidden is 403.
- **`authorize` before `authenticate`** — `req.user` is undefined → everything 401s (or crashes).
  Order the chain correctly.
- **Authorizing on the client only** — hiding an admin button is UX, not security; the **server** must
  enforce every rule.
- **Trusting a role from the request body** — the role must come from the verified token/DB, never
  client input.
- **Forgetting ownership checks** — role checks alone still allow IDOR on per-user resources.
- **Assuming instant role changes** — a token's role is a snapshot; demotions lag until expiry/revoke.

---

## Best practices

- **Deny by default**; add `authenticate` (+ `authorize`/ownership) explicitly to protected routes.
- Keep authorization in **middleware**, consistently; derive role from the **verified token**.
- Use **401 for unauthenticated, 403 for forbidden** — precisely.
- Add **ownership checks** wherever a user acts on a specific resource.
- Bound the **role-staleness** window with a short access TTL (+ refresh revocation for instant
  effect).

---

## Interview questions

1. **Difference between authentication and authorization middleware?** One verifies identity (sets
   `req.user`, 401); the other checks permission (role/ownership, 403). Authn runs first.
2. **Why put the role in the JWT, and what's the downside?** Stateless authorization (no DB lookup);
   downside is staleness — role changes lag until the token expires (mitigate with short TTL/revoke).
3. **401 vs 403 — exactly?** Not authenticated vs authenticated-but-forbidden.
4. **What is an ownership check and which attack does it stop?** Verifying the caller owns the resource
   (or is admin); stops IDOR / broken access control.
5. **Why is `authorize` a higher-order function?** So one factory produces guards parameterized by the
   allowed roles, reused across routes.
6. **Why must authorization be server-side?** The client is fully controllable by the user; only the
   server is trustworthy.

---

## Summary

- `authorize(...roles)` (role) and `authorizeSelfOrAdmin(...)` (ownership) enforce access **after**
  `authenticate`, throwing **403** for insufficient rights vs **401** for unauthenticated.
- The **role rides in the access token**, keeping authorization stateless — traded against a short
  staleness window (bounded by TTL/revocation).
- Ownership checks stop **IDOR**; roles are typed via the Prisma `Role` union so invalid roles can't
  compile.
- This completes the core auth model (Phases 4–10). Next up in the build: **Phase 11 — Email
  Verification**.

---

## Further reading

- OWASP A01: Broken Access Control — <https://owasp.org/Top10/A01_2021-Broken_Access_Control/>
- OWASP Authorization Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>
