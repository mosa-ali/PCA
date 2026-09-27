# 09 — API Production Configuration & Live Evidence

## 1. Expected production configuration surface (names only; no values)

| Class | Variables (from source) | Classification |
|---|---|---|
| Database | `PCA_DATABASE_URL`, `PCA_DATABASE_TLS`, `PCA_DATABASE_TLS_CA` (`db/pool.ts:12,69,108`; boot assertion `main.ts`) | REQUIRED (TLS posture must be stated) |
| Migrations | `PCA_MIGRATION_DATABASE_URL` (migration scripts) | REQUIRED for migrations |
| Trusted proxy | `PCA_TRUSTED_PROXY_CIDRS` (`http/trustProxyConfig.ts:80`) | REQUIRED in production (else trust=false; see R-01) |
| CORS origins | `PCA_PARENT_WEB_ORIGIN`, `PCA_PLATFORM_ADMIN_WEB_ORIGIN` (`http/parentWebCors.ts:68,99`) | REQUIRED (fail-closed localhost refusal) |
| Email | `PCA_EMAIL_PROVIDER`, `PCA_EMAIL_FROM_NAME`, `PCA_EMAIL_REPLY_TO_ADDRESS`, `PCA_SMTP_SECURE/USERNAME/PASSWORD` (+Graph keys), `PCA_EMAIL_OUTBOX_ENCRYPTION_KEY` (`email/emailProviderConfig.ts:37-146`; `email/emailOutboxEncryption.ts:67`) | REQUIRED (provider-dependent) |
| Verification | `PCA_VERIFICATION_CODE_HMAC_SECRET` (`parentaccount/verificationCode.ts:75`) | REQUIRED |
| Parent policy | `PCA_FREE_ACCESS_MODE`, `PCA_FREE_ACCESS_DURATION_DAYS`, `PCA_DEFAULT_PARENT_MEMBER_LIMIT`, `PCA_DEFAULT_MANAGED_DEVICE_LIMIT` (`parentaccount/policy.ts:101-108`) | OPTIONAL (defaults) |
| Platform admin | `PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL`; MFA key realm (`main.ts:549` comment) | REQUIRED for those flows |
| Billing/sandbox | `PCA_PAYMENT_PROVIDER_PRODUCTION_ACTIVATION`, `PCA_SANDBOX_WEBHOOK_SECRET` (`billing/...`) | OPTIONAL (commercial) |
| Device proof / crypto | **none** — deliberately no env switch around verifiers (absence proof, report 05 §4) | — |
| Azure-specific | App Service env (from prior programmes; outside repo) | EXTERNAL |

No secret values were read or printed; no Key Vault access was performed in
this session.

## 2. Live read-only checks (2026-09-26, GET/HEAD only)

| URL | Method | Expected | Actual | Verdict |
|---|---|---|---|---|
| `https://api.pcasafe.com/health` | GET | 200 JSON | **200** `{"service":"pca-backend","status":"ok"}` (1734 ms) | MATCH (`buildServer.ts:440`) |
| `https://api.pcasafe.com/health/db` | GET | 200/503 JSON | **200** `{"status":"ok","database":"connected"}` (1091 ms) | MATCH (`buildServer.ts:454-465`; DB reachable) |
| `https://api.pcasafe.com/health/email` | GET | 200/503 JSON | **200** `{"status":"ok","provider":"SMTP"}` (1004 ms) | MATCH; SMTP provider wired (≠ delivery proof) |
| `https://api.pcasafe.com/__pca_assessment_unknown_route__` | GET | 404 JSON envelope | **404** Fastify default body | MATCH |
| `https://api.pcasafe.com/v1/runtime-sync/inbound` | GET | 401 JSON | **401** `{"error":"unauthorized"}` (1423 ms) | MATCH (collapsed auth error) |
| `https://api.pcasafe.com/v1/enrollment/bootstrap` | GET | 404/405 (POST-only) | **404** Fastify default | MATCH |
| `https://api.pcasafe.com/health` | HEAD | 200 headers only | **200** | MATCH |

**TLS**: TLSv1.3, `TLS_AES_256_GCM_SHA384`; certificate valid to 2027-03-04;
SAN `api.pcasafe.com`; issuer DigiCert/GeoTrust. Good.

**Observed header note**: no HSTS / `X-Content-Type-Options` / `X-Frame-Options`
on any probe response. For a JSON-only API this is a platform-edge policy
question (owner/Azure), not an API-code defect — recorded as risk R-07.

No state-changing request was made; no account/device/policy was touched.

## 3. Health-endpoint review (mission §34)

- `/health`: static liveness; documented as intentionally trivial
  (`buildServer.ts:440`).
- `/health/db`: **real** `SELECT 1` on the shared pool; 503 on failure;
  own 60/min bucket so probes cannot starve session-validation budgets
  (`buildServer.ts:446-465`).
- `/health/email`: reports **provider wiring only** — no network call, never a
  send (documented `email/emailHealth.ts:8`); registered only when an adapter
  exists; own bucket.

```text
API_HEALTH = PASS
```

## 4. Source ↔ live consistency (mission §33)

- Behavior matches source contract on **every** safe probe (bodies/status
  shapes identical to `buildServer.ts`/`runtimeSyncRoutes.ts`).
- There is **no version/SHA surface** on the live API; the last recorded
  deployment identity in docs is `sha256:f7897f9a…` (f62e409d-era image,
  `docs/deployment/DOCKER_AZURE_SUPPORT_REVIEW.md:431`), while the repo is at
  origin `9496fb19` + local `6a2cc073` + a dirty worktree.
- Azure/app-service state was **not** readable in this session (no
  authenticated tooling provided).

```text
SOURCE_HEAD = 6a2cc073 (worktree; origin/pca-dev 9496fb19)
PRODUCTION_IDENTITY = UNKNOWN (no revision surface; last doc-recorded digest f7897f9a-era)
SOURCE_PRODUCTION_MATCH = PARTIAL  (behavioral consistency proven; revision identity unproven)
```
