# Release A — Infrastructure Follow-ups

```
APEX_REDIRECT_PLAN     = COMPLETE
APEX_DOMAIN_REDIRECT   = NOT_CONFIGURED

ACR_IDENTITY_HARDENING_PLAN = COMPLETE
ACR_IDENTITY_HARDENING      = OWNER_AUTHORIZATION_REQUIRED
```

**Nothing in this document has been executed.** No DNS record was created or changed,
no registry authentication was altered, no Azure resource was modified. These are
plans, written out in full so the steps are reviewed before they are run rather than
invented under pressure on the day.

---

## A. Apex domain redirect — `pcasafe.com` → `www.pcasafe.com`

### A.1 What was measured

`pcasafe.com` has **no A, AAAA or CNAME record**. A lookup returns only SOA and NS, on
Squarespace nameservers (`nsd1`/`nsd2`/`nsd4.squarespacedns.com`). Every `www` and
subdomain record exists and resolves; the bare domain does not.

A visitor typing `pcasafe.com` — which is what people type, and what gets printed on
anything physical — reaches nothing. Not a redirect, not an error page: a DNS failure,
which browsers present as "site can't be reached".

### A.2 Target behaviour

```
https://pcasafe.com/            → 301 → https://www.pcasafe.com/
https://pcasafe.com/ar/privacy/ → 301 → https://www.pcasafe.com/ar/privacy/
https://pcasafe.com/x?y=1       → 301 → https://www.pcasafe.com/x?y=1
http://pcasafe.com/…            → 301 → https://pcasafe.com/… → https://www.pcasafe.com/…
```

Permanent, path- and query-preserving, to the canonical `www` host.

**Direction is not a preference.** All 14 pages already emit
`<link rel="canonical" href="https://www.pcasafe.com/…">`, both `hreflang` alternates
and `og:url` against `www`. Redirecting `www` → apex instead would contradict the
artifact's own canonical tags on every page.

### A.3 Ordering — this is the part that matters

Each step must be verified before the next. Done out of order, the visible failure is
worse than today's clean DNS failure.

| # | Step | Why the order |
|---|---|---|
| 1 | Add the Azure domain-verification `TXT` record for the apex (`asuid.pcasafe.com`). | Azure refuses the binding without it. Costs nothing, breaks nothing, and can be done well ahead. |
| 2 | Add the apex address record. **CNAME is invalid at a zone apex**, so use an ALIAS/ANAME to the App Service default hostname if Squarespace DNS supports it, otherwise `A` → the App Service inbound IP (plus `AAAA` if one is published). | An `A` record pins an IP that changes if the App Service is ever recreated; an ALIAS follows the hostname. Prefer ALIAS. |
| 3 | Bind `pcasafe.com` as a custom domain on `pcaSafe`. | Must follow 1 and 2. |
| 4 | Issue and bind a certificate **for the apex**. | Measured: the current managed certificate is `CN=www.pcasafe.com` and its SAN covers `www.pcasafe.com` **only**. Between steps 2 and 4 the apex resolves but has no valid certificate, so `https://pcasafe.com/` fails with a TLS name mismatch — a full-page browser security warning, which looks like an attack and is worse than not resolving. **Keep this window short, or do steps 2–4 in one sitting.** |
| 5 | Deploy the redirect (below). | Only now does the apex have somewhere correct to go. |
| 6 | Verify. | §A.5 |

### A.4 The redirect itself — already written, not yet enabled

The redirect belongs in `public-web/deploy/nginx.conf`, in the same reviewed,
verifiable artifact as the security headers, rather than in a separate piece of
infrastructure nobody re-reads. Add **above** the existing `server` block:

```nginx
# Apex → canonical www. Not enabled: pcasafe.com does not resolve yet, and this
# block is inert until it does. `default_server` is deliberately NOT used --
# the existing block must stay the default, or an unmatched Host would redirect.
server {
    listen 80;
    listen [::]:80;
    server_name pcasafe.com;

    # $request_uri carries the path AND the query string, already encoded.
    # Using $uri here would silently drop every query string.
    return 301 https://www.pcasafe.com$request_uri;
}
```

Notes that are easy to get wrong:

