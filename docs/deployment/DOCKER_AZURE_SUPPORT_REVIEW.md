# Docker and Azure Support — Review

Review of seven owner-provided, untracked Docker/Azure files. The goal was the
smallest correct deployment-support package, not preservation of every file.

**No production action was taken.** No image was pushed, no App Service changed, no
DNS, domain or certificate touched, no managed identity enabled, no credential
rotated, no migration run.

```
DOCKER_SUPPORT_FILES_REVIEWED             = 7
ACCEPT_AS_IS                              = 0
REVISED_AND_ACCEPTED                      = 3
RELOCATED_AND_ACCEPTED                    = 1
REJECTED_REDUNDANT                        = 2
REJECTED_UNSAFE                           = 1
DEFERRED                                  = 0

BACKEND_DOCKER_BUILD                      = PASS
PLATFORM_ADMIN_DOCKER_BUILD               = PASS (FAIL as supplied)
DOCKER_COMPOSE_CONFIG                     = PASS
LOCAL_CONTAINER_SMOKE                     = PASS (3/3 services healthy)
NEGATIVE_CONTROL_PROOFS                   = 7
BUILD_CONTEXT_SECRET_FINDINGS             = 2 (both closed)
FINAL_IMAGE_SECRET_FINDINGS               = 0
SUPPLY_CHAIN_CRITICAL_FINDINGS            = 0
SUPPLY_CHAIN_HIGH_FINDINGS                = 0
PUBLIC_DEPLOY_CONFIG_CONFLICTS            = 0
REPO_SOLVABLE_DOCKER_OPEN                 = 0
```

One correction to the brief up front: the seventh file was **not** a root `nginx.conf`.
It was `platform-admin-web/nginx.conf`, already scoped to the Platform Admin surface.
There was never a generic root nginx config, and no attempt to route `www`, `app`,
`parent`, `platform` and `api` through one production container. The previously
rejected all-hosts-one-container topology was not reintroduced.

---

## 1. Dispositions

| File | Original purpose | Decision | Final path |
|---|---|---|---|
| `.dockerignore` | root build-context exclusions | **REVISE_AND_ACCEPT** | `.dockerignore` |
| `Dockerfile.backend` | backend production image | **REJECT_REDUNDANT** | — (improvements folded into `backend/Dockerfile`) |
| `Dockerfile.platform-admin-web` | Platform Admin image | **RELOCATE_AND_ACCEPT** | `platform-admin-web/Dockerfile` |
| `platform-admin-web/nginx.conf` | Platform Admin nginx | **REVISE_AND_ACCEPT** | `platform-admin-web/nginx.conf` |
| `docker-compose.yml` | local orchestration | **REVISE_AND_ACCEPT** | `docker-compose.yml` |
| `azure-pipelines.yml` | Azure DevOps CI/CD | **REJECT_UNSAFE** | — removed |
| `DOCKER_AZURE_SETUP.md` | setup documentation | **REJECT_REDUNDANT** | — content corrected into §6 below |

---

## 2. `.dockerignore` — REVISE_AND_ACCEPT

**Original purpose.** A denylist of build-context exclusions at the repository root.

**Findings.** Measured rather than read, by building a probe image that copies the
whole context and lists it. What the denylist let through was not a tidiness problem:

| Finding | Detail |
|---|---|
| **`.agent-runtime/` included** | 88 git worktrees, **1,089,727 files**, **201 `.env*` files** including a real `parent-web/.env`. The pattern `.env` matches only the ROOT `.env`, so every nested one was in the context. |
| **`.env.azure` included** | Sits at the repository root with **six populated values including a database password**. `.env`, `.env.local` and `.env.*.local` all fail to match it — `.env.*.local` requires a `.local` suffix. It is gitignored, but gitignore has no bearing on what Docker sends to the daemon. |
| `.claude/`, `.vs/` included | local session and IDE state |
| `android/`, `ios/`, `parent-web/`, `contracts/`, `tooling/` included | megabytes no image needs |

