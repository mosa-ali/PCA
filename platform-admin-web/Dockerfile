# syntax=docker/dockerfile:1

# PCA Platform Admin Web — production container.
#
# Build context is platform-admin-web/, matching backend/Dockerfile. The owner's
# original root-context version could not build at all: vite.config.ts imports
# ./vite/securityHeadersPlugin, and the Dockerfile enumerated COPY paths that
# omitted vite/ entirely, so `npm run build` failed with TS2307. tsconfig.json's
# `include` also lists tests, e2e, e2e-real and the playwright configs, so an
# enumerated COPY list has to track that array forever. Copying the directory
# with a .dockerignore beside it is the version that stays correct.
#
#   docker build -t pca-platform-admin:local platform-admin-web
#   docker run --rm -p 8081:8080 pca-platform-admin:local
#
# NOT DEPLOYED. platform.pcasafe.com currently serves a placeholder from the
# `pca` App Service, and no deployment of this image is authorised.

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
# Pinned by digest so two builds of the same commit produce the same bytes.
#   docker pull node:22.16.0-bookworm-slim && docker image inspect --format '{{index .RepoDigests 0}}' node:22.16.0-bookworm-slim
FROM node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

# `npm run build` is `tsc --noEmit -p tsconfig.json && vite build`, so the type
# check gates the bundle.
RUN npm run build

# PRODUCTION_DEMO_MODE_GATE. parent-web has a build-time demo/fixture toggle;
# this app deliberately has none, and the gate proves that no alternate
# fixture-backed client has been introduced and that the built bundle resolves
# to the real HTTP client. Running it here means an image cannot be produced
# from a tree that has quietly grown one.
RUN npm run gate:demo-mode

# No VITE_PCA_PLATFORM_ADMIN_API_BASE_URL is set, deliberately. src/config/env.ts
# defaults apiBaseUrl to '' , which makes every request same-origin -- the
# correct production shape behind a reverse proxy. Baking an absolute origin into
# the bundle would freeze the API host at image-build time.

# ---------------------------------------------------------------------------
# Stage 2 — serve
# ---------------------------------------------------------------------------
#   docker pull nginxinc/nginx-unprivileged:1.27-alpine && docker image inspect --format '{{index .RepoDigests 0}}' nginxinc/nginx-unprivileged:1.27-alpine
#
# The UNPRIVILEGED nginx image, not the stock one. The owner's original version
# ran stock nginx with `USER appuser` on `listen 80`; a non-root process cannot
# bind a privileged port, so that container could never have started. This image
# is built to run as uid 101 on port 8080 and needs no privileged bind.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="PCA Platform Admin Web"
LABEL org.opencontainers.image.description="PCA Platform Admin console — React/Vite SPA served by nginx"
LABEL org.opencontainers.image.vendor="PCA"
LABEL org.opencontainers.image.licenses="UNLICENSED"

USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/pca-platform-admin.conf

# Clear the base image's own document root before copying, so its stock
# index.html and 50x.html cannot survive underneath the app. COPY merges into an
# existing directory rather than replacing it -- the identical mistake shipped a
# stock /50x.html at HTTP 200 in the Public image.
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html

# Static files only; nothing is written at runtime.
RUN chmod -R a-w /usr/share/nginx/html

# Drop privileges BEFORE testing the config, deliberately. Running `nginx -t` as
# root creates /tmp/nginx.pid and the *_temp directories owned by root:root, and
# they persist into the image -- so at runtime uid 101 hits
# `open() "/tmp/nginx.pid" failed (13: Permission denied)` and the container
# exits immediately. That is exactly what happened on the first build of this
# image, and no amount of reading the Dockerfile would have shown it.
#
# Testing as the runtime user also makes the check stronger: it proves the
# config is valid for the identity that will actually serve it.
USER 101
RUN nginx -t

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
