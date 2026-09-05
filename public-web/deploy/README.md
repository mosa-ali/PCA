# PCA Public — Release A deployment artifact

**Nothing here has been deployed, and deploying it is not authorised.**

`www.pcasafe.com` is already bound to the dedicated Public Web App, so pushing this
image would change the live public website the moment it starts. Publication requires
owner + primary-ChatGPT authorisation, and several non-engineering blockers are still
open (native Arabic review, legal identity, contact-channel delivery). See
`docs/public/reports/RELEASE_A_PREDEPLOY_REPORT.md`.

---

## Contents

| File | Purpose |
|---|---|
| `Dockerfile` | Two-stage build: run every gate, then serve the result from nginx |
| `nginx.conf` | The real HTTP response headers a `<meta>` tag cannot deliver |
| `manifest.mjs` | SHA-256 of every shipped byte, written outside the deploy root |
| `verify-container.mjs` | Asserts a **running** container serves the reviewed artifact correctly |

---

## Build, run, verify

The build context is the **repository root**, because `build.mjs` cross-checks the
claim register against both the living CSV and the frozen v0.2 package under
`docs/public/`. A container that could not see them would have to skip the claim
gate, and that is the one gate that must never be optional.

```bash
docker build -f public-web/deploy/Dockerfile -t pca-public:local .
docker run -d --rm --name pca-public-local -p 8099:80 pca-public:local
node public-web/deploy/verify-container.mjs http://127.0.0.1:8099
docker rm -f pca-public-local
```

`docker build` is not just packaging. It runs the full gate suite inside the image —
content parity, contrast, the claim-register cross-check, the 20 self-tested forbidden
patterns, the CSP derivation, the internal-metadata sweep — then asserts that the
deploy root holds exactly the manifest's files and that each one matches its checksum,
then runs `nginx -t`. A gate failure produces no image.

Last local run: **271/271 checks passed**, `LOCAL_RELEASE_A_CONTAINER = PASS`.

### What the verifier is for

`nginx` silently discards **every inherited `add_header`** in any `location` block
that declares one of its own. A configuration that looks correct can therefore serve a
fully protected home page and a naked 404. The only way to know is to ask a running
server, on every path, including the error pages. That failure mode is one of the four
this verifier was proven against:

| Deliberate defect | Caught |
|---|---|
| a `location` block declares its own `add_header` | 8 headers missing on `/assets/` |
| `always` dropped from the CSP | header absent on the 404 |
| SPA history fallback added | missing paths soft-200 as the home page |
| `absolute_redirect on` | container's internal address leaked into `Location` |

A fifth defect was found by the verifier's own gap rather than by design: the nginx
base image ships `index.html` and `50x.html` in the document root, and `COPY` **merges
into** that directory instead of replacing it. The first build of this image served a
stock English `/50x.html` at HTTP 200 — an unreviewed page in the deploy root, absent
from the manifest — and every HTTP-level check passed, because nothing thinks to
request a file it does not know exists. The document root is now cleared before the
copy, the file count is asserted against the manifest at build time, and the verifier
probes for the leftover explicitly.

---

## Response headers

Sent on every response, including 4xx (`always`), verified against the running
container:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
                         img-src 'self'; base-uri 'self'; form-action 'none';
                         frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

The CSP is **derived from the artifact**, not copied from another app: one same-origin
stylesheet, one same-origin script, same-origin SVG images, nothing else. Everything
unused inherits `default-src 'none'`. `assertCspCoversArtifact()` in `build.mjs` fails
the build if a source is granted that nothing uses, or used that nothing grants.

`Cross-Origin-Embedder-Policy` is deliberately absent: it buys cross-origin isolation,
which only matters for `SharedArrayBuffer` and high-resolution timers, and this site
uses neither.

### Caching

Asset filenames are **not** content-hashed (`assets/pca-public.css`, not
`pca-public.<hash>.css`), so assets are cached for one hour and HTML is always
revalidated. A long immutable TTL would strand visitors on a stale stylesheet after a
deploy, and HTML carries privacy claims that must be correctable immediately. Hashed
filenames are the right fix and are not a Release A requirement.

