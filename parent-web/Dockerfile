# syntax=docker/dockerfile:1

# PCA Parent Web — production container.
#
# Mirrors platform-admin-web/Dockerfile's proven runtime shape (same
# unprivileged-nginx stage), but the build stage is genuinely different:
# parent-web depends on two LOCAL, file-protocol sibling packages
# (`@pca/parent-sdk-browser-runtime`/`@pca/parent-sdk-wellbeing-control`,
# declared in package.json as `file:../parent-sdk/...`) that must be built
# BEFORE `npm ci` in parent-web can resolve them -- exactly the two-step
# sequence `.github/workflows/quality-gates.yml`'s own
# "Build parent-sdk (parent-web's file-protocol dependencies)" CI step
# already performs. A single-directory build context (parent-web/ alone,
# the shape every other app's Dockerfile uses) cannot see the sibling
# parent-sdk/ directory at all, so THIS image's build context must be the
# REPOSITORY ROOT, built as:
#
#   docker build -f parent-web/Dockerfile -t pca-parent-web:local .
#   docker run --rm -p 8082:8080 pca-parent-web:local
#
# NOT DEPLOYED. Per docker-compose.yml's own topology comment, parent-web had
# no Dockerfile at all until this one; www.pcasafe.com/api.pcasafe.com/
# platform.pcasafe.com are each their own dedicated App Service and this image
# introduces no change to any of them. Deploying this image is a separate,
# not-yet-authorised action.

# ---------------------------------------------------------------------------
# Stage 1 — build parent-sdk's two sibling packages (mirrors the CI step)
# ---------------------------------------------------------------------------
FROM node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34 AS sdk-builder

WORKDIR /parent-sdk

COPY parent-sdk/browser-runtime/package.json parent-sdk/browser-runtime/package-lock.json ./browser-runtime/
RUN npm ci --prefix browser-runtime
COPY parent-sdk/browser-runtime/ ./browser-runtime/
RUN npm run build --prefix browser-runtime

COPY parent-sdk/wellbeing-control/package.json parent-sdk/wellbeing-control/package-lock.json ./wellbeing-control/
RUN npm ci --prefix wellbeing-control
COPY parent-sdk/wellbeing-control/ ./wellbeing-control/
RUN npm run build --prefix wellbeing-control

# ---------------------------------------------------------------------------
# Stage 2 — build parent-web itself
# ---------------------------------------------------------------------------
FROM node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34 AS builder

WORKDIR /app

COPY parent-web/package.json parent-web/package-lock.json ./
# Placed at /parent-sdk/{browser-runtime,wellbeing-control} so that
# package.json's `file:../parent-sdk/browser-runtime` (relative to /app)
# resolves to exactly this path -- npm ci below reads these directories
# directly, dist/ already built, so --ignore-scripts here is safe (no
# postinstall/prepare step is relied upon for either sibling package).
COPY --from=sdk-builder /parent-sdk/browser-runtime /parent-sdk/browser-runtime
COPY --from=sdk-builder /parent-sdk/wellbeing-control /parent-sdk/wellbeing-control
RUN npm ci --ignore-scripts

COPY parent-web/. .

# `npm run build` is `tsc --noEmit -p tsconfig.json && vite build`, so the type
# check gates the bundle. securityHeadersPlugin (vite/securityHeadersPlugin.ts)
# bakes the CSP/referrer <meta> tags into the built index.html at this step,
# reading VITE_PCA_API_BASE_URL from the build environment -- unset here
# deliberately (see below).
RUN npm run build

# PRODUCTION_DEMO_MODE_GATE -- proves no fixture-backed client made it into the
# built bundle and that it resolves to the real HTTP client. This is the exact
# gate parent-web's own dev-fixture mode exists to be checked by; running it
# here means an image can never be produced from a tree that quietly grew one.
RUN npm run gate:demo-mode

# No VITE_PCA_API_BASE_URL is set, deliberately -- src/config/env.ts falls back
# to a local-dev default only when the env var is absent; a real production
# build is expected to set this explicitly (or to the same-origin convention
# platform-admin-web's own build uses) at the CI/deploy step that actually
# produces a production image, not baked in here as a placeholder that could
# be forgotten.

# ---------------------------------------------------------------------------
# Stage 3 — serve
# ---------------------------------------------------------------------------
#   docker pull nginxinc/nginx-unprivileged:1.27-alpine && docker image inspect --format '{{index .RepoDigests 0}}' nginxinc/nginx-unprivileged:1.27-alpine
#
# The UNPRIVILEGED nginx image (matching platform-admin-web/backend/public-web):
# runs as uid 101 on port 8080, needs no privileged bind.
FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0 AS runtime

LABEL org.opencontainers.image.title="PCA Parent Web"
LABEL org.opencontainers.image.description="PCA Parent console — React/Vite SPA served by nginx"
LABEL org.opencontainers.image.vendor="PCA"
LABEL org.opencontainers.image.licenses="UNLICENSED"

USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY parent-web/nginx.conf /etc/nginx/conf.d/pca-parent-web.conf

# Clear the base image's own document root before copying, so its stock
# index.html/50x.html cannot survive underneath the app (COPY merges into an
# existing directory rather than replacing it).
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html

# Static files only; nothing is written at runtime.
RUN chmod -R a-w /usr/share/nginx/html

# Drop privileges BEFORE testing the config -- running `nginx -t` as root
# creates root-owned /tmp/nginx.pid and *_temp directories that persist into
# the image, which then fails at runtime under uid 101 with a permission
# error on container start (the exact failure platform-admin-web's own
# Dockerfile documents hitting first).
USER 101
RUN nginx -t

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
