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
