# syntax=docker/dockerfile:1
# ============================================================================
# Multi-stage Dockerfile for the Authentication Server (Phase 17 / docs 27).
#
#   Stage 1 (builder): install ALL deps, generate the Prisma client, compile TS.
#   Stage 2 (runner) : a lean image with only what's needed to RUN the app.
#
# Multi-stage keeps the build toolchain (TypeScript compiler, etc.) OUT of the
# shipped image — smaller image, smaller attack surface.
# ============================================================================

# ---- Stage 1: build ------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app

# Prisma's query engine needs OpenSSL present to generate and to run.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests FIRST and install. Because this layer only changes when the
# manifests change, Docker caches the (slow) install and skips it on source-only
# edits — a big build-speed win. `npm ci` installs EXACTLY the lockfile.
COPY package.json package-lock.json ./
RUN npm ci

# Now the source, then build: `npm run build` = `prisma generate && tsc`, which
# emits the generated client into node_modules and the compiled JS into dist/.
COPY . .
RUN npm run build

# ---- Stage 2: runtime ----------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app

# Production mode drives config decisions (Secure cookies, terse logging) and
# is read by our fail-fast config at boot.
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy only the runtime essentials from the builder stage:
#   node_modules – prod deps + generated Prisma client + prisma CLI (migrations)
#   dist         – compiled JavaScript (what we actually run)
#   prisma       – schema + migrations (needed by `prisma migrate deploy`)
#   package.json – for `npm run` scripts + metadata
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Drop root: run as the unprivileged `node` user the base image already ships.
# A container process that doesn't need root shouldn't have it.
USER node

# Documentation only. The app listens on config.app.port; hosts like Render
# inject PORT and our config reads it.
EXPOSE 5000

# Apply pending migrations, then exec the server (see docker-entrypoint.sh).
ENTRYPOINT ["./docker-entrypoint.sh"]
