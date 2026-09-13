# PCA AUTH_B Live Acceptance — Stop Record

Date: 2026-09-13  
Branch: `pca-dev`  
Engineering accepted SHA: `96887770a55c8d4cbf44f7cbc4c9cea5681ac8f2`

## Decision

`AUTH_B=BLOCKED`  
`BACKEND_DEPLOYMENT=ATTEMPTED_THEN_ROLLED_BACK`
`READY_FOR_PARENT_C=NO`  
`STOP=YES`

The initial run stopped at the SMTP gate. That historical finding was superseded by the verified replacement and the later deployment attempt recorded below. No secret value was read, printed, committed, or deployed.

### Resume attempt (2026-09-13)

After the owner reported rotation, `git fetch origin` reconciled `pca-dev` at `ac10734634c8f90f37932473243346f5ce4d3214` with a clean worktree. A fresh read-only Key Vault check still returned exactly one enabled version, `243780f0c811435fb2c5340f566a677b`; the active secret metadata therefore remains the compromised historical version. The `pca` app setting is present and uses an unversioned Key Vault reference, but no distinct active version exists for it to resolve. `SMTP_ROTATION=BLOCKED; REPLACEMENT_NOT_PROVEN` and the stop-before-deployment rule remains in force.

### Owner clarification recheck (2026-09-13)

The earlier owner clarification recheck was superseded by the verified replacement below.

## Original owner action package (superseded)

The following was the action package from the earlier failed verification. It is retained for traceability only; do not create another credential now that version `749c5cf6bd92407794c2d687c2741e99` is present.

1. In the Mailgun account, create a new SMTP credential for the approved sending identity `support@mail.pcasafe.com` (host `smtp.mailgun.org`, port `587`, STARTTLS / `secure=false`).
2. Store only the new credential in Azure Key Vault `pca-key`, secret `PCA-SMTP-PASSWORD`, as a new active version. Do not paste the password, API key, token, connection string, or any other secret into chat, tickets, commits, or evidence.
3. Preserve the configured sender and reply-to addresses: `support@mail.pcasafe.com` and `support@pcasafe.com`.
4. Return confirmation containing only: new Key Vault version identifier (or creation timestamp), enabled status, and confirmation that it differs from the historical version. Do not include the secret value.

The old credential must not be used. Do not revoke it until replacement functionality has been independently proven; record revocation as a follow-up owner action.

## Reconciliation

```text
APPLICATION_SOURCE_SHA=21d0d9ff648f0ea995dbeddb55e7e327aee06904
REMOTE_HEAD=21d0d9ff648f0ea995dbeddb55e7e327aee06904
WORKTREE=CLEAN
SMTP_ROTATION=PASS
OLD_SMTP_CREDENTIAL_REUSED=NO
OLD_SMTP_CREDENTIAL_REVOCATION=NOT_YET; wait for replacement proof
BACKEND_SOURCE_SHA=21d0d9ff648f0ea995dbeddb55e7e327aee06904
BACKEND_IMAGE_TAG=auth-b-20260913-sp
BACKEND_IMAGE_DIGEST=sha256:a3feb4a8bddec77432f446b8bb00a6e04da9e7bb2f679bc52513a7e43f608d87
BACKEND_AZURE_TARGET=pca (AppWenPlan)
```

The backend App Service `pca` is currently restored to the anonymous static-site placeholder after the failed pull. `pcaSafe` was not modified and remains out of scope.

## Verified rotation and deployment attempt (2026-09-13)

The owner supplied replacement version `749c5cf6bd92407794c2d687c2741e99`. Independent Azure CLI and direct Key Vault REST metadata checks confirmed both versions exist, the replacement is enabled and newest, and the `pca` setting is an unversioned reference to `pca-key/PCA-SMTP-PASSWORD`. The historical version remains enabled and was not revoked. No secret value was retrieved or logged.

