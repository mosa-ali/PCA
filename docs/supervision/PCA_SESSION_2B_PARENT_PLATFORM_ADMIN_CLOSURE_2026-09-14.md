# PCA Session 2B — Parent / Platform Admin Closure Evidence

Source-only review at commit `1333ae0713abd134ed44d46553eca549f68d4b78`.
No Azure resource, production database, account, secret, or deployment was
modified in this session.

## Platform Admin activation

- First-time activation uses a 32-byte random bearer token; only SHA-256
  `token_hash` is persisted in `platform_admin_activation_tokens`.
- Tokens carry explicit purpose, expiry, revocation, and `used_at` state.
- APP_OWNER reissue revokes unused prior tokens and clears pending encrypted
  TOTP material in the same transaction.
- Activation start is single-winner under a row lock and generates a fresh
  AES-256-GCM encrypted TOTP secret.
- Completion uses the existing scrypt password implementation and atomically
  commits password, MFA ACTIVE state, accepted TOTP counter, token use, and
  audit event. Any guarded mutation failure throws `SoftFailure`, forcing
  rollback before the boolean failure result is returned.
- Public activation errors are generic and the route is outside the normal
  Platform Admin session realm; Parent and Platform Admin sessions remain
  separate.
- EN/AR activation UI clears the token from the address bar/history and keeps
  it only in page memory.

Source gate values:

`ATOMIC_COMPLETION=PASS`
`PARTIAL_STATE_ROLLBACK=PASS`
`ACTIVATION_TOKEN_HASH_ONLY=PASS`
`ACTIVATION_TOKEN_EXPIRY=PASS`
`ACTIVATION_TOKEN_SINGLE_USE=PASS`
`ACTIVATION_REISSUE_RECOVERY=PASS`
`OLD_TOKEN_INVALIDATION=PASS`
`OLD_TOTP_INVALIDATION=PASS`
`TOTP_REPLAY_PROTECTION=PASS`
`PASSWORD_SCRYPT=PASS`
`MFA_AES256_GCM=PASS`
`ENUMERATION_RESISTANCE=PASS`

Reissue is the lost-QR recovery boundary: unused tokens are revoked and
pending encrypted TOTP material is cleared before a replacement is inserted.
The in-memory regression test covers this sequence; production account state
was not queried or changed.

## Public Sign-In source

The public artifact now emits a non-indexable EN/AR `/sign-in/` chooser and a
visible header/mobile-menu `Sign In` control. It contains only exact relative
handoffs to `/parent/login/` and `/platform-admin/login/`; no auth form, signup,
recovery route, shared token, `/parent/admin`, or `isAdmin` shortcut was added.
The static link gate allows only those two separately deployed realm handoffs.

`PUBLIC_SIGNIN_SOURCE=PASS`
`PARENT_SIGNIN_DESTINATION=TOPOLOGY_AND_LIVE_UAT_PENDING`
`PLATFORM_ADMIN_SIGNIN_DESTINATION=TOPOLOGY_AND_LIVE_UAT_PENDING`
`EN_AR=SOURCE_PARITY_PASS`
`RESPONSIVE=SOURCE_LAYOUT_PENDING_BROWSER_UAT`
`ACCESSIBILITY=SOURCE_SEMANTICS_PENDING_BROWSER_UAT`
`BROWSER_UAT=BLOCKED`
`PUBLIC_DEPLOYED=NO`

## Owner and live gates

`ACTIVE_APP_OWNER_EXISTS=UNVERIFIED` (no production account query was run).
`PLATFORM_ADMIN_ACTIVATION=SOURCE_READY_OWNER_ACTION_REQUIRED`.
`AUTH_B=OWNER_TEST_IDENTITY_REQUIRED`.
`DB_RUNTIME_PROOF=PARTIAL`.
`PARENT_C=NOT_STARTED`.
`READY_FOR_ANDROID_D=NO`.

