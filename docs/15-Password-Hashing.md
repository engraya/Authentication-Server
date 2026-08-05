# 15 — Password Hashing

> Why we never store passwords, and the principles that make stored credentials safe: hashing (not
> encryption), salting, peppering, defeating rainbow tables and timing attacks, and modern password
> policy. bcrypt specifics live in [14 — Bcrypt](14-Bcrypt.md); this chapter is the theory around it.

---

## The golden rule: never store the password

If your database is stolen — and databases *do* get stolen — every stored password is compromised the
instant it's readable. Users reuse passwords across sites, so a leak of your plaintext passwords
becomes a breach of their email, bank, and everything else. Therefore: **store something derived from
the password that lets you VERIFY a login but can never be turned back into the password.** That
"something" is a **hash**.

```
   register:  password ──hash──►  "$2b$12$…"  stored in DB   (one-way)
   login:     attempt  ──hash+compare──►  match? yes/no      (never un-hash)
```

We only ever compare hashes. The plaintext exists for a few milliseconds during a request and is never
persisted or logged.

---

## Hashing vs encryption vs encoding (a critical distinction)

- **Encoding** (Base64, URL-encoding) — reversible, no secret. **Not security.** Anyone can decode it.
- **Encryption** — reversible *with a key*. Right for data you must read back (e.g. a stored OAuth
  token). **Wrong for passwords:** if you can decrypt it, so can an attacker who steals the key — and
  you never need to read a password back, only check it.
- **Hashing** — **one-way**. No key, no inverse. Right for passwords. You verify by hashing the
  attempt and comparing.

> Interview trap: "How do you decrypt the password to check it at login?" **You don't.** You hash the
> attempt and compare hashes. If a system can email you your *old* password, it stored it reversibly —
> a red flag.

But a plain fast hash (MD5, SHA-256) is **not enough** for passwords, for two reasons that salting and
work factors solve.

---

## Problem 1: identical passwords → identical hashes → rainbow tables

A plain hash is deterministic: `sha256("password123")` is always the same. Attackers precompute huge
tables mapping common passwords → their hashes (**rainbow tables**) and simply look up stolen hashes.
Two users with the same password also get the same hash — visibly.

### Solution: SALT

A **salt** is a unique random value added to each password before hashing and stored alongside the
hash. Now the same password yields a *different* hash for every user, and precomputed tables are
useless (they'd need to be rebuilt per-salt).

```
  user A: hash(salt_A + "password123")  = X   ┐ same password,
  user B: hash(salt_B + "password123")  = Y   ┘ different hashes
```

bcrypt **generates and embeds the salt automatically** inside its output string (docs 14), so you
don't manage a separate salt column. Our test proved it: hashing the same password twice gave two
different `$2b$12$…` strings.

---

## Problem 2: fast hashes are too fast

Modern GPUs compute *billions* of SHA-256 hashes per second. Even salted, an attacker can brute-force
weak passwords quickly because each guess is cheap.

### Solution: a slow, ADAPTIVE hash (work factor)

Password hashes are deliberately **slow** and **tunable**. bcrypt's **cost factor** sets how much CPU
each hash costs; every +1 roughly **doubles** the work. You pick a cost that's trivial for one login
but ruinously expensive across billions of guesses — and raise it as hardware improves. This is why we
use **bcrypt**, not SHA-256, and why we *measured* the cost on real hardware (docs 14).

---

## Peppering (defense in depth, optional)

A **pepper** is a secret added to every password before hashing, stored **outside** the database
(e.g. in an env var / secrets manager / HSM), unlike the salt which is stored with the hash. If only
the DB leaks (but not the app secret), peppered hashes remain hard to crack.

We do **not** implement a pepper yet (**YAGNI** for this project), but you should know it exists: it's
a common production hardening. A simple form is an HMAC of the password with a secret key before
bcrypt; the tradeoff is key-rotation complexity.

---

## Timing attacks & constant-time comparison

Comparing the *hash* isn't done with `===`. A naive string compare returns faster when the first
characters differ, leaking — via response time — how much matched. bcrypt's `compare` runs in
**constant time**, so an attacker learns nothing from timing. (More broadly, use constant-time
comparison for any secret, e.g. token comparison in later phases.)

Related: we return the **same** error for "unknown email" and "wrong password" (a generic *invalid
credentials* — Phase 6), so response *content* doesn't reveal which accounts exist (**user
enumeration**).

---

