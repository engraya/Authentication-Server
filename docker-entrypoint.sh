#!/bin/sh
# ─────────────────────────────────────────────────────────────────────
# Container entrypoint: apply pending DB migrations, then start the app.
#
# `prisma migrate deploy` ONLY applies migrations that already exist in
# prisma/migrations — it never generates, prompts, or resets. It's the SAFE
# production command, and idempotent: with nothing pending it's a no-op.
#
# `set -e` aborts (and fails the container start) if migrations fail, so we
# never boot an app against a schema it doesn't expect.
#
# `exec` REPLACES this shell with node, so node becomes PID 1 and receives
# SIGTERM directly — which our graceful shutdown (server.ts) depends on.
# ─────────────────────────────────────────────────────────────────────
set -e

echo "→ Applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

echo "→ Starting server..."
exec node dist/server.js