`SMTP_ROTATION=PASS` was therefore established. `pca` was refreshed before deployment. A fresh backend image was built from source `21d0d9ff648f0ea995dbeddb55e7e327aee06904` and pushed to `pcasafe.azurecr.io` with tag `auth-b-20260913-sp`; registry digest was `sha256:a3feb4a8bddec77432f446b8bb00a6e04da9e7bb2f679bc52513a7e43f608d87` (the local OCI index digest was `sha256:40a0d539fbca942aea856aaa1d8ba7fc09e466156d2f38fd2f883bb21bd5ff82`). `AcrPull` was granted to the `pca` system-assigned identity.

The `pca` sitecontainer was pointed to the image using `SystemIdentity` and port 4001, but App Service repeatedly failed image pull/startup (manifest/pull diagnostics); `/health` returned 503 or timed out. A single-platform and tag-based retry produced the same result. To avoid leaving an unhealthy target, `pca` was restored to `mcr.microsoft.com/appsvc/staticsite:latest` on port 80 with `Anonymous` auth. `pcaSafe` was not modified.

## Database and runtime gates

```text
BACKEND_HEALTH=FAIL; deployment attempt returned 503/timeout and was rolled back
PRIVATE_DB_PATH=CONFIGURED_PRIVATE_ENDPOINT_BUT_PUBLIC_ACCESS_ENABLED
DB_TLS=SERVER_REQUIRE_SECURE_TRANSPORT_ON (TLSv1.2,TLSv1.3)
DB_RUNTIME_IDENTITY=NOT_PROVEN (expected pca_pro_app)
DB_SCHEMA=NOT_PROVEN against live pca_pro
DB_LEAST_PRIVILEGE=NOT_PROVEN at runtime
MIGRATION_0022_VALIDATION=NOT_EXECUTED; no safe disposable target/credentials authorized
```

The Azure MySQL server is Ready and has database `pca_pro`; live backend reachability, identity, schema fingerprint, and least-privilege grants cannot be validated before deployment.

## AUTH_B UAT

```text
SIGNUP=NOT_EXECUTED
EMAIL_VERIFICATION=NOT_EXECUTED
LOGIN=NOT_EXECUTED
LOGOUT=NOT_EXECUTED
PASSWORD_RESET=NOT_EXECUTED
SESSION_REVOCATION=NOT_EXECUTED
RATE_LIMITING=NOT_EXECUTED_LIVE
ENUMERATION_RESISTANCE=NOT_EXECUTED_LIVE
```

Local source/security tests remain prior evidence only; they cannot substitute for the real provider-backed production-style flow. No tokens, codes, passwords, or secrets are included here.

```text
P0_OPEN=0 (accepted engineering baseline; AUTH_B live gate blocked)
P1_OPEN=0 (accepted engineering baseline; AUTH_B live gate blocked)
P2_OPEN=0 (accepted engineering baseline; AUTH_B live gate blocked)
SMTP_ROTATION=PASS
BACKEND_SOURCE_SHA=21d0d9ff648f0ea995dbeddb55e7e327aee06904
BACKEND_IMAGE_TAG=auth-b-20260913-sp
BACKEND_IMAGE_DIGEST=sha256:a3feb4a8bddec77432f446b8bb00a6e04da9e7bb2f679bc52513a7e43f608d87
BACKEND_HEALTH=FAIL; App Service ACR manifest/pull failure after retries; pca rolled back to placeholder
AUTH_B=BLOCKED_BY_BACKEND_HEALTH
READY_FOR_PARENT_C=NO
```

Resume with an owner-approved correction to the pca-to-ACR pull path, then prove `/health`, private MySQL/TLS/runtime identity/schema, and execute the complete AUTH_B UAT. Do not start Parent C or modify `pcaSafe`.

## Supervisor continuation — ACR/sitecontainer diagnosis (2026-09-13)

Evidence-only commits `94b431c` and `00e3856` were independently audited: the only changed path is this supervision document, with no secret assignments, passwords, connection strings, tokens, private keys, or deployment source changes. They were pushed after reconciliation; `REMOTE_HEAD=00e3856fdd4c2f8f8fbc07ec834ffbead839ffb7`, `WORKTREE=CLEAN`.