**Decision.** Rewritten as an **allowlist**: `*`, then re-admit exactly what
`public-web/deploy/Dockerfile` reads. A denylist has to anticipate every one of the
above; an allowlist only has to name what the build reads, and anything added to the
repository later is excluded by default rather than included by default. For a context
sent whole to the daemon, default-deny is the only version that stays correct.

**Validation.** Context probed by inspection, not inference:

```
files in the root build context     59   (was ~1,090,000)
context transferred                515 KB
secret-shaped files in context       0
required build inputs present      5/5   (build.mjs, package.json, both register CSVs, nginx.conf)
public-web/src files present        39
public-web artifact-sha256    a623684b13e6fc018ca1a252b239f39d9b480f452630e3ede296e041ca709e46 (unchanged)
```

`NO_SECRET_FILE_IN_BUILD_CONTEXT = PASS`, `NO_REQUIRED_BUILD_INPUT_EXCLUDED = PASS`,
both proven by listing the context and by the Public artifact hashing identically
before and after.

**Security note.** `.env.azure` is an untracked, gitignored owner file and was **not**
deleted — it is not one of the seven and §25 forbids removing unrelated untracked
files. It is now excluded from the build context. It also declares `POSTGRES_*`
variables, which the backend has never read; see §5.

---

## 3. `Dockerfile.backend` — REJECT_REDUNDANT

**Original purpose.** A three-stage backend production image at the repository root.