- **No loop.** The target host is `www.pcasafe.com`, which never matches
  `server_name pcasafe.com`, so the redirect cannot re-enter this block. App Service
  terminates TLS and forwards on port 80, which is why one block covers both schemes;
  HTTPS-only is already enforced at the App Service, which issues the `http` → `https`
  301 before nginx sees the request.
- **`$request_uri`, not `$uri`.** `$uri` is the decoded path with no query string.
- **No `default_server`.** If this block were the default, any request with an
  unrecognised `Host` would be redirected to the apex rather than served.
- **HSTS.** The existing `Strict-Transport-Security` header has `includeSubDomains`
  and is served from `www`. Once the apex serves HTTPS this is consistent; if the apex
  is ever intended *not* to support HTTPS, `includeSubDomains` would have to be
  reconsidered first. It is not — the plan is HTTPS on both.

### A.5 Verification

```bash
curl -sSI https://pcasafe.com/            | head -3   # expect 301 + Location: https://www.pcasafe.com/
curl -sSI https://pcasafe.com/ar/privacy/ | head -3   # expect the path preserved
curl -sSIL https://pcasafe.com/           | grep -c '^HTTP'   # expect exactly 2 hops, no loop
echo | openssl s_client -connect pcasafe.com:443 -servername pcasafe.com 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName
node public-web/deploy/verify-container.mjs https://www.pcasafe.com   # www unaffected
```

Also confirm the four hostnames on the separate `pca` App Service — `app`, `parent`,
`platform`, `api` — still serve exactly what they served before. They are on a
different service and should be untouched, and that assumption is worth testing rather
than trusting.

### A.6 Rollback

| Failure | Rollback |
|---|---|
| Redirect misbehaves (loop, dropped path, wrong target) | Redeploy the previous image. The redirect ships **inside the container image**, so rollback is the ordinary image rollback — no DNS involved. |
| Certificate fails to issue after the record exists | Remove the apex A/ALIAS record. The apex returns to not resolving — the current state — which is preferable to a TLS warning. |
| Binding causes an unexpected problem on `pcaSafe` | Remove the `pcasafe.com` custom-domain binding. `www.pcasafe.com` is a separate binding and is unaffected. |

Do **not** roll back by pointing the apex somewhere else. Leaving it unresolved is a
clean, well-understood failure; a wrong destination is not.

### A.7 Not recommended

Adding the apex record but no redirect. That serves the entire site on two hostnames
while every page declares `www` canonical — duplicate content with a self-contradicting
canonical, which is worse for search than the current clean failure.

---

## B. Container registry authentication

### B.1 What was measured

| | |
|---|---|
| Web App | `pcaSafe` pulls from ACR using **admin-user credentials** (`authType: UserCredentials`, a username is set) |
| Managed identity | **none** — neither system- nor user-assigned |
| Registry | ACR `pcaSafe`, Basic SKU, `adminUserEnabled: true`, `publicNetworkAccess: Enabled`, anonymous pull disabled |
| Repository contents | **not verified** — the signed-in identity lacks the data-plane role, so the image inventory could not be listed. Recorded as unverified rather than assumed. |

No credential value was read, printed, logged or stored by this session, and none
appears in this repository.

### B.2 Why it is worth changing

The ACR admin account is one long-lived username and password granting **push as well
as pull** across the whole registry. It sits in site configuration, is shared by
everything configured to use it, is identical across every consumer, and does not
expire. Rotating it breaks every consumer at once, which in practice means it never
gets rotated. It is also unattributable: registry logs show the admin account, not
which service acted.

For a registry whose images will serve a child-protection site at `www.pcasafe.com`,
push rights on a non-expiring shared secret is more authority than a deployment needs.

### B.3 System-assigned, not user-assigned

**Recommendation: system-assigned.** Its lifecycle is tied to `pcaSafe` — deleting the
app deletes the identity, so no orphaned principal keeps `AcrPull` after the resource
is gone. There is exactly one consumer here, so the main reason to prefer
user-assigned (sharing one identity across several apps, or pre-creating the role
assignment before the app exists) does not apply. Revisit if a second Public app is
ever added, for example a staging slot.