`SMTP_ROTATION=PASS` was independently reconfirmed from Key Vault metadata. The new enabled version `749c5cf6bd92407794c2d687c2741e99` is newer than `243780f0c811435fb2c5340f566a677b`; no value was retrieved. The `pca` setting remains an unversioned reference to `pca-key/PCA-SMTP-PASSWORD`.

### ACR and identity findings

```text
ACR=pcaSafe (pcasafe.azurecr.io), publicNetworkAccess=Enabled, SKU=Basic
ACR_REPOSITORY=pca-backend
ACR_TAG=auth-b-20260913-sp
ACR_IMAGE_EXISTS=YES
ACR_DIGEST_MATCH=YES; sha256:a3feb4a8bddec77432f446b8bb00a6e04da9e7bb2f679bc52513a7e43f608d87
IMAGE_PLATFORM=linux/amd64
IMAGE_REVISION=21d0d9ff648f0ea995dbeddb55e7e327aee06904
MANAGED_IDENTITY=SystemAssigned; principal adc7c8de-7a4c-4f9c-9342-4104125085ab
ACR_PULL_AUTHORIZATION=AcrPull assignment present at registry scope; created 2026-09-13T17:26:17Z
```

The image exists in the intended registry and resolves to the expected digest/platform. The `pca` sitecontainer was configured as main, port 4001, `SystemIdentity`, with app-setting inheritance enabled and no registry password field. Azure activity confirms sitecontainer writes succeeded. Container-log classification nevertheless reports `IMAGE_PULL`/`MANIFEST_NOT_FOUND` and probe failure before application startup; no Node, MySQL, SMTP, or Key Vault application error was reached. The exact failing layer is therefore the App Service sitecontainer-to-ACR pull/auth path, not the backend image contents or application runtime.

No broad role was granted. The `AcrPull` assignment remains the sole correction applied. Repeated tag, digest, single-platform, and supported CLI `--si` retries produced the same pull failure, so no further blind retries were made. `pca` was restored to `mcr.microsoft.com/appsvc/staticsite:latest` on port 80 with `Anonymous` auth. `pcaSafe` was independently verified unchanged (public digest `sha256:c0b2b1b7…`, port 80).

## Final continuation state

```text
REMOTE_HEAD=00e3856fdd4c2f8f8fbc07ec834ffbead839ffb7
WORKTREE=CLEAN
SMTP_ROTATION=PASS
BACKEND_SOURCE_SHA=21d0d9ff648f0ea995dbeddb55e7e327aee06904
BACKEND_IMAGE_TAG=auth-b-20260913-sp
BACKEND_IMAGE_DIGEST=sha256:a3feb4a8bddec77432f446b8bb00a6e04da9e7bb2f679bc52513a7e43f608d87
ACR_IMAGE_EXISTS=YES
ACR_DIGEST_MATCH=YES
MANAGED_IDENTITY=SystemAssigned (adc7c8de-7a4c-4f9c-9342-4104125085ab)
ACR_PULL_AUTHORIZATION=ASSIGNED; EFFECTIVE_PULL_NOT_PROVEN
SITECONTAINER_AUTH_TYPE=SystemIdentity (rolled back to Anonymous placeholder)
SITECONTAINER_ROOT_CAUSE=IMAGE_PULL / MANIFEST_NOT_FOUND at App Service ACR boundary
ROOT_CAUSE_FIX=AcrPull assignment and SystemIdentity configuration applied; pull still fails, pca rolled back
BACKEND_HEALTH=FAIL
PRIVATE_DB_PATH=NOT_EXECUTED
DB_TLS=NOT_EXECUTED (Azure server transport requirement remains configured)
DB_RUNTIME_IDENTITY=NOT_EXECUTED
DB_SCHEMA=NOT_EXECUTED
DB_LEAST_PRIVILEGE=NOT_EXECUTED
MIGRATION_0022_VALIDATION=NOT_EXECUTED
AUTH_B=BLOCKED_BY_BACKEND_HEALTH
OLD_SMTP_CREDENTIAL_STATUS=ENABLED; do not revoke before real delivery proof
P0_OPEN=0 (engineering baseline)
P1_OPEN=0 (engineering baseline)
P2_OPEN=0 (engineering baseline)
READY_FOR_PARENT_C=NO
```