`FIRST_APP_OWNER_BOOTSTRAP_REQUIRED=UNVERIFIED`.
`PLATFORM_ADMIN_EXISTS=OWNER_STATED_YES_UNVERIFIED`.
`PLATFORM_ADMIN_ROLE=OWNER_STATED_PLATFORM_ADMIN`.
`PLATFORM_ADMIN_MFA_STATUS=OWNER_STATED_PENDING_SETUP`.

## Validation

- Backend TypeScript no-emit: PASS.
- Platform Admin Web typecheck and lint: PASS.
- Public `node build.mjs --check-only`: PASS (EN/AR parity, 30 contrast pairs,
  forbidden-claim, metadata and exact handoff link gates; 18 pages rendered in
  memory).
- Public changed-module `node --check`: PASS; direct EN/AR chooser render:
  PASS.
- Activation unit test added and registered; execution is blocked by the
  existing Windows `EPERM` lock while writing `backend/dist`.
- Public static tests/adversarial artifact pass remain blocked by the locked
  `public-web/dist` and existing esbuild/Node `spawn EPERM`; no generated files
  were deleted or overwritten to bypass this.
- Parent Web tests/build, DB-backed runtime tests, and real-browser UAT were not
  executed in this source-only session.

## Parent C, family isolation, privacy and live gates

`AUTH_B=OWNER_TEST_IDENTITY_REQUIRED`
`REAL_EMAIL_DELIVERY=NOT_EXECUTED`
`SMTP_REPLACEMENT_PROVED=NOT_EXECUTED_THIS_SESSION`
`DB_RUNTIME_PROOF=PARTIAL`
`RUNTIME_DB_ACCOUNT=UNVERIFIED`
`ACTIVE_DB=UNVERIFIED`
`TLS=UNVERIFIED`
`PRIVATE_PATH=UNVERIFIED`
`SCHEMA_COUNTS=UNVERIFIED`
`SCHEMA_FINGERPRINT=UNVERIFIED`
`MIGRATION_0022=UNVERIFIED`
`LEAST_PRIVILEGE=UNVERIFIED`
`DIAGNOSTIC_CLEANUP=NOT_EXECUTED`
`PARENT_C=NOT_STARTED`
`FREE_BASIC_ENROLLMENT=SOURCE_NOT_REVIEWED_THIS_SESSION`
`PARENT_SESSION=NOT_EXECUTED`
`FAMILY_CONTEXT=NOT_EXECUTED`
`CHILD_PROFILE=NOT_EXECUTED`
`DEVICE_ENROLLMENT=NOT_EXECUTED`
`REQUESTS=NOT_EXECUTED`
`POLICY_SETTINGS=NOT_EXECUTED`
`CROSS_FAMILY_READ=NOT_EXECUTED`
`CROSS_FAMILY_WRITE=NOT_EXECUTED`
`CROSS_FAMILY_DEVICE=NOT_EXECUTED`
`CROSS_FAMILY_REQUEST=NOT_EXECUTED`
`EXISTENCE_ORACLE=NOT_EXECUTED`
`PRIVACY_INVARIANTS=PRESERVED_SOURCE_REVIEW`
`A012=FAIL_CLOSED_PENDING_APPROVED_DURABLE_ENCRYPTED_POLICY`

## Release gate

`PLATFORM_ADMIN_READY=SOURCE_READY_OWNER_ACTION_REQUIRED`
`AUTH_B_READY=NO`
`DB_RUNTIME_READY=NO`
`PARENT_C_READY=NO`
`PUBLIC_SIGNIN_READY=SOURCE_ONLY_BROWSER_AND_DEPLOYMENT_PENDING`
`READY_FOR_ANDROID_D=NO`

No Azure resource, production database, account, secret, or deployment was
modified in this session. Genuine blockers are owner-controlled activation,
separate AUTH_B inbox/provider UAT, DB runtime diagnostic evidence and cleanup,
and real-browser/public deployment authorization. Do not start Parent C live
acceptance or Android D.

## Next controlled action

Supervisor review of this source commit, followed by explicit owner
authorization for deployment and local completion of the real administrator's
activation ceremony. No deployment is authorized by this document.
