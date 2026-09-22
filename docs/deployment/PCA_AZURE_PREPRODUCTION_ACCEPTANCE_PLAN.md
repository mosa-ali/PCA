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
