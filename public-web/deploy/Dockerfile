# syntax=docker/dockerfile:1

# PCA Public — Release A production container.
#
# Build context is the REPOSITORY ROOT, because build.mjs cross-checks the
# claim register against both the living CSV and the frozen v0.2 package, and
# both live under docs/public/. A container that could not see them would have
# to skip the claim gate, which is the one gate that must never be optional.
#
#   docker build -f public-web/deploy/Dockerfile -t pca-public:local .
#   docker run --rm -p 8080:80 pca-public:local
#   node public-web/deploy/verify-container.mjs http://127.0.0.1:8080
#
# NOT DEPLOYED. Release A publication is not authorised, and www.pcasafe.com is
# already bound to the dedicated Public Web App -- pushing this image would
# change the live public website immediately.

# ---------------------------------------------------------------------------
# Stage 1 — build the artifact, with every gate running
# ---------------------------------------------------------------------------
# Pinned by digest, not just by tag. A tag is a moving pointer: `22.16.0-slim`
# can be rebuilt upstream, and then two builds of the same commit produce
# different bytes -- which destroys the artifact-sha256 comparison that proves
# the reviewed image is the deployed one. Update deliberately:
#   docker pull node:22.16.0-bookworm-slim && docker image inspect --format '{{index .RepoDigests 0}}' node:22.16.0-bookworm-slim
FROM node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34 AS build

WORKDIR /src

# No package manager step of any kind: this package has zero dependencies and no
# lockfile. There is nothing to `npm ci`, nothing to audit, and no supply chain
# beyond the base image itself.
COPY public-web/ ./public-web/
COPY docs/public/PCA_PUBLIC_CLAIM_REGISTER.csv ./docs/public/PCA_PUBLIC_CLAIM_REGISTER.csv
COPY docs/public/PCA_Public_Programme_Documentation_Package_v0.2/PCA_PUBLIC_CLAIM_REGISTER.csv \
     ./docs/public/PCA_Public_Programme_Documentation_Package_v0.2/PCA_PUBLIC_CLAIM_REGISTER.csv

WORKDIR /src/public-web

# The build IS the gate run: content parity, contrast, the claim register
# cross-check, the 20 self-tested forbidden patterns, the CSP derivation, the
# internal-metadata sweep. If any of them fails, no image is produced.
RUN node --check build.mjs && node build.mjs

# PUBLIC-14 found build-report.json shipping at the deploy root with the whole
# internal claim-governance state in it. Reports now write to reports/, outside
# dist/ -- this asserts that at image-build time so the defect cannot return
# through a future change to where a report is written.
RUN set -eu; \
    for f in build-report.json release-a-evidence.json; do \
      if [ -e "dist/$f" ]; then echo "FATAL: $f is in the deploy root" >&2; exit 1; fi; \
    done; \
    if [ -n "$(find dist -name '*.map' -o -name '.env*' -o -name '*.mjs' | head -1)" ]; then \
      echo "FATAL: source or secret-shaped file in the deploy root" >&2; exit 1; \
    fi

# Checksum manifest for the shipped bytes, written OUTSIDE dist so it is
# auditable without being served.
RUN node deploy/manifest.mjs /artifact/MANIFEST.sha256

# ---------------------------------------------------------------------------
# Stage 2 — serve
# ---------------------------------------------------------------------------
# Pinned by digest for the same reason. This one also ships in the released
# image, so an unpinned tag would mean the running container's provenance
# depends on when it happened to be built.
#   docker pull nginx:1.27-alpine && docker image inspect --format '{{index .RepoDigests 0}}' nginx:1.27-alpine
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS runtime

LABEL org.opencontainers.image.title="PCA Public"
LABEL org.opencontainers.image.description="PCA Public Release A — prerendered bilingual EN/AR static site"
LABEL org.opencontainers.image.vendor="PCA"
LABEL org.opencontainers.image.licenses="UNLICENSED"

RUN rm /etc/nginx/conf.d/default.conf
COPY public-web/deploy/nginx.conf /etc/nginx/conf.d/pca-public.conf

# The base image ships its own index.html and 50x.html in the document root.
# COPY merges into that directory rather than replacing it, so without this the
# stock 50x.html survives and is served at /50x.html: an unreviewed,
# English-only page in the deploy root that is absent from the manifest. Caught
# by listing the running container's document root -- the HTTP-level checks all
# passed, because nothing thinks to request a file it does not know exists.
RUN rm -rf /usr/share/nginx/html/*

COPY --from=build /src/public-web/dist /usr/share/nginx/html
COPY --from=build /artifact/MANIFEST.sha256 /etc/pca/MANIFEST.sha256

# The deploy root must contain the manifest's files and nothing else. This is
# the assertion that would have caught 50x.html on the first build.
RUN set -eu; \
    expected="$(grep -c '^[0-9a-f]\{64\}  ' /etc/pca/MANIFEST.sha256)"; \
    actual="$(find /usr/share/nginx/html -type f | wc -l)"; \
    if [ "$expected" != "$actual" ]; then \
      echo "FATAL: deploy root holds $actual file(s), manifest describes $expected" >&2; \
      find /usr/share/nginx/html -type f >&2; \
      exit 1; \
    fi; \
    grep -v '^#' /etc/pca/MANIFEST.sha256 > /tmp/manifest.check; \
    cd /usr/share/nginx/html && sha256sum -c /tmp/manifest.check > /dev/null && rm /tmp/manifest.check

# Fail the image build rather than the deploy if the config is malformed.
RUN nginx -t

# Static files only: nothing is written at runtime, so the served tree is
# read-only to the worker processes.
RUN chmod -R a-w /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1/healthz || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