### B.4 Steps, in an order that cannot break the pull

Each step is verified before the next. The critical rule: **the admin user is disabled
last**, only after an image pull has demonstrably succeeded through the identity.

```bash
# 1. Enable the system-assigned identity and capture its principal id.
az webapp identity assign --name pcaSafe --resource-group pca-group

PRINCIPAL_ID=$(az webapp identity show --name pcaSafe --resource-group pca-group \
  --query principalId --output tsv)

# 2. Grant AcrPull — pull only, scoped to this one registry.
ACR_ID=$(az acr show --name pcaSafe --resource-group pca-group --query id --output tsv)
az role assignment create --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPull --scope "$ACR_ID"

# 3. Point the site at the identity for image pulls.
az resource update --ids "$(az webapp show -n pcaSafe -g pca-group --query id -o tsv)/config/web" \
  --set properties.acrUseManagedIdentityCreds=true

# 4. Force a pull and confirm the container actually starts.
az webapp restart --name pcaSafe --resource-group pca-group
#    Then verify — see B.5. Do not proceed until it passes.

# 5. ONLY after step 4 passes: disable the admin user.
az acr update --name pcaSafe --admin-enabled false
```

Role assignments take up to a few minutes to propagate. If step 4 fails immediately,
wait and retry before concluding anything is wrong.

Portal equivalent: **pcaSafe → Identity → System assigned → On**, then
**pcaSafe (registry) → Access control (IAM) → Add role assignment → AcrPull → Managed
identity → pcaSafe**, then **pcaSafe (app) → Deployment Center → set authentication to
managed identity**, then **pcaSafe (registry) → Access keys → Admin user → Off**.

### B.5 Verification

```bash
az webapp identity show --name pcaSafe --resource-group pca-group --query type
az role assignment list --assignee "$PRINCIPAL_ID" --scope "$ACR_ID" --query "[].roleDefinitionName"
az acr show --name pcaSafe --query adminUserEnabled          # expect false at the end
curl -sSI https://www.pcasafe.com/ | head -1                 # site still serving
```

The real test is step 4: a restart forces a fresh pull, so if the identity path is not
working the container will fail to start. Checking the site responds **after** a
restart is what proves the pull succeeded — reading configuration only proves it was
requested.

### B.6 Secret-removal implications

Disabling the admin user invalidates that username and password **everywhere**. Before
step 5, confirm nothing else uses them: another App Service, a local `docker login`, a
CI pipeline, a saved credential in the Portal. The untracked `azure-pipelines.yml` at
the repository root references an ACR service connection (`pca-acr`) for a different
product surface; it is not part of Public and is not wired to this registry today, but
it is worth checking before the admin account is turned off.

Once disabled, **push** also requires an identity or `az acr login` with an Entra
account. Whoever publishes release images needs `AcrPush` granted to their own
principal — otherwise step 5 quietly removes the ability to ship.

### B.7 Rollback

`az acr update --name pcaSafe --admin-enabled true`, then set
`acrUseManagedIdentityCreds=false` and restart. The admin credentials are regenerated
on re-enable, so any consumer using the old pair must be updated — which is the same
blast radius that makes the shared secret worth removing.

### B.8 Owner authorisation required

This changes authentication on the resource serving the live public hostname. It is a
routing-sensitive infrastructure change and is not being made here.

---

## C. Release identity — how "which bytes are running?" gets answered

`node public-web/deploy/release-identity.mjs --image <ref>` prints the three identities
that make the question checkable, and **refuses to issue a release identity from a
dirty tree**, because an artifact that corresponds to no commit cannot be named.

| | |
|---|---|
| `SOURCE_SHA` | the commit built from |
| `ARTIFACT_SHA256` | rollup of the SHA-256 of every shipped file — the same commit must always produce the same value, which is what makes determinism auditable |
| `IMAGE_DIGEST` | the immutable content address of the image |

**`IMAGE_TAG_RECOMMENDATION`: `pcasafe.azurecr.io/pca-public:sha-<short-sha>`.**

Never deploy `:latest`. A moving tag makes "which bytes are running?" unanswerable and
turns rollback into guesswork. The tag should name the commit; the digest should be
recorded alongside it, because a tag can be re-pointed after review and a digest
cannot.

