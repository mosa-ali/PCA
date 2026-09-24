# PCA — Azure Pre-Production Acceptance Plan

**Status:** `AZURE_STAGING_DEPLOYMENT = APPROVED_TO_PREPARE`
**Owner ruling date:** 2026-09-22
**Prepared by:** engineering (source-grounded; every claim below cites the file it
came from)

> **This document is PREPARATION. No Azure resource, DNS record, TLS certificate,
> SMTP credential, production database, or branch-protection setting was created,
> modified, or rotated in producing it.** Nothing here has been executed against a
> cloud subscription. Every command and value below is a plan to be approved and
> run by the owner or with the owner's explicit go-ahead.

---

## 1. Authorization boundary (owner ruling, recorded verbatim)

```
AZURE_STAGING_DEPLOYMENT = APPROVED_TO_PREPARE
AZURE_PRODUCTION_DEPLOYMENT = NOT_YET_APPROVED

DEPLOY_SHA = b2dcbf0ed8ac03e8bb2081fabe69be2de16989f7

CI = 35700989399 SUCCESS

SOURCE_CERTIFICATION = 26 CERTIFIED / 24 TRACKED GAPS

NEXT_PHASE = AZURE PRE-PRODUCTION ACCEPTANCE

PRODUCTION_DB_MUTATION = NOT YET
PRODUCTION_SECRET_ROTATION = NOT YET
DNS/TLS_CHANGE = NOT YET
MAIN_MERGE = NOT YET
PUBLIC_RELEASE = NOT YET
```

The staging environment is an **acceptance** environment. It is not a cutover, and
it must not share a database, an SMTP/provider identity, or a hostname with the live
customer estate.

---

## 2. What is being deployed

| Item | Value | Source of truth |
|---|---|---|
| Commit | `b2dcbf0ed8ac03e8bb2081fabe69be2de16989f7` | `git rev-parse HEAD` on `pca-dev` |
| Branch | `pca-dev` | — |
| CI verdict on that SHA | `35700989399` = **SUCCESS** (27/27) | `gh run view` |
| Source certification | **26 certified / 24 tracked gaps** | `backend/test/tooling/productionPathCertification.test.mjs` |
| Remaining gaps | `CRYPTO_GATED=11`, `NO_PRODUCTION_WRITER=2`, `SYNTHETIC_ONLY=11` | same register |
| `main` | **untouched** — no merge has occurred | owner ruling `MAIN_MERGE = NOT YET` |

Deploy the SHA, never the branch tip, so the artifact is pinned to the CI verdict
above.

### 2.1 Two release-blocking facts that staging must not obscure

1. **`PCA-DEC-020` is unresolved and deliberately gates runtime behaviour.**
   The runtime composition intentionally wires rejecting crypto/signature
   implementations, and protection alerts are prevented from producing real
   encrypted output (see `backend/src/alerts/RejectingOpaqueProtectionAlertComposer.ts`,
   `PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW`). Consequences that will
   be visible in staging and must be treated as **expected, not defects**:
   - no protection alert is ever durably recorded;
   - envelope acceptance, device-session issuance, Trust Set and Safe Zone paths
     that depend on the reviewed crypto suite remain closed;
   - the `CRYPTO_GATED=11` register rows cannot be promoted.
2. **Staging must not "fix" those gates.** Substituting a permissive composer,
   verifier, or key to make a demo work would convert a documented, reviewed gate
   into an undocumented production behaviour. If a gate blocks acceptance, the
   correct outcome is a recorded finding, not a local override.

---

## 3. Runtime topology (from the project Dockerfiles)

Three containers, all non-root, all from `node:22.16.0-bookworm-slim` or
`nginxinc/nginx-unprivileged:1.27-alpine`, each pinned by digest.

| Container | Base | User | Port | Entry | Source |
|---|---|---|---|---|---|
| `backend` | `node:22.16.0-bookworm-slim` | `pca` (non-root) | **4001** | `node dist/main.js` | `backend/Dockerfile` |
| `parent-web` | `nginx-unprivileged:1.27-alpine` | `101` | **8080** | `nginx -g 'daemon off;'` | `parent-web/Dockerfile` |
| `platform-admin-web` | `nginx-unprivileged:1.27-alpine` | `101` | **8080** | `nginx -g 'daemon off;'` | `platform-admin-web/Dockerfile` |

