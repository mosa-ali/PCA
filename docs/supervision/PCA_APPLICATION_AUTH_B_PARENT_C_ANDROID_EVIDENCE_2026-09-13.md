# PCA Application Completion — AUTH_B → PARENT_C → ANDROID_D Evidence

Date: 2026-09-13  
Branch: `pca-dev`  
Accepted engineering source SHA: `96887770a55c8d4cbf44f7cbc4c9cea5681ac8f2`  
Evidence commit source SHA: `ed5e2cad40673e3658929e8ee7ec9bba5bf15451`

## Release decision

`OVERALL_RELEASE_AUTHORIZATION=NOT_AUTHORIZED`  
`AUTH_B=BLOCKED`  
`PARENT_C=BLOCKED_BY_AUTH_B`  
`ANDROID_D=BLOCKED_BY_AUTH_B_AND_PHYSICAL_DEVICE_GATE`  
`BACKEND_DEPLOYMENT=STOPPED_BEFORE_MUTATION`  
`PUBLIC_A=UNCHANGED_OUT_OF_SCOPE`

The required SMTP rotation gate cannot pass. Azure Key Vault `pca-key` contains one enabled `PCA-SMTP-PASSWORD` version (created/updated 2026-09-07) and no replacement credential was proven. The sole version is the historically compromised Mailgun credential version identified by the programme. No secret value was read or recorded, and the compromised credential was not reused. Per the release programme, work stops before backend image build/push/deployment.

## Azure discovery (read-only)

Subscription: `5f5205e2-4e56-4cea-8ce7-3d408ed1507b`  
Tenant: `9d94b9fa-8bd6-420a-9d28-bfe2df02562a`

Backend target is App Service `pca` in resource group `AppWenPlan` (domains include `api.pcasafe.com`, `platform.pcasafe.com`, `parent.pcasafe.com`, and `app.pcasafe.com`). It is running HTTPS-only with minimum TLS 1.2 and VNet integration, but its authoritative sitecontainer remains the anonymous placeholder image `mcr.microsoft.com/appsvc/staticsite:latest`, target port 80, with no health-check path. Live `/health` and `/healthz` checks returned 404 from the placeholder. Therefore no backend source image was built, pushed, or deployed.

Backend configuration references Key Vault for the database URL and protected secrets; SMTP provider/settings are present. `PCA_DATABASE_TLS=REQUIRED` is configured. No secret values were printed.

MySQL `pca-mysql` is Ready (8.4); database `pca_pro` exists. `require_secure_transport=ON` and TLS versions are `TLSv1.2,TLSv1.3`. A private endpoint and private-DNS VNet link are configured and approved, but `publicNetworkAccess=Enabled` and an external firewall rule remain. No safe disposable target or authorized credentials were available for live migration/schema validation, so migration 0022 and current schema parity are `NOT_EXECUTED`.

Public App Service `pcaSafe` in `pca-group` was not mutated. Its pinned public image, domain, and configuration remain outside this application programme.

## Local source validation

- Parent Web focused suite: **84/84 passed** (privacy boundary, family authority/data gateways, Safe Zone client, EN/AR locale, RTL, and axe checks).
- Backend focused suite: **69/69 passed** with `test.env` (cross-realm token rejection, Platform Admin RBAC, Parent Safe Zone, web-rule scoping, and schema privacy).
- Android `:app:testDebugUnitTest`: **BUILD SUCCESSFUL**.
- Android static boundary checks: **PASS**.
- Android `:app:assembleRelease`: **BUILD SUCCESSFUL**, but output is unsigned (`app-release-unsigned.apk`).

These are source/local results only. They do not substitute for live Auth B, authenticated Parent C, or physical-device validation.

## Required live gates not executed

`EMAIL_VERIFICATION=NOT_EXECUTED`  
`PASSWORD_RESET=NOT_EXECUTED`  
`BACKEND_LIVE_HEALTH=BLOCKED_PLACEHOLDER_RUNTIME`  
`MYSQL_0022_LIVE_VALIDATION=NOT_EXECUTED`  
`FAMILY_ISOLATION=LOCAL_TEST_PASS_LIVE_NOT_EXECUTED`  
`IDOR=LOCAL_TEST_PASS_LIVE_NOT_EXECUTED`  
`PLATFORM_ADMIN_REALM_SEPARATION=LOCAL_TEST_PASS_LIVE_NOT_EXECUTED`  
`ANDROID_AUTH_INTEGRATION=NOT_EXECUTED`  
`ANDROID_PHYSICAL_DEVICE_UAT=OWNER_ACTION_REQUIRED`  
`ANDROID_RELEASE_SIGNING=OWNER_ACTION_REQUIRED`  
`CAMERA_PROXIMITY_PLAY_PROVIDER_UAT=OWNER_ACTION_REQUIRED`

The production Android default remains the fail-closed `OfflineFamilySyncRuntimePort`; no unsafe fallback was introduced. The known engineering `G41=UNRESOLVED` item and external crypto/provider/settlement/iOS gates remain open as previously recorded.

## Gate outputs

```text
SMTP_ROTATION=OWNER_ACTION_REQUIRED
REPLACEMENT_CREDENTIAL=NOT_PROVEN
COMPROMISED_SMTP_REUSED=NO
BACKEND_SOURCE_SHA=NOT_BUILT_DUE_SMTP_GATE
BACKEND_IMAGE_TAG=NOT_BUILT
BACKEND_IMAGE_DIGEST=NOT_BUILT
AZURE_BACKEND_TARGET=pca (AppWenPlan)
AZURE_PUBLIC_TARGET=pcaSafe (pca-group), UNCHANGED
PRIVATE_DB_PATH=CONFIGURED_BUT_PUBLIC_ACCESS_ENABLED
DB_TLS=SERVER_REQUIRE_SECURE_TRANSPORT_ON
MIGRATION_0022_VALIDATION=EXTERNAL_OR_ENVIRONMENT_GATE
PARENT_C=BLOCKED_BY_AUTH_B
ANDROID_D=BLOCKED
LEGAL_STATUS=OWNER_DECISION (Public legal publication is out of scope here)
PUBLIC_A=UNCHANGED_OUT_OF_SCOPE
READY_FOR_FINAL_APPLICATION_ACCEPTANCE=NO
READY_FOR_APPLICATION_PROGRAMME=NO
```

## Owner actions required to resume

1. Rotate `PCA-SMTP-PASSWORD` in `pca-key` using a new, verified credential; retain the old compromised version disabled/revoked and record rotation evidence without exposing values.
2. Re-run the AUTH_B gate (verification email and password reset) against the deployed backend before any Parent or Android live acceptance.
3. Build a fresh backend image from the approved source SHA and deploy only to App Service `pca`; then validate `/health`, `/health/db`, migration 0022/schema parity, and authenticated Parent C flows.
4. Provide release-signing material and a physical Android device for Android D UAT, including camera/proximity, Play/provider, and live-backend checks.

No backend deployment was begun. STOP.
