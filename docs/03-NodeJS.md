# 03 — Node.js

> The runtime our server actually runs on. To reason about performance, async code, and graceful
> shutdown later, you need a correct mental model of what Node *is*.

---

## Definition

**Node.js** is a runtime that lets you run JavaScript **outside the browser** — on a server, a
laptop, a container. It bundles Google's **V8** engine (the same one in Chrome, which compiles JS to
machine code) with a library of **system APIs** (files, network, timers, processes) that the browser
never exposes for security reasons.

So: browser JS can pop an alert but can't open a TCP socket; Node JS can open a socket but has no
`window`. Same language, different capabilities.

---

## History (why it exists)

Before 2009, servers were typically **thread-per-request**: each connection got its own OS thread,
and a thread blocked while waiting on I/O (a database read, a disk write). Thousands of concurrent
connections meant thousands of mostly-idle, memory-hungry threads.

**Ryan Dahl** released Node.js in 2009 with a different bet: **one thread, non-blocking I/O, an event
loop.** Instead of blocking a thread while waiting for the database, Node registers a callback and
goes to serve other requests; when the data is ready, the callback runs. For **I/O-bound** workloads
— which is exactly what an auth server is (mostly waiting on the DB, hashing, sending email) — this
is dramatically more efficient.

---

## How it works internally: the event loop

```
        ┌───────────────────────────┐
        │   Your JavaScript (1 thread)│   ← runs your code, synchronously
        └─────────────┬─────────────┘
                      │ "start this DB query, call me back when done"
                      ▼
        ┌───────────────────────────┐
        │        libuv / OS          │   ← does the slow I/O in the background
        │  (thread pool + kernel)    │      (NOT on your JS thread)
        └─────────────┬─────────────┘
                      │ "done — here's the result"
                      ▼
        ┌───────────────────────────┐
        │        EVENT LOOP          │   ← picks finished callbacks and runs
        │  (queues of ready callbacks)│      them on the single JS thread
        └───────────────────────────┘
```

Key consequences you must internalize:

- **Your JavaScript runs on ONE thread.** Two requests never run your handler code *simultaneously*.
- **I/O is offloaded**, so waiting doesn't block that thread — Node serves other requests meanwhile.
- **CPU-heavy work blocks everything.** If you do a huge synchronous loop (or a very slow hash) on
  the main thread, *every* pending request stalls. This is why `bcrypt`'s async API matters (Phase 5)
  and why you never do heavy crypto synchronously in a request.

---

## Node concepts we used in Phase 2

- **`process`** — a global object representing the running Node process. We used:
  - `process.uptime()` — seconds since the process started (in `/health`).
  - `process.on("SIGTERM" | "SIGINT", ...)` — react to OS shutdown signals.
  - `process.exit(code)` — end the process (`0` = success, non-zero = failure). CI and orchestrators
    read this exit code.
  - `process.on("uncaughtException" | "unhandledRejection", ...)` — last-resort crash guards.
- **Signals (`SIGTERM`, `SIGINT`)** — messages the OS sends a process. `SIGINT` is Ctrl+C; `SIGTERM`
  is what Render/Docker/Kubernetes send to ask a process to stop. Catching them enables **graceful
  shutdown** (finish in-flight requests, close DB connections, then exit).
- **`node:http` `Server`** — `app.listen()` returns one; we keep the reference to `close()` it later.
- **CommonJS vs ESM** — Node supports two module systems. We use **CommonJS** (`"type": "commonjs"`)
  with TypeScript's `NodeNext` resolution, so `import`/`export` in our `.ts` compiles to `require`.

> **Platform note (Windows vs Linux):** POSIX signals like `SIGTERM` are delivered reliably on
> Linux/macOS (and therefore on Render and in Docker, which is where it counts). On **Windows local
> dev**, signal emulation is partial — a hard `taskkill`/`kill` often bypasses your handler. Don't be
> surprised if graceful-shutdown logs don't appear locally on Windows; they will in production.

---

## Common mistakes

- **Blocking the event loop** with synchronous CPU work (big loops, sync crypto, `JSON.parse` on huge
  payloads). It freezes the whole server.
- **Not handling `unhandledRejection`.** An un-awaited promise that rejects can crash or silently
  swallow errors.
- **Exiting with code 0 on failure.** Orchestrators think the process succeeded and may not restart it.
- **Assuming multi-threading.** Your handler code is single-threaded; shared in-memory state is a
  race-condition and scaling trap (it doesn't survive multiple instances).

---

## Best practices

- Prefer **async I/O** everywhere; keep the main thread free.
- Always wire **graceful shutdown** and **crash guards** (we did both in `server.ts`).
- Treat the process as **disposable**: no important state in memory that you can't rebuild (this is
  why refresh tokens live in Postgres, not a `Map`).
- Pin a Node **LTS** version (we target Node 20+, running 22 LTS) for stability.

---

## Interview questions

1. **Is Node single- or multi-threaded?** Your JS runs on one thread; I/O is offloaded to libuv's
   thread pool / the kernel. CPU-bound work blocks that single thread.
2. **What is the event loop?** The mechanism that picks up completed-I/O callbacks and runs them on
   the JS thread, enabling non-blocking concurrency.
3. **Why is Node good for I/O-bound APIs but not CPU-bound work?** Non-blocking I/O scales to many
   idle-waiting connections cheaply; heavy CPU work has nowhere to go and stalls the loop.
4. **What is graceful shutdown and why does it matter?** Stop accepting new connections, finish
   in-flight ones, release resources, then exit — avoids dropped requests and leaked connections on
   deploy.
5. **`SIGTERM` vs `SIGINT`?** `SIGINT` = Ctrl+C (interactive); `SIGTERM` = polite "please stop" from
   an orchestrator.

---

## Summary

- Node = **V8 + system APIs**, single-threaded JS with an **event loop** and **offloaded I/O**.
- Perfect for an **I/O-bound** auth server; keep CPU-heavy work off the main thread.
- We used `process` signals and `http.Server.close()` to build **graceful shutdown** and crash guards.
- Windows may not deliver catchable signals locally; Linux/Render does — that's what matters.
- Next: **[04 — HTTP](04-HTTP.md)**, the protocol every request speaks.

---

## Further reading

- Node.js "Event Loop, Timers, and nextTick" — <https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick>
- Node.js `process` docs — <https://nodejs.org/api/process.html>