---

## When deployment IS authorised

Recorded so the steps are reviewed before they are run, not invented under pressure.

**Target (verified read-only, 2026-09-05):**

| | |
|---|---|
| Web App | `pcaSafe` — Linux, container, Running, HTTPS Only, UAE North |
| Resource group | `pca-group` |
| Plan | `PcAPlan` — B1 Basic, 1 site (not shared) |
| Custom domain | `www.pcasafe.com`, `SniEnabled` |
| Current image | `pcasafe.azurecr.io/pca-public-placeholder:hold-v1` (placeholder) |
| Container port | 80 — matches this image's `EXPOSE 80` |
| Registry auth | ACR **admin user credentials**, no managed identity assigned |

**Before deploying**

1. Record the current sitecontainer image reference, port and app settings for
   `pcaSafe` (read-only), and save them next to the predeploy report. That record *is*
   the rollback target.
2. Build the image from a specific commit SHA and note `artifact-sha256` from the
   manifest.
3. Push to `pcasafe.azurecr.io` with an **immutable, dated tag** — never `latest`.
   A moving tag makes "which bytes are live?" unanswerable.
4. Run `verify-container.mjs` against the local container built from that exact SHA.

**After deploying**

5. Re-run the verifier against the live origin:
   `node public-web/deploy/verify-container.mjs https://www.pcasafe.com`
6. Confirm the running container's `/etc/pca/MANIFEST.sha256` rollup equals the
   `artifact-sha256` recorded in step 2.
7. Confirm the other four hostnames are untouched: `app`, `parent`, `platform` and
   `api.pcasafe.com` are bound to the separate `pca` App Service and must still serve
   exactly what they served before.

**Recommended App Service settings, none of which this session changed**

| Setting | Now | Should be | Why |
|---|---|---|---|
| `healthCheckPath` | `null` | `/healthz` | This image provides it; without it Azure cannot tell a wedged container from a healthy one |
| `alwaysOn` | `false` | `true` | Otherwise the first visitor after ~20 minutes idle pays a cold start |
| `http20Enabled` | `false` | `true` | Free latency improvement for a multi-asset page |
| ACR auth | admin user | **managed identity** | Admin credentials sit in site config and are shared by anything that has them; a managed identity is scoped, rotatable and revocable |
| Image reference | tag | tag **and** recorded digest | A tag can be moved after review |

---

## Rollback

The current state is the safest possible baseline: **PCA has never been deployed**, so
the first Release A deploy has a clean, known rollback target.

1. **Roll back = redeploy the recorded prior image** (`pca-public-placeholder:hold-v1`
   at the digest recorded in step 1 above). Because it is a placeholder, the baseline
   is always recoverable.
2. **Blast radius is one hostname.** `www.pcasafe.com` is the only binding on
   `pcaSafe`; the other four surfaces live on a separate App Service and are unaffected
   by any Public deploy or rollback.
3. **Artifact rollback needs no stored artifact.** The build is deterministic from a
   commit SHA with no install step, so any previous Release A image is reproducible by
   checking out that SHA and rebuilding. Confirm by comparing `artifact-sha256`.
4. **DNS and certificates are never part of a rollback.** The binding and its SNI
   certificate are independent of container content. Do not touch them to fix a
   content problem.
5. **After any rollback**, re-run the verifier against the live origin and confirm the
   four other hostnames still serve what they served before.

---

## Not in scope for this image

- No deployment pipeline. Publishing is a deliberate, authorised, manual act until the
  blockers close.
- No apex `pcasafe.com`. It has no A, AAAA or CNAME record, so visitors typing the bare
  domain reach nothing. Adding the record and the apex→www redirect is a DNS change and
  was not made.
- No `/.well-known/security.txt`. It should exist before launch, and it must not be
  published until `security@pcasafe.com` is proven to receive external mail.