**Finding.** `backend/Dockerfile` **already exists and is tracked**, with
`backend/.dockerignore` beside it, and carries reasoning about two real hazards: the
`NODE_ENV` placement (npm derives `omit=dev` from it, and `isProductionEnvironment()`
gates the session/CSRF cookies' `Secure` attribute on it, failing **open** when unset)
and the exec-form `CMD` (npm as PID 1 swallows SIGTERM, so `gracefulShutdown.ts` never
runs). A second backend Dockerfile at the root would have been a second authority for
a surface that already had one.

**But the owner's file was better in three measurable ways**, so it was not simply
discarded. Baseline of the tracked file as it stood:

| | tracked, before | after folding in the improvements |
|---|---|---|
| image size | 91 MB | **78 MB** |
| runs as | **root** | `pca`, uid 10001 |
| healthcheck | **none** | present, uses the app's own `/health` |
| typescript in runtime | **present** | absent |
| migrations in runtime | present | absent (nothing reads them at run time) |

**Two defects were found by running it that no amount of reading would have shown:**

1. **The backend bound loopback only.** `src/main.ts` defaults to
   `process.env.HOST ?? '127.0.0.1'` — right for a laptop, fatal in a container:
   `/proc/net/tcp` showed `0100007F:0FA1`, so **no published port could ever reach
   it**. Present in the tracked file and in the owner's file alike; neither set `HOST`.
2. **Docker reported `health=healthy` the whole time.** The HEALTHCHECK probes
   `127.0.0.1` *inside* the container, which succeeded against a service no client
   could reach. The green healthcheck is what nearly hid the defect.

`ENV HOST=0.0.0.0` now sets this in the layer that owns the network decision, leaving
the safe local-development default intact.

**Validation.**

```
docker build -t pca-backend:local backend        PASS
external GET /health                             200 {"service":"pca-backend","status":"ok"}
listening                                        00000000:0FA1  (0.0.0.0:4001)
docker stop                                      1s, exit code 0
shutdown log  shutdown.server_closed -> shutdown.database_pool_closed -> shutdown.exiting SIGTERM
```

The 1-second stop with a clean drain is also the first empirical confirmation of the
exec-form `CMD` reasoning: npm as PID 1 would have produced a 10-second wait and a
SIGKILL.

**Security notes.** No credential, secret or connection string is baked in. `NODE_ENV`
defaults to `production` in the image. Runs non-root, writes nothing at runtime
(verified: no `writeFile`, `createWriteStream` or `mkdir` outside tests). Migrations
are deliberately absent from the runtime image so a deploy cannot apply schema changes
on startup under concurrency.

---

## 4. `Dockerfile.platform-admin-web` — RELOCATE_AND_ACCEPT → `platform-admin-web/Dockerfile`

**Original purpose.** Two-stage React/Vite build served by nginx.

**Finding: as supplied, it could not build at all.**

```
vite.config.ts(3,39): error TS2307: Cannot find module './vite/securityHeadersPlugin'
```

The Dockerfile enumerated COPY paths and omitted `vite/`. `tsconfig.json`'s `include`
also lists `tests`, `e2e`, `e2e-real` and the playwright configs, so an enumerated list
has to track that array forever — and had already fallen out of step with it.

**Finding: as supplied, it could never have started either.** It ran stock nginx with
`USER appuser` on `listen 80`. A non-root process cannot bind a privileged port.

**Finding: the demo-mode gate was not run.** The repository has
`gate:demo-mode`, which proves no fixture-backed client has been introduced and that
the built bundle resolves to the real HTTP client. An image built without it can ship a
console wired to fixtures.

**Decision.** Relocated to `platform-admin-web/Dockerfile`, matching the existing
per-surface convention (`backend/Dockerfile`, `public-web/deploy/Dockerfile`), with its
own `.dockerignore`. Changes: copy the directory rather than an enumerated list;
`nginxinc/nginx-unprivileged` on 8080; run `gate:demo-mode` in the build; clear the
base image's document root before copying; both base images pinned by digest.

**A fourth defect appeared only on the first run of the fixed image:** `nginx -t`
executed as root created `/tmp/nginx.pid` owned by `root:root`, which persisted into
the image, so uid 101 hit `open() "/tmp/nginx.pid" failed (13: Permission denied)` and
the container exited immediately. The config test now runs **after** the privilege
drop, which also makes it stronger evidence — it proves the config is valid for the
identity that actually serves it.

**Authority boundary preserved.** No Parent Web source is copied into this image, no
shared session or token, no `/parent/admin`, no `isAdmin` bypass. Platform Admin
remains its own realm in its own container.

**Validation.**

```
docker build -t pca-platform-admin:local platform-admin-web   PASS
PRODUCTION_DEMO_MODE_GATE                                     PASS (inside the image)
nginx -t as uid 101                                           PASS
runs as                                                       uid=101(nginx)
GET /            200      GET /healthz      200
GET /.env        403      GET /x.map        403
GET /admin/x     200      (SPA fallback — intended for this surface)
.map files in image                                           0
stray base-image files in the document root                   0
absolute API origin baked into the bundle                     none
```

`http://localhost` does appear in the bundle; traced to react-router's internal
history fallback, not an API origin. `config/env.ts` defaults `apiBaseUrl` to `''`
(same-origin), which is the correct production shape and is left unset deliberately.

---

## 5. `platform-admin-web/nginx.conf` — REVISE_AND_ACCEPT

**Original purpose.** SPA routing and security headers for the Platform Admin console.

**Finding — HIGH, and the most consequential of the review.** The file set
`add_header Cache-Control ...` inside **both** the static-asset location and the
SPA-fallback location. In nginx, an `add_header` anywhere in a `location` block
**discards every `add_header` inherited from the server level**. Those two locations
serve every response the console returns, so `X-Frame-Options`,
`X-Content-Type-Options`, `X-XSS-Protection` and `Referrer-Policy` were being stripped
from all of them.

Measured, not argued — with the defect reintroduced deliberately:

```
security headers on /assets/index-*.js with the defect present:   0/5
security headers on /assets/index-*.js after the fix:             5/5
```

**Other findings.** No CSP at all. `X-XSS-Protection` present, which is deprecated,
ignored by current browsers, and whose legacy filter introduced vulnerabilities of its
own. No `server_tokens off`. No dotfile denial. No source-map denial.

**Decision.** Rewritten. No `location` sets an `add_header`; cache policy uses
`expires`, which does not reset inheritance. A CSP **derived from this app's needs**,
not copied from the Public site: `style-src` needs `'unsafe-inline'` because React
inserts styles at runtime, and `connect-src 'self'` because the console calls the API
same-origin. `Strict-Transport-Security` is deliberately **not** set here — it belongs
on the TLS terminator (Azure App Service), not on a container that only sees plain HTTP
behind a proxy.

**SPA fallback retained deliberately**, and it is the opposite of the Public decision:
this console is client-routed, so unknown paths must return the shell; the Public site
is prerendered, so a missing path there must 404 rather than soft-200. The consequence
— HTTP 200 for unknown paths on this host — is accepted because the console is
authenticated and unlinked, so there is no crawler cost.

**No conflict with Public.** `public-web/deploy/nginx.conf` remains the authoritative
Public Release A configuration and is untouched. `PUBLIC_DEPLOY_CONFIG_CONFLICTS = 0`.

---

## 6. `docker-compose.yml` — REVISE_AND_ACCEPT (LOCAL / DISPOSABLE / INTEGRATION ONLY)

**Original purpose.** Local orchestration of backend, Platform Admin and a database.

**Finding — the stack could not have worked.** The backend service was given
`POSTGRES_SERVER`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`. The backend
reads exactly one database variable, `PCA_DATABASE_URL` (`src/db/pool.ts`), and uses
`mysql2`. Four variables it has never read, next to a MySQL container.

**Other findings.** Volume mounts of `./backend/src` over an image that runs
`dist/main.js` — inert. Service named `db`, while
`scripts/bootstrap-e2e-parent-account.mjs` allowlists exactly `127.0.0.1`, `localhost`
and **`mysql`** as hostnames it will bootstrap against — a deliberate guard against
pointing local tooling at a real database, which the service name would have defeated.
Ad-hoc credentials rather than the repository's existing test values.

**Decision.** Rewritten and labelled `LOCAL DEVELOPMENT AND INTEGRATION ONLY` in its
first line, with the production topology stated alongside so it cannot be mistaken for
one. Correct `PCA_DATABASE_URL`; service renamed `mysql` to satisfy the bootstrap
guard; host port 33061 matching `README.md`'s existing convention; credentials are the
repository's existing `pca_test_only_not_a_secret` values, named so nobody mistakes
them for something to protect; named volume so `down -v` removes it entirely.
`NODE_ENV=development` is set **only here**, because over plain HTTP on localhost a
`Secure` cookie is never returned — the image's own default stays `production`.

**Public Web is deliberately absent.** It has its own build and verifier, needs no
database, and adding it would create a second way to run it that could drift from the
tested one.

**Validation.**

```
docker compose config                        PASS
docker compose up -d --build                 3/3 services healthy
backend  GET :4001/health                    200 {"service":"pca-backend","status":"ok"}
PA       GET :8081/healthz                   200
PA       security headers on /               6/6 present
mysql    mysqladmin ping                     mysqld is alive
backend -> mysql over the compose network    SELECT 1 -> {"ok":1}
```

**Not production architecture.** This MySQL is disposable, holds no real data, and
nothing here points at Azure.

---

## 7. `azure-pipelines.yml` — REJECT_UNSAFE

**Original purpose.** Azure DevOps CI/CD: build both images, push to ACR, deploy to Dev
and Prod Web Apps.

**Classification: `PRODUCTION_DEPLOYMENT`** — and that is why it was rejected.

| Finding | Severity |
|---|---|
| **Deploys production automatically on every push to `main`**, with no approval gate and no owner authorisation step. That directly bypasses `RELEASE_A_PUBLICATION_AUTHORIZED = NO`, OD-12 and OD-13. | **UNSAFE** |
| **No quality gates before push.** No tests, no build gates, no claim gates. It would publish whatever compiled. | UNSAFE |
| Staging stage keyed on branch `develop`, **which does not exist** (`main` and `pca-dev`). So the staging path was dead and only the production path could ever fire. | UNSAFE |
| Mutable image identity: tags `$(Build.BuildId)` and `latest`, not the commit SHA. "Which bytes are running?" would be unanswerable. | HIGH |
| Registry `pcaacr.azurecr.io` — the real one is `pcasafe.azurecr.io`. | HIGH |
| App names `pca-backend-dev`, `pca-web-prod` — none exist. The real apps are `pca` and `pcaSafe`. | HIGH |
| A **second CI authority** beside the repository's existing GitHub Actions quality gates. | HIGH |

**On the second-authority question specifically.** The repository already runs GitHub
Actions quality gates, which is where the build gates live. Nothing about hosting on
Azure requires Azure Pipelines — GitHub Actions can authenticate to ACR and deploy to
App Service perfectly well. Two pipelines that can independently deploy the same
surface is precisely the situation to avoid, and there is no need here that the
existing one cannot meet. **One CI authority: GitHub Actions.**

**Decision.** Removed. If Azure release integration is wanted later, the right shape is
a manually-triggered, SHA-tagged, gated release job — not an auto-deploy on merge.

---

## 8. `DOCKER_AZURE_SETUP.md` — REJECT_REDUNDANT

**Original purpose.** Setup and quick-start documentation.

**Findings.** Treated as operational code and validated against the repository and the
live Azure topology. It documented:

- **`.env.azure` as a deliverable** — a file that is gitignored and holds a populated
  database password; documenting it as part of the setup invites it into a repository;
- the **Azure DevOps pipeline** rejected in §7;
- ACR `pcaacr` and App Services `pca-backend-dev` / `pca-web-prod`, **none of which
  exist**;
- **`PORT=80`** for App Service — wrong for both surfaces: the backend defaults to 4001
  and the Platform Admin container runs unprivileged and cannot bind 80;
- `latest`-only image tags, contradicting immutable release identity;
- "images run as non-root (1000)" — the backend image used 1001, and the Platform Admin
  image could not start as a non-root user at all;
- the **old five-hostnames-one-App-Service assumption**, which is no longer current.

**Decision.** Removed rather than patched: after correcting all of the above there was
little of the original left, and its accurate content is the local-development flow,
which is now recorded in §9 and in the compose file's own header.

---

## 9. Local development — the corrected flow

```bash
# Everything, with a disposable MySQL
docker compose up -d --build
#   backend         http://127.0.0.1:4001/health
#   platform admin  http://127.0.0.1:8081/
#   mysql           127.0.0.1:33061   (disposable; down -v destroys it)
docker compose down -v

# Individual images
docker build -t pca-backend:local backend
docker build -t pca-platform-admin:local platform-admin-web
docker build -f public-web/deploy/Dockerfile -t pca-public:local .

# Public Web has its own verifier — 275 checks against a running container
docker run -d --rm --name pca-public-local -p 8099:80 pca-public:local
node public-web/deploy/verify-container.mjs http://127.0.0.1:8099

# Release identity before any push
node public-web/deploy/release-identity.mjs --image pca-public:local
```

**Image identity.** Every production-capable image uses `<image>:sha-<git-sha>` and its
digest is recorded after push. `latest` may exist only as an additional alias, never as
the deployment truth, and rollback always names the previous immutable image.

---

## 10. Cross-surface deployment matrix

| Surface | Source package | Dockerfile | Runtime | Port | Healthcheck | Azure target | Custom domain | Deployment status | Authority realm |
|---|---|---|---|---|---|---|---|---|---|
| Public Web | `public-web/` | `public-web/deploy/Dockerfile` | nginx 1.27-alpine | 80 | `/healthz` | `pcaSafe` | `www.pcasafe.com` | **NOT DEPLOYED** (placeholder live) | none — anonymous static |
| Backend API | `backend/` | `backend/Dockerfile` | Node 22 / Fastify | 4001 | `/health` | `pca` | `api.pcasafe.com` | **NOT DEPLOYED** (placeholder live) | serves Parent and Platform Admin realms separately |
| Platform Admin Web | `platform-admin-web/` | `platform-admin-web/Dockerfile` | nginx-unprivileged | 8080 | `/healthz` | `pca` | `platform.pcasafe.com` | **NOT DEPLOYED** (placeholder live) | **PA realm — separate session, never shared with Parent** |
| Parent Web | `parent-web/` | — | — | — | — | `pca` | `app` / `parent.pcasafe.com` | `PARENT_DOCKER = NOT_CURRENTLY_DEFINED` | Parent realm |
| Android | `android/` | — | — | — | — | — | — | `NOT_A_WEB_CONTAINER` | Child device |
| iOS | `ios/` | — | — | — | — | — | — | `NOT_A_WEB_CONTAINER` | Child device (later release) |

`PARENT_DOCKER = NOT_CURRENTLY_DEFINED` is recorded, not fixed. Parent Web has no
accepted Dockerfile and no approved deployment programme, and inventing one here would
create exactly the unreviewed second authority this review exists to prevent.

---

## 11. Supply chain

| Check | Result |
|---|---|
| Base image provenance | `node:22.16.0-bookworm-slim`, `nginx:1.27-alpine`, `nginxinc/nginx-unprivileged:1.27-alpine` — all official/upstream |
| Version pinning | exact version tags |
| Digest strategy | **pinned by digest** in `backend/Dockerfile` and `platform-admin-web/Dockerfile`; already pinned in `public-web/deploy/Dockerfile` |
| Build tools in runtime | none — multi-stage discards the toolchain; typescript absent from the backend runtime |
| Package caches | `npm cache clean --force` in the deps stage |
| Root vs non-root | backend uid 10001, Platform Admin uid 101, Public nginx workers uid 101 |
| Runtime writable paths | document roots `chmod a-w`; backend writes nothing |
| Healthcheck | all three images |
| Signals | backend runs node as PID 1; SIGTERM drains in 1s, exit 0 |
| Source maps | none emitted; also denied at the server |
| Secrets in final images | **0** — the only `.pem` files are the distribution CA trust store |
| Reproducibility | Public artifact hashes identically across builds; base digests pin the rest |

**Not claimed:** no SBOM was generated and no vulnerability scanner was run. No new
security tooling was installed for this lane, per the brief. Supply-chain closure is
claimed only for what was actually checked above.

---

## 12. Negative controls

Seven deliberate defects, each verified to have actually mutated the file, each caught,
each restored afterwards.

| # | Defect | Caught by |
|---|---|---|
| 1 | invalid nginx syntax in the PA config | `nginx -t` in the image build |
| 2 | required build input (`vite/`) excluded from the context | PA build fails TS2307 |
| 3 | wrong artifact COPY path in the backend image | container exits on start |
| 4 | invalid compose service dependency | `docker compose config` fails |
| 5 | required input removed from the root allowlist | Public build fails |
| 6 | **`add_header` reintroduced inside a location** | security headers on `/assets/` drop to **0/5** |
| 7 | `.env` and `.pem` dropped into the PA build context | context probe: 0 secret-shaped files reached it |

---

## 13. ACR authentication — current vs target

Documented factually, **not executed**.

**Current:** `pcaSafe` pulls using ACR **admin-user credentials**; no managed identity
is assigned; the registry has the admin user enabled and public network access enabled.

**Target:** system-assigned managed identity with least-privilege **`AcrPull`**, and the
admin user disabled **only after** a restart has proven a pull succeeds through the
identity. Full procedure, ordering, rollback and the two consequences that bite quietly
(disabling the admin user invalidates that credential pair everywhere, and removes
**push** access unless the publisher holds `AcrPush`) are in
`docs/public/reports/RELEASE_A_INFRA_FOLLOWUPS.md` §B.

Nothing in this package presents ACR admin credentials as the recommended permanent
architecture.

```
ACR_IDENTITY_HARDENING = OWNER_AUTHORIZATION_REQUIRED
```

---

## 14. Status

```
REPO_SOLVABLE_DOCKER_OPEN            = 0
AZURE_CHANGES_BY_THIS_LANE           = 0
DNS_CHANGES_BY_THIS_LANE             = 0
CERTIFICATE_CHANGES_BY_THIS_LANE     = 0
PRODUCTION_DEPLOYMENTS_BY_THIS_LANE  = 0

PCA_PUBLIC_RELEASE_A_DEPLOYED        = NO
RELEASE_A_PUBLICATION_AUTHORIZED     = NO
```

Public Release A is unaffected by this lane. Its source, artifact, container and
verifier are unchanged, its artifact still hashes to
`a623684b13e6fc018ca1a252b239f39d9b480f452630e3ede296e041ca709e46`, and every remaining
publication blocker — OD-12, OD-13, reply identity, apex DNS, ACR identity, and the
publication decision itself — is still owner-side and still open.
