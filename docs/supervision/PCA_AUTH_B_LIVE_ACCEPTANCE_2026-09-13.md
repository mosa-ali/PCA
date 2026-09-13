# PCA AUTH_B Live Acceptance — Stop Record

Date: 2026-09-13  
Branch: `pca-dev`  
Engineering accepted SHA: `96887770a55c8d4cbf44f7cbc4c9cea5681ac8f2`

## Decision

`AUTH_B=BLOCKED`  
`BACKEND_DEPLOYMENT=NOT_STARTED`  
`READY_FOR_PARENT_C=NO`  
`STOP=YES`

The mandatory SMTP rotation gate failed. Read-only Azure Key Vault metadata shows one enabled `PCA-SMTP-PASSWORD` version, created and updated 2026-09-07, with no replacement version. Its identifier is the known compromised historical version `243780f0c811435fb2c5340f566a677b`. No secret value was read, printed, committed, or deployed.

### Resume attempt (2026-09-13)

After the owner reported rotation, `git fetch origin` reconciled `pca-dev` at `ac10734634c8f90f37932473243346f5ce4d3214` with a clean worktree. A fresh read-only Key Vault check still returned exactly one enabled version, `243780f0c811435fb2c5340f566a677b`; the active secret metadata therefore remains the compromised historical version. The `pca` app setting is present and uses an unversioned Key Vault reference, but no distinct active version exists for it to resolve. `SMTP_ROTATION=BLOCKED; REPLACEMENT_NOT_PROVEN` and the stop-before-deployment rule remains in force.

## Required owner action package

1. In the Mailgun account, create a new SMTP credential for the approved sending identity `support@mail.pcasafe.com` (host `smtp.mailgun.org`, port `587`, STARTTLS / `secure=false`).
2. Store only the new credential in Azure Key Vault `pca-key`, secret `PCA-SMTP-PASSWORD`, as a new active version. Do not paste the password, API key, token, connection string, or any other secret into chat, tickets, commits, or evidence.
3. Preserve the configured sender and reply-to addresses: `support@mail.pcasafe.com` and `support@pcasafe.com`.
4. Return confirmation containing only: new Key Vault version identifier (or creation timestamp), enabled status, and confirmation that it differs from the historical version. Do not include the secret value.

The old credential must not be used. Do not revoke it until replacement functionality has been independently proven; record revocation as a follow-up owner action.

## Reconciliation

```text
APPLICATION_SOURCE_SHA=b0c72f0f089833ce82ac2ed86ad5fad7b8f63c1e
REMOTE_HEAD=b0c72f0f089833ce82ac2ed86ad5fad7b8f63c1e
WORKTREE=CLEAN
SMTP_ROTATION=OWNER_ACTION_REQUIRED
OLD_SMTP_CREDENTIAL_REUSED=NO
OLD_SMTP_CREDENTIAL_REVOCATION=NOT_YET; wait for replacement proof
BACKEND_SOURCE_SHA=NOT_BUILT_DUE_SMTP_GATE
BACKEND_IMAGE_TAG=NOT_BUILT
BACKEND_IMAGE_DIGEST=NOT_BUILT
BACKEND_AZURE_TARGET=pca (AppWenPlan)
```

The backend App Service `pca` remains on the anonymous static-site placeholder image. No build, ACR push, or deployment mutation was performed. `pcaSafe` was not inspected for mutation and remains out of scope.

## Database and runtime gates

```text
BACKEND_HEALTH=BLOCKED; placeholder /health and /healthz return 404
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
AUTH_B=BLOCKED
READY_FOR_PARENT_C=NO
```

Resume only after the owner proves a different active SMTP secret version. Then independently verify Key Vault resolution by the `pca` managed identity, build and deploy a fresh backend image only to `pca`, prove private MySQL/TLS/runtime identity/schema, and execute the complete AUTH_B UAT. Do not start Parent C or modify `pcaSafe`.