**`ROLLBACK_IMAGE_REFERENCE`: `pcasafe.azurecr.io/pca-public-placeholder:hold-v1`** —
the image currently on `pcaSafe`. **Record its digest before the first deploy.** A tag
is not a rollback target.

---

## D. Supply-chain and deployment review

Every item checked against the built image and the running container.

### Closed — repository-solvable, done

| Item | State |
|---|---|
| Base image pinning | **Both stages pinned by digest**, not tag. A tag is a moving pointer: `22.16.0-slim` can be rebuilt upstream, and two builds of the same commit would then produce different bytes, destroying the `ARTIFACT_SHA256` comparison. Update instructions are in the Dockerfile. |
| Directory indexes | `autoindex off` set explicitly, and the verifier now checks `/assets/` and `/assets/video/` — the two directories with no `index.html` — return 404 and leak no file index. It was already off by default; a default is not a decision. |
| Container user | nginx master as root, workers as `nginx` (uid 101), which is the stock model. Port 80 needs the privileged bind; an unprivileged image on 8080 would require changing the App Service container port, which is an Azure change and out of scope here. |
| Writable paths | The document root is `chmod a-w` in the image; nothing is written at runtime. |
| Unnecessary packages | Runtime is `nginx:alpine` only. The Node build stage is discarded, so no toolchain ships. Zero npm dependencies, no lockfile, no install step — the base image is the entire supply chain. |
| Exposed ports | `EXPOSE 80` only. |
| Health endpoint | `/healthz`, plain text, no logging, independent of the artifact — so it distinguishes "container up" from "site correct". |
| Manifest exactness | Asserted at image-build time: the deploy root must hold exactly the manifest's file count, and every checksum must verify. |
| Source and report exclusion | Asserted at build: no `build-report.json`, no `release-a-evidence.json`, no `.mjs`, no `.map`, no `.env*` in the deploy root. The verifier probes for them over HTTP too. |
| Dotfiles | `location ~ /\. { deny all; }`, verified. |
| Server tokens | `server_tokens off`, verified (`Server: nginx`, no version). |
| Compression | gzip on HTML and CSS, verified over the wire. |
| 404 behaviour | Real 404 status with the real error page; no SPA fallback, so a missing path cannot soft-200 as the home page. Verified. |
| 5xx behaviour | The base image's stock `50x.html` was removed from the deploy root (it shipped at HTTP 200 on the first build). nginx's built-in error body carries no version with `server_tokens off`. |
| Security headers on errors | All eight present on 4xx as well as 2xx, because every `add_header` uses `always`. Verified on 19 paths. |
| CSP on all paths | Verified on every page, both locales, assets, `robots.txt`, `sitemap.xml` and the 404. |

### Open — not repository-solvable

| Item | Class |
|---|---|
| Apex DNS record, binding and certificate | `OWNER_AUTH_REQUIRED` — §A |
| ACR managed identity and admin-user removal | `OWNER_AUTH_REQUIRED` — §B |
| `healthCheckPath`, `alwaysOn`, HTTP/2 on `pcaSafe` | `OWNER_AUTH_REQUIRED` — §E |
| Read-only container root filesystem | `OWNER_AUTH_REQUIRED` — a runtime flag on the App Service, not an image property |
| `pca` sharing a B1 plan with an unrelated product | `OWNER_AUTH_REQUIRED` |

---

## E. Related settings, already recorded

Not blockers, listed so the predeploy checklist is complete:

| Setting | Now | Should be | Why |
|---|---|---|---|
| `healthCheckPath` | `null` | `/healthz` | The image already serves it; without a health path Azure cannot tell a wedged container from a healthy one |
| `alwaysOn` | `false` | `true` | The first visitor after ~20 minutes idle otherwise pays a cold start |
| `http20Enabled` | `false` | `true` | Free latency improvement for a multi-asset page |
| Image reference | tag | tag **and** recorded digest | A tag can be moved after review |
| `pca` plan | B1 shared with `ims-platform`, `ims-v1` | separate plan | PCA shares a Basic instance with an unrelated product |