`backend/Dockerfile` bakes `NODE_ENV=production`, `PORT=4001`, `HOST=0.0.0.0`.
Ingress terminates TLS and maps 443 → 4001/8080 as appropriate.

> **Build-time, not run-time:** `parent-web/Dockerfile` consumes
> `VITE_PCA_API_BASE_URL` as a **build ARG**. The API base URL is compiled into the
> static bundle, so pointing the web tier at a different backend requires a
> **rebuild**, not an environment-variable change on a running container. Getting
> this wrong produces a site that silently calls the wrong origin.

The existing Azure resource topology is already documented in
`docs/supervision/PCA_AZURE_PCA_RESOURCE_TOPOLOGY_2026-09-13.md`; the staging
environment should follow it, and that document should be reconciled against the
actual subscription before any resource is created.

---

### 3.1 Reconciled live estate (read-only, 2026-09-22) — and why nothing was deployed

A read-only reconciliation against the authenticated subscription found an
**existing, publicly-addressed estate**. This is the fact that changes the shape of
the deployment, so it is recorded before any command set.

| Resource | Resource group | What it is | Public address |
|---|---|---|---|
| `pca` | `AppWenPlan` | App Service, **sitecontainers**, port 4001, VNet-integrated, system-assigned identity | Azure default hostname |
| `pcaSafe` | `pca-group` | App Service, sitecontainers | **`www.pcasafe.com`** (custom domain bound) |
| `pcaParent` | `pca-group` | App Service, sitecontainers | **`parent.pcasafe.com`** (custom domain bound) |
| `pcaSafe` ACR | `pca-group` | `pcasafe.azurecr.io` | — |
| `pca-key` Key Vault | `pca-group` | secret store | — |
| `pca-mysql` | `pca-group` | MySQL **Flexible Server** + private endpoint in `AppWenPlan` VNet | private only |

Two further read-only findings:

