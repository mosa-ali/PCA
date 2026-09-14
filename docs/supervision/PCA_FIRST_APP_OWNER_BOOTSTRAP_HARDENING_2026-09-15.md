# PCA first APP_OWNER bootstrap hardening — source/test review

Date: 2026-09-15  
Scope: source and test readiness only. No bootstrap execution, production database mutation, Azure mutation, or deployment was performed.

## Decisions and controls

- `bootstrap-platform-owner.mjs` acquires the fixed MySQL advisory lock `pca:first-app-owner-bootstrap` before checking for an active APP_OWNER and holds it through account creation and activation issuance. Lock acquisition failure is fail-closed and release is attempted in `finally`.
- The account/role/MFA/audit rows remain in the existing `MySqlPlatformAdminAuthRepository.createAccount` transaction. The account starts with `PCA_PENDING_FIRST_OWNER_ACTIVATION`, a deliberately malformed non-login credential, and `PENDING_SETUP` MFA.
- Activation uses the existing hash-only token repository, 30-minute expiry, revocation/reissue semantics, encrypted MFA enrollment, first-code activation, and atomic completion. The script sends through `EmailService` and the configured encrypted outbox/provider path.
- No password, TOTP secret, otpauth URI, token, connection string, or environment dump is printed. The direct script summary contains only provider name and an issuance status.
- Existing Platform Admin activation and realm separation remain unchanged; no duplicate account is created and no production account is modified by this review.

## Validation status

BOOTSTRAP_ZERO_OWNER_PRECONDITION=SOURCE_PASS  
BOOTSTRAP_SERIALIZATION=SOURCE_PASS  
BOOTSTRAP_CONCURRENT_SINGLE_WINNER=DB_TEST_NOT_EXECUTED  
BOOTSTRAP_CREATION_ATOMICITY=SOURCE_PASS  
BOOTSTRAP_PASSWORD_MODEL=NON_LOGIN_PLACEHOLDER_THEN_OWNER_SCRYPT_ACTIVATION  
PASSWORD_PRINTED=NO  
BOOTSTRAP_MFA_INITIAL_STATUS=PENDING_SETUP  
BOOTSTRAP_MFA_STORAGE=AES256_GCM_VIA_EXISTING_ACTIVATION_FLOW  
TOTP_SECRET_PRINTED=NO  
OTPAUTH_URI_PRINTED=NO  
FIRST_OWNER_ACTIVATION_TOKEN_HASH_ONLY=SOURCE_PASS  
FIRST_OWNER_ACTIVATION_EXPIRY=SOURCE_PASS  
FIRST_OWNER_ACTIVATION_SINGLE_USE=SOURCE_PASS  
FIRST_OWNER_ACTIVATION_EMAIL_PATH=SOURCE_PASS_DURABLE_OUTBOX  
FIRST_OWNER_REISSUE_RECOVERY=EXISTING_ACTIVATION_REISSUE_PATH  
BOOTSTRAP_AUDIT=SOURCE_PASS  
BOOTSTRAP_SECRET_AUDIT_LEAKAGE=SOURCE_PASS_NONE  
PRE_ACTIVATION_LOGIN=SOURCE_PASS_DENIED_BY_MALFORMED_CREDENTIAL_AND_PENDING_MFA  
FIRST_OWNER_POST_ACTIVATION_LOGIN=SOURCE_PATH_READY_NOT_LIVE  
EXISTING_PLATFORM_ADMIN_UNCHANGED=YES_SOURCE_ONLY  

The repository-wide TypeScript no-emit check reported no Platform Admin or credential type errors. The normal build/test execution remains blocked by the known Windows `backend/dist` EPERM/locked-output condition; no source workaround was applied. Database-backed concurrency/rollback tests and provider delivery were not executed.

SCHEMA_CHANGED=NO  
MIGRATION_ADDED=NO  
BOOTSTRAP_EXECUTION_AUTHORIZED=NO  
PRODUCTION_CHANGED=NO  
DEPLOYED=NO
