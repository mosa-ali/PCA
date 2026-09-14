# PCA Session 2B — Parent / Platform Admin Closure Evidence

Source-only review at commit `e6bcfa12f2370654743c97875decebc5883671a8`.
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

## Owner and live gates

`ACTIVE_APP_OWNER_EXISTS=UNVERIFIED` (no production account query was run).
`PLATFORM_ADMIN_ACTIVATION=SOURCE_READY_OWNER_ACTION_REQUIRED`.
`AUTH_B=OWNER_TEST_IDENTITY_REQUIRED`.
`DB_RUNTIME_PROOF=PARTIAL`.
`PARENT_C=NOT_STARTED`.
`READY_FOR_ANDROID_D=NO`.

## Validation

- Backend TypeScript no-emit: PASS.
- Platform Admin Web typecheck and lint: PASS.
- Activation unit test added and registered; execution is blocked by the
  existing Windows `EPERM` lock while writing `backend/dist`.
- Web Vitest execution remains blocked by the existing esbuild `spawn EPERM`.

## Next controlled action

Supervisor review of this source commit, followed by explicit owner
authorization for deployment and local completion of the real administrator's
activation ceremony. No deployment is authorized by this document.