- **No deployment slots exist on any of the three apps.** So there is no
  slot-based staging path available today; a slot would have to be *created*, which
  is itself a mutation of a production App Service resource (and slots share the
  app's plan and identity).
- Images are pulled from the existing `pcasafe.azurecr.io` ACR in `sitecontainers`
  mode, so a staging deployment reuses that registry rather than needing a new one.

**Decision taken while the owner was unavailable, recorded so it can be reversed
explicitly:**

> **No Azure resource was created, modified, or deployed.** The existing estate is
> bound to real public hostnames, so deploying this SHA to it is a *production*
> deployment — `AZURE_PRODUCTION_DEPLOYMENT = NOT_YET_APPROVED`, and
> `DNS/TLS_CHANGE`, `PRODUCTION_DB_MUTATION` and `PRODUCTION_SECRET_ROTATION` are all
> `NOT YET`. The alternative — a brand-new isolated estate — is billable and
> externally visible and requires topology choices (region, plan, MySQL SKU, naming,
> reuse-vs-new) that belong to the owner. `APPROVED_TO_PREPARE` was read as its
> operative qualifier: preparing is authorised, executing is not. Standing up
> MySQL Flexible Server capacity unilaterally in someone else's subscription is
> exactly the class of action a prior standing instruction forbade.

Nothing in this section required a write. Every fact above came from `az group list`,
`az resource list`, `az webapp deployment slot list`, and
`az webapp config container show`, all read-only.

### 3.2 The two viable staging shapes (owner to choose)

Both are written below as a **reviewable command set, not an executed one**. Neither
has been run. Both are in `uaenorth`, consistent with the existing estate.

**Shape A — slot on the existing `pca` App Service** (cheapest; no new DNS)
Uses a deployment slot so nothing is swapped into production, but it does add a slot
to a production app and shares its plan, identity and VNet.

**Shape B — fully isolated estate in a new resource group** (true isolation; new cost)
A new plan, app, Key Vault and MySQL Flexible Server. No production touch at all,
but a new recurring bill and a new hostname/TLS to arrange.

> **Prerequisite for either shape — do not skip.** §5's reconciliation must be
> signed off first: this plan's own gate is that staging is not stood up until the
> configuration, the rollback point, and the separate migration credential are
> settled. Shape A additionally requires the owner to accept a mutation on the
> production App Service resource.

```powershell
# ---------------------------------------------------------------------------
# READ-ONLY PRE-FLIGHT — safe to run as-is. Establishes the facts the deploy
# depends on and prints the environment-variable NAMES (never values) so a
# staging set can be assembled without copying secrets.
# ---------------------------------------------------------------------------
$SUB = '5f5205e2-4e56-4cea-8ce7-3d408ed1507b'
az account show --query '{name:name,id:id,state:state}' -o table

# Which image is live today, and on which registry?
foreach ($app in @(@('AppWenPlan','pca'), @('pca-group','pcaSafe'), @('pca-group','pcaParent'))) {
  az webapp config container show -g $app[0] -n $app[1] -o json
}

# NAMES ONLY. Deliberately not `--show-values`: configuration names are needed to
# build a staging set, values are secrets and must not pass through a terminal log.
foreach ($app in @(@('AppWenPlan','pca'), @('pca-group','pcaSafe'), @('pca-group','pcaParent'))) {
  az webapp config appsettings list -g $app[0] -n $app[1] --query '[].name' -o tsv
}

# Existing slots (confirmed none on 2026-09-22) and the MySQL server version/SKU.
az webapp deployment slot list -g AppWenPlan -n pca -o table
az mysql flexible-server show -g pca-group -n pca-mysql `
  --query '{version:version, sku:sku.name, tier:sku.tier, ha:highAvailability.mode}' -o table
```

```powershell
# ---------------------------------------------------------------------------
# SHAPE A — staging SLOT on the existing pca app. NOT RUN. Requires approval.
# Do this only after §5 is signed off.
# ---------------------------------------------------------------------------
# az webapp deployment slot create -g AppWenPlan -n pca --slot staging --configuration-source pca
#   -> then set staging-specific app settings (names from the pre-flight above),
#      with a NON-production database and a NON-production email identity.
#   -> then deploy the pinned image and run §6's campaign against the slot hostname.
#   -> A slot is NOT swapped into production by this plan. No `slot swap`. Ever,
#      until AZURE_PRODUCTION_DEPLOYMENT is approved.
```

```powershell
# ---------------------------------------------------------------------------
# SHAPE B — ISOLATED estate. NOT RUN. Requires approval AND the owner's choices.
# Values in <> are decisions, not defaults. Nothing here is inferred.
# ---------------------------------------------------------------------------
# az group create -l uaenorth -n <staging-resource-group>
# az appservice plan create -g <rg> -n <staging-plan> --is-linux --sku <B1|P0v3|...>
# az webapp create -g <rg> -p <staging-plan> -n <staging-app> \
#   --deployment-container-image-name <image>            # reuse pcasafe.azurecr.io
# az mysql flexible-server create -g <rg> -n <staging-mysql> \
#   -l uaenorth --tier <Burstable|GeneralPurpose> --sku-name <Standard_B1ms|...> \
#   --version <8.4> --admin-user <user>
#   -> private networking, TLS, and the firewall posture must be decided explicitly;
#      the production server uses a private endpoint, and staging should not be
#      more exposed than production.
#   -> PCA_DATABASE_TLS must be stated explicitly or the pool refuses to connect.
```

**Migration, in both shapes, is a two-credential operation.** `scripts/migrate.mjs`
records that the fallback to `PCA_DATABASE_URL` was removed, so the staging database
needs an explicitly separate, more-privileged `PCA_MIGRATION_DATABASE_URL`
independent of the runtime credential. Migrate with the privileged credential, then
verify the runtime credential is least-privilege — mirroring the CI proof that the
runtime principal is rejected by the database itself for `UPDATE`/`DELETE` on
`platform_admin_audit_events`.

## 4. Configuration inventory (extracted from source, not assumed)

Backend container environment variables, each found by reading
`backend/src/**`:

**Database**
| Variable | Notes |
|---|---|
| `PCA_DATABASE_URL` | runtime credential, read by `src/db/pool.ts` |
| `PCA_DATABASE_TLS` | must be stated explicitly; the pool **refuses to connect** if the encryption posture is unstated |
| `PCA_DATABASE_TLS_CA` | CA bundle when `PCA_DATABASE_TLS=REQUIRED` |
| `PCA_MIGRATION_DATABASE_URL` | **required for migrations and deliberately separate** — `scripts/migrate.mjs` records that the fallback to `PCA_DATABASE_URL` was removed, so a runtime that must migrate has to be given a distinct, more-privileged credential |

**Email / provider**
`PCA_EMAIL_PROVIDER`, `PCA_SMTP_HOST`, `PCA_SMTP_PORT`, `PCA_SMTP_SECURE`,
`PCA_SMTP_USERNAME`, `PCA_SMTP_PASSWORD`, `PCA_EMAIL_FROM_ADDRESS`,
`PCA_EMAIL_FROM_NAME`, `PCA_EMAIL_REPLY_TO_ADDRESS`, `PCA_EMAIL_OUTBOX_ENCRYPTION_KEY`;
Microsoft Graph variant: `PCA_GRAPH_TENANT_ID`, `PCA_GRAPH_CLIENT_ID`,
`PCA_GRAPH_CLIENT_SECRET`, `PCA_GRAPH_SENDER_USER_ID`.

**Origins / CORS**
`PCA_PARENT_WEB_ORIGIN`, `PCA_PLATFORM_ADMIN_WEB_ORIGIN`,
`PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL`.

**Secrets and platform**
`PCA_VERIFICATION_CODE_HMAC_SECRET`, `PCA_SANDBOX_WEBHOOK_SECRET`,
`PLATFORM_ADMIN_MFA_ENC_KEY` (32-byte hex; note it is the **only** required secret
not prefixed `PCA_` — a staging environment assembled from a `PCA_*` checklist alone
will be missing it), `PCA_TRUSTED_PROXY_CIDRS`.

### Rotating `PLATFORM_ADMIN_MFA_ENC_KEY` (read before rotating)

> **NOT CERTIFIED FOR PRODUCTION YET (`KEY_ROTATION_PROCEDURE_CERTIFIED = NO`).**
> Do not configure `PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1`/`_PREVIOUS_2`, and do
> not run the drain audit with `--apply` against production data, until the MySQL
> CAS proof for the reseal path AND the drain-audit execution-path test exist.
> The rotation feature ships DORMANT: with no `_PREVIOUS_n` configured the key
> ring is the active key alone, and behaviour is identical to the pre-ring code.
> See `docs/release_readiness/RELEASE_GATE.md` ("Current release ... recorded
> scope") and `docs/release_readiness/EXTERNAL_GATE_MATRIX.md`.

This key seals every Platform Admin TOTP secret. It is a **bounded key ring**, not
a single key: decryption accepts the active key plus up to two explicitly named,
decrypt-only previous generations:

| Variable | Role |
| --- | --- |
| `PLATFORM_ADMIN_MFA_ENC_KEY` | **Active.** Seals all new material. Required. |
| `PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1` | Optional. Decrypt-only. The outgoing key. |
| `PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_2` | Optional. Decrypt-only. The generation before that. |

A legacy slot that is **absent or blank** is skipped. A legacy slot that is
**present but malformed** is a hard configuration failure — deliberately, because
silently ignoring a mistyped rotation key is indistinguishable from having no
legacy key at all, and fails straight into the lockout the ring exists to prevent.
There is **no enumeration** of Key Vault versions or history: only these two named
slots are ever consulted, so no version an attacker could create becomes trusted.

**The rotation sequence. Clearing the old key is a separate, later, deliberate act.**

1. Set `PLATFORM_ADMIN_MFA_ENC_KEY` to the **new** key `K2`.
2. Set `PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1` to the **outgoing** key `K1`
   **in the same change**. Deploy them together.
3. Run the drain audit (read-only, writes nothing):
   `node backend/scripts/reseal-platform-admin-mfa-secrets.mjs`
4. Apply the reseal to migrate every remaining row onto `K2`:
   `node backend/scripts/reseal-platform-admin-mfa-secrets.mjs --apply`
   (idempotent; safe to re-run)
5. Repeat (4) until the audit reports `legacy: 0` and `undecryptable: 0`. **Only
   then** is `K1` safe to clear.

The drain audit is required because read repair is **decrypt-driven**: a row is
resealed only when something decrypts it, so a dormant admin who never logs in
keeps their secret sealed under `K1` with nothing to indicate it. Without step (3)
the audit, clearing `K1` is a blind act.

**Never do this:**
- Rotate the active key to `K2`, deploy, and only later remember `K1`. Once `K1`
  is gone while `K1`-encrypted rows remain, **no software can recover them** — the
  operator is locked out of the admin plane with no authenticated path back in.
- Clear `PREVIOUS_1` in the same change that rotates the active key.
- Rotate twice before draining. With two slots this works, but an admin idle
  across both rotations falls off the ring.

**Exit codes of the drain audit** (it is designed to be used as a gate):
`0` nothing depends on a previous key — retirement is safe;
`3` at least one row is still sealed under a previous key — **do not** clear it;
`2` at least one row could not be decrypted with any permitted key — data is
already unreachable; configure the correct key before anything else.
Output is counts and key-generation names only: never an admin id, ciphertext,
nonce, plaintext secret, or key material, so it is safe to paste into an incident
channel.

**Defaults / product configuration**
`PCA_DEFAULT_PARENT_MEMBER_LIMIT`, `PCA_DEFAULT_MANAGED_DEVICE_LIMIT`,
`PCA_FREE_ACCESS_MODE`, `PCA_FREE_ACCESS_DURATION_DAYS`.

> **Careful when grepping the source for configuration:** a search for `PCA_`
> across `backend/src` also returns document filenames (e.g.
> `PCA_CANONICAL_SCHEMA_REPORT`, `PCA_PPR2_OWNER_DECISIONS`) and cookie names
> (`pca_family_session`, `pca_family_csrf`) that are **not** environment variables.
> The list above is the reconciled set, not a grep dump.

---

## 5. Configuration reconciliation before any resource is created

To be completed and signed off **before** staging is stood up:

- [ ] Current **production migration watermark** versus source — run `scripts/verify-mysql.mjs`
      against the staging database and record the highest applied migration.
- [ ] Confirm the staging database starts **empty** (migration-from-zero) *and* keep a
      second exercise **from an upgrade baseline** (see §6 A2).
- [ ] Every variable in §4 present, with `PCA_DATABASE_TLS` explicitly set and a
      separate `PCA_MIGRATION_DATABASE_URL`.
- [ ] `VITE_PCA_API_BASE_URL` fixed to the staging backend origin, then the image rebuilt.
- [ ] `PCA_PARENT_WEB_ORIGIN` / `PCA_PLATFORM_ADMIN_WEB_ORIGIN` set to the staging
      web origins, not the production ones.
- [ ] SMTP/provider identity is a **staging** identity that cannot deliver to real
      families; provider sending limits understood.
- [ ] Staging ingress hostname chosen from a domain the owner controls and is
      willing to expose; TLS certificate issued for it.
- [ ] Recorded rollback point: the previous deployable SHA and its image digest, plus
      a database backup taken before the first migration.
- [ ] Confirm the staging database user is **least-privilege for runtime** and that a
      separate privileged credential exists for migrations (mirrors the CI proof that
      the runtime principal is rejected by the database itself for `UPDATE`/`DELETE`
      on `platform_admin_audit_events`).

---

## 6. Acceptance campaign

Each check states what it proves and what a failure would mean. Run against the
Azure URLs, not localhost.

| # | Check | Proves | Failure means |
|---|---|---|---|
| A1 | Migrations **from zero** on an empty staging database, then `scripts/verify-mysql.mjs` reports the schema matches | the migration chain is self-sufficient and the schema authority agrees with reality | release blocker: the chain is incomplete or drifted |
| A2 | Migrations **from an upgrade baseline** (a snapshot at the recorded production watermark) | existing deployments can be upgraded in place, not only built fresh | release blocker for any real cutover |
| A3 | `GET /health`, `GET /health/db`, `GET /health/email` | process liveness, live DB connectivity, and email-provider readiness, each independently | isolates which dependency is actually broken |
| A4 | Parent Web against the Azure API: origin/CORS preflight, cookie issuance (`pca_family_session`), CSRF header match, no cross-origin leakage | the browser trust boundary works on real origins and real TLS, not just in tests | the web tier is compiled against the wrong base URL or the origin allow-list is wrong |
| A5 | Real-backend registration → verification email → OTP login → authenticated session | the full identity path works end to end including a real email provider | email configuration or code binding is wrong |
| A6 | Platform Admin: bootstrap/first-owner path, admin login with MFA, audit privilege boundary | the highest-privilege surface is reachable and still least-privilege | release blocker |
| A7 | Restart/persistence: restart the API container, confirm sessions and durable rows survive | nothing critical is held only in process memory | release blocker |
| A8 | Scheduled/maintenance workers actually run on the deployed container and their output is observable | the commercial/maintenance lane works outside CI | worker wiring or timezone problems |
| A9 | Logs and alerts: no secrets or raw payloads in logs; a deliberate failure appears in the log/alert path | the privacy posture holds in the real runtime | privacy defect |
| A10 | EN/AR rendering and RTL across the parent-facing surfaces on the Azure URLs | localisation survives the real build, not only the test harness | build/config defect |
| A11 | Browser E2E suite pointed at the Azure URLs (Playwright, against real origins and TLS) | the deployed artefact behaves as the tested one | the deployed build differs from the certified build |

**Expected-to-fail list, to avoid mislabelling a gate as a defect:** anything
downstream of `PCA-DEC-020` (§2.1). Record these as `EXPECTED_GATED`, not `FAILED`.

---

## 7. Exit criteria for the staging phase

Staging is complete when: A1–A11 have all been executed and their outcomes recorded
(including any `EXPECTED_GATED` items); every genuine failure is either fixed on a
new SHA and re-accepted, or dispositioned by the owner; and the configuration
reconciliation in §5 is signed off. Only then does the **production deployment
decision packet** (§9) get written.

---

## 8. Rollback

Use the existing checklist at `docs/release_readiness/ROLLBACK_CHECKLIST.md`, and
additionally:

- the rollback point is a **pinned image digest plus a database backup taken before
  the first migration**, recorded in §5;
- because the web images compile `VITE_PCA_API_BASE_URL` in, a rollback of the web
  tier may require redeploying the previous **image**, not just changing a variable;
- migrations are forward-only in practice: confirm before migrating whether the new
  SHA added a migration that the previous SHA cannot read, and if so treat the
  database backup as the rollback mechanism.

---

## 9. Not-yet-decided: the production decision packet

`AZURE_PRODUCTION_DEPLOYMENT = NOT_YET_APPROVED`. Before that is asked for, the
following must be dispositioned by the owner — each as *required-for-release*,
*intentionally gated*, or *accepted residual*:

1. **`PCA-DEC-020` (production crypto suite)** — the single largest gate. Until it is
   reviewed, several security-sensitive paths are closing by design.
2. The 11 `CRYPTO_GATED` register rows — mostly downstream of `PCA-DEC-020`.
3. The 2 remaining `NO_PRODUCTION_WRITER` rows.
4. The 11 `SYNTHETIC_ONLY` rows.
5. `PCA-DEC-035` (RBAC policy configuration) — owner-approved but
   crypto-gated; the documented safe-default-OFF is **not** enforced.
6. The two intentionally-gated behaviours in §2.1, stated plainly in release notes.
7. Production-only items that staging cannot settle: real DNS/TLS, secret rotation
   procedure, on-call/alert routing, and the production data-migration plan.

---

## 10. What this document deliberately does not do

- It does not create or modify any Azure resource.
- It does not touch DNS, TLS, SMTP credentials, or the production database.
- It does not merge `pca-dev` into `main`.
- It does not claim the build is production-ready; §9 lists what still has to be
  decided, and §2.1 lists behaviour that is closed on purpose.
