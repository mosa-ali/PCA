# syntax=docker/dockerfile:1

# PCA Backend — production container.
#
#   docker build -t pca-backend:local backend
#   docker run --rm -p 4001:4001 -e PCA_DATABASE_URL=... pca-backend:local
#
# NOT DEPLOYED. api.pcasafe.com currently serves a placeholder from the `pca`
# App Service, and no deployment of this image is authorised.

# ---------------------------------------------------------------------------
# Stage 1 — production dependencies only
# ---------------------------------------------------------------------------
# Pinned by digest so two builds of the same commit produce the same bytes.
#   docker pull node:22.16.0-bookworm-slim && docker image inspect --format '{{index .RepoDigests 0}}' node:22.16.0-bookworm-slim
FROM node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34 AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 2 — compile
# ---------------------------------------------------------------------------
FROM node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34 AS builder

WORKDIR /app
COPY package.json package-lock.json ./

# NODE_ENV is deliberately NOT set in this stage. npm derives its own `omit=dev`
# config from NODE_ENV, so setting it here would strip typescript and @types
# from the install and break the compile below. In the single-stage version of
# this file that hazard had to be managed by ordering; separating the stages
# removes it structurally, and the runtime stage sets NODE_ENV where it belongs.
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34 AS runtime

LABEL org.opencontainers.image.title="PCA Backend"
LABEL org.opencontainers.image.description="PCA backend API — Node 22, Fastify, MySQL"
LABEL org.opencontainers.image.vendor="PCA"
LABEL org.opencontainers.image.licenses="UNLICENSED"

WORKDIR /app

# This is a security-relevant default, not a cosmetic one. The image runs
# `node dist/main.js` with whatever NODE_ENV the container inherits, and
# parentaccount/cookies.ts's isProductionEnvironment() gates the session and CSRF
# cookies' `Secure` attribute on exactly this value -- an unset NODE_ENV there
# fails OPEN (cookies served without `Secure`), unlike every other NODE_ENV gate
# in this codebase. An operator may still override it at `docker run` time; the
# image's own default must be the safe one.
ENV NODE_ENV=production

# The application's own default is 4001 (src/main.ts). The image keeps that
# rather than inventing a different one, so a container and a local `npm start`
# behave identically. Azure App Service should set WEBSITES_PORT=4001, or PORT
# may be overridden at run time.
ENV PORT=4001

# src/main.ts defaults to `process.env.HOST ?? '127.0.0.1'`, which is the right
# default for a developer's machine and fatal in a container: bound to loopback,
# the process is unreachable from outside its own network namespace, so every
# published port answers nothing.
#
# It is invisible from the outside, too. Docker's HEALTHCHECK probes 127.0.0.1
# INSIDE the container, so it reported `health=healthy` on an image no client
# could reach -- which is how this was nearly missed. Setting HOST here fixes it
# in the layer that owns the network decision, without changing a safe default
# for local development.
ENV HOST=0.0.0.0

# Non-root. The process reads its configuration from the environment and writes
# nothing to the filesystem at runtime -- verified: no writeFile, no
# createWriteStream, no mkdir outside tests -- so it needs no writable path and
# no elevated identity.
RUN useradd --create-home --uid 10001 --user-group pca

COPY --from=deps --chown=pca:pca /app/node_modules ./node_modules
COPY --from=builder --chown=pca:pca /app/dist ./dist
COPY --chown=pca:pca package.json ./

# migrations/ and scripts/ are deliberately NOT copied into the runtime image.
# Nothing under src/ reads them at run time (the only references are comments
# citing a migration file), and shipping the migration runner inside the serving
# container is how a deploy ends up applying schema changes on startup under
# concurrency. Migrations stay an explicit, separate operation.

USER pca

# Uses the app's own /health route (src/server.ts). Node rather than curl/wget,
# because neither is installed in the slim image and adding one to support a
# healthcheck would enlarge the runtime attack surface for no other purpose.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

EXPOSE 4001

# Exec form invoking node DIRECTLY, not `npm run start`. With npm in front, npm
# is PID 1 and node is its child: PID 1 receives the orchestrator's SIGTERM and
# does not forward it, so src/runtime/gracefulShutdown.ts never runs and every
# deploy ends in a SIGKILL mid-request/mid-transaction after the termination
# grace period expires. Running node as PID 1 delivers the signal to the process
# that can actually drain the server and release the MySQL pool. Equivalent to
# package.json's "start" script by construction -- keep the two in step.
CMD ["node", "dist/main.js"]