Per the supervisor gate, stop here. The next authorized action is an owner/platform correction for the `pca` App Service ACR pull path (or effective role propagation confirmation), followed by redeploying this same digest. Do not switch to plaintext registry credentials, do not revoke the old SMTP version, and do not start database or AUTH_B testing until `BACKEND_HEALTH=PASS`.

## Supervisor continuation — ABAC correction and live backend recovery (2026-09-13)

The preceding stop record is historical and is superseded by this continuation. No application source was changed. The only release mutation after diagnosis was an RBAC correction on the existing `pca` system-assigned identity; `pcaSafe` was not modified.

### Independent Azure verification

```text
SUBSCRIPTION=5f5205e2-4e56-4cea-8ce7-3d408ed1507b
TENANT=9d94b9fa-8bd6-420a-9d28-bfe2df02562a
ACR=pcaSafe (pcasafe.azurecr.io), roleAssignmentMode=AbacRepositoryPermissions
ACR_NETWORK=publicNetworkAccess=Enabled; anonymousPullEnabled=False; privateEndpointConnections=0
MANAGED_IDENTITY=SystemAssigned; principal=adc7c8de-7a4c-4f9c-9342-4104125085ab
ACR_LEGACY_ROLE=AcrPull (retained; not effective for ABAC repository authorization)
ACR_ABAC_ROLE=Container Registry Repository Reader; roleId=b93aa761-3e63-49ed-ac28-beffa264f7ac; assignment=542c1e8b-d02e-4dd6-8210-26da1a750ff7
ACR_ABAC_CATALOG_ROLE=Container Registry Repository Catalog Lister; roleId=bfdb9389-c9a5-478a-bb2f-ba9ca092c3c7; assignment=48e60fae-be2d-4a0d-a0f5-292380b1885a
ACR_ROLE_EFFECTIVE=PASS (subsequent pull and startup succeeded)
SITECONTAINER_PERSISTED_REGISTRY=pcasafe.azurecr.io
SITECONTAINER_PERSISTED_IMAGE=pcasafe.azurecr.io/pca-backend@sha256:a3feb4a8bddec77432f446b8bb00a6e04da9e7bb2f679bc52513a7e43f608d87
SITECONTAINER_AUTH_TYPE=SystemIdentity
SITECONTAINER_TARGET_PORT=4001
SITECONTAINER_MAIN=TRUE
SITECONTAINER_INHERIT_APP_SETTINGS=TRUE
```

The exact root cause was `ACR_RBAC_MODE_MISMATCH`: the registry's ABAC mode does not honor the legacy `AcrPull` role for repository pulls. The smallest proven fix was to add the two documented repository-scoped ABAC roles to the existing managed identity, then redeploy the same immutable digest. No registry password or alternate identity was introduced.

### Live backend and database checks

```text
PLATFORM_LOG_ERROR=HISTORICAL IMAGE_PULL/MANIFEST_NOT_FOUND before ABAC correction; no application crash reached; no current pull error after correction
BACKEND_HEALTH=PASS; GET https://api.pcasafe.com/health -> 200 {service:pca-backend,status:ok}
DB_CONNECTIVITY=PASS; GET /health/db -> 200 {status:ok,database:connected} (implementation performs SELECT 1 only)
EMAIL_PROVIDER_HEALTH=PASS; GET /health/email -> 200 {status:ok,provider:SMTP} (provider configured; no send attempted)
PCA_DATABASE_TLS_SETTING=REQUIRED (Key Vault-backed URL reference; setting value not exposed)
MYSQL_REQUIRE_SECURE_TRANSPORT=ON
MYSQL_TLS_VERSIONS=TLSv1.2,TLSv1.3
MYSQL_PRIVATE_ENDPOINT=Approved/Ready; private DNS zone group present; pca Swift VNet integration configured
MYSQL_PUBLIC_NETWORK_ACCESS=Enabled (private path configured, not exclusive)
DB_RUNTIME_IDENTITY=NOT_PROVEN (expected pca_pro_app; /health/db intentionally exposes no identity)
DB_SCHEMA=NOT_PROVEN against live pca_pro
DB_LEAST_PRIVILEGE=NOT_PROVEN at runtime
MIGRATION_0022_VALIDATION=NOT_EXECUTED; no safe disposable target/credentials authorized
```