## Password policy: what actually helps (NIST 800-63B)

Modern guidance (NIST) overturned old "complexity" dogma:

- **Length beats complexity.** Enforce a reasonable **minimum length** (we use 8; 12+ is better for
  high-value systems). Allow long passwords and spaces; encourage passphrases.
- **Don't** impose forced composition rules (must have symbol/number/uppercase) — they push users to
  predictable patterns (`Password1!`).
- **Don't** force periodic rotation without cause — it leads to weaker, incremental passwords.
- **Do** screen against **known-breached passwords** (e.g. Have I Been Pwned's k-anonymity API) and
  common-password lists. (Not built here — a good exercise; call it in the service before hashing.)
- Support **MFA** for real accounts (out of scope here, referenced in docs 07).

Our validator (docs 21) enforces length bounds (min 8, max 72 — the max matches bcrypt's byte limit,
docs 14); breach-list screening is a documented future enhancement.

---

## Upgrading hashes over time (rehash on login)

Security is a moving target: today's good cost factor is tomorrow's weak one. When a user logs in you
briefly hold their plaintext — the one moment you can **transparently upgrade** their stored hash.
`passwordNeedsRehash(hash)` (in `src/utils/password.ts`) checks whether a stored hash's cost is below
the current requirement; if so, the login flow re-hashes and saves the stronger value. Users are
upgraded silently, never prompted to reset. We wire this into login in **Phase 6**.

---

## Common mistakes

- **Storing plaintext**, or encrypting (reversible) instead of hashing.
- **Using a fast hash** (MD5/SHA-1/SHA-256) for passwords — no work factor, GPU-crackable.
- **No salt**, or a shared/global salt — rainbow tables win.
- **Rolling your own** hashing scheme — use a vetted algorithm (bcrypt/argon2/scrypt).
- **`===` on secrets** — timing leaks; use constant-time compare.
- **Different errors** for bad-email vs bad-password — enables user enumeration.
- **Logging the password** (or the full request body) — it must never hit logs.
- **Complexity rules & forced rotation** — modern guidance says prefer length + breach screening.

---

## Best practices

- **Hash, never store/encrypt** passwords; verify by comparing hashes.
- Use a **salted, adaptive** algorithm (bcrypt here; argon2id if available) with a **measured** work
  factor, tunable via config.
- **Constant-time** comparison; **generic** auth errors.
- Enforce **length** over complexity; screen against **breach lists**; offer MFA for real systems.
- Support **transparent rehash** to raise the work factor over time.
- Keep the plaintext's lifetime minimal; never log it.

---

## Interview questions

1. **Why hash instead of encrypt passwords?** Hashing is one-way; you never need to read a password
   back, and there's no key to steal.
2. **What is a salt and what attack does it stop?** A unique per-user random value; defeats rainbow
   tables and hides identical passwords.
3. **Salt vs pepper?** Salt is per-user and stored with the hash; pepper is a global secret stored
   outside the DB.
4. **Why not SHA-256 for passwords?** It's fast → GPU-brute-forceable and has no tunable work factor.
5. **What's a timing attack and how do you prevent it here?** Leaking match info via comparison time;
   prevented by constant-time compare (bcrypt.compare).
6. **How do you upgrade password security without resetting users?** Rehash on login when the stored
   cost is below the current requirement.
7. **What does modern (NIST) password policy recommend?** Length over complexity, no forced rotation,
   screen against breached passwords, allow long passphrases.

---

## Summary

- **Never store passwords** — store a **one-way hash**; verify by comparing hashes.
- **Hashing ≠ encryption ≠ encoding**; only hashing is right for passwords.
- **Salt** defeats rainbow tables and hides duplicates (bcrypt embeds it); a **slow adaptive** hash
  with a **work factor** defeats brute force.
- Use **constant-time** comparison and **generic** errors; prefer **length + breach screening** over
  complexity rules; support **rehash-on-login** upgrades.
- Algorithm specifics → **[14 — Bcrypt](14-Bcrypt.md)**. Next build step: **Phase 6 — Login**, where
  we verify credentials and apply the rehash-on-login upgrade.

---

## Further reading

- OWASP Password Storage Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- NIST SP 800-63B (Digital Identity Guidelines) — <https://pages.nist.gov/800-63-3/sp800-63b.html>
- Have I Been Pwned — Pwned Passwords (k-anonymity) — <https://haveibeenpwned.com/API/v3#PwnedPasswords>