The live health endpoint proves application startup and a database `SELECT 1`, not the negotiated MySQL identity, TLS session, schema fingerprint, grants, or migration state. Those items remain honestly unclaimed.

### AUTH_B live-UAT boundary

Unauthenticated route-contract probes reached the live backend without creating an account or sending mail: the six AUTH_B POST routes returned validation responses (`400` for empty JSON on register, login, verify-email, reset-request, reset-password; `204` for logout), and `/api/parent/session` returned `401` without a cookie. A real provider-backed signup, inbox verification, login, reset, and session-revocation run was not executed because no owner-supplied test identity/inbox and verification/reset codes were available. No token, code, password, or secret was retrieved or recorded.

```text
SMTP_ROTATION=PASS (versions 243780f0c811435fb2c5340f566a677b and 749c5cf6bd92407794c2d687c2741e99 both enabled; replacement is newer/current; values never retrieved)
BACKEND_HEALTH=PASS
DB_RUNTIME_PROOF=PARTIAL (connectivity, server TLS requirement, private endpoint, and app TLS setting proven; runtime identity/schema/grants/migration not proven)
AUTH_B=NOT_EXECUTED_FULL_LIVE_UAT; route-contract probes only
READY_FOR_PARENT_C=NO
OLD_SMTP_CREDENTIAL_STATUS=ENABLED; retain until real SMTP send and owner revocation decision
pcaSafe=UNCHANGED; image digest sha256:c0b2b1b710adfb3bf9756a1f61c08fb6167a421f7c14efd528d116c5677b8782, target port 80
```

The backend remains deployed only to `pca`. Parent C is not started.

### Required supervisor fields

```text
REMOTE_HEAD=f17ce13e206f79bc419b7da6a96c7179789f1104
LOCAL_EVIDENCE_HEAD=529fd07404e17e578829bcaf00f1ea00f3d6f2f0 (docs-only, not pushed)
WORKTREE=CLEAN (branch ahead of origin by one evidence-only commit)
SMTP_ROTATION=PASS
ACR_AUTHORIZATION_MODE=AbacRepositoryPermissions
ACR_NETWORK_STATE=publicNetworkAccess=Enabled; anonymousPullEnabled=False; privateEndpointConnections=0
ACR_ROLE_EFFECTIVE=PASS
SITECONTAINER_PERSISTED_REGISTRY=pcasafe.azurecr.io
SITECONTAINER_PERSISTED_IMAGE=pcasafe.azurecr.io/pca-backend@sha256:a3feb4a8bddec77432f446b8bb00a6e04da9e7bb2f679bc52513a7e43f608d87
SITECONTAINER_AUTH_TYPE=SystemIdentity
PLATFORM_LOG_ERROR=RESOLVED; historical IMAGE_PULL/MANIFEST_NOT_FOUND ceased after ABAC roles and redeploy
ROOT_CAUSE=ACR_RBAC_MODE_MISMATCH (legacy AcrPull not honored by ABAC repository-permissions mode)
ROOT_CAUSE_FIX=Added Repository Reader and Catalog Lister to existing pca managed identity; redeployed same immutable digest
BACKEND_HEALTH=PASS
DB_RUNTIME_PROOF=PARTIAL; identity/schema/grants/migration remain unproven
AUTH_B=NOT_EXECUTED_FULL_LIVE_UAT; safe route-contract probes only
READY_FOR_PARENT_C=NO
pcaSafe=UNCHANGED
```
