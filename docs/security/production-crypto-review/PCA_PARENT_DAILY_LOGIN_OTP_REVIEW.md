# PCA Parent Daily Login Email OTP — Independent Review Handoff

Status: source and test implementation only; pre-production.

Baseline: `4a080a17955fe3d217508ba2acfa07cb0bbfc7a5`

## Scope

This change adds a daily Parent Web login assurance flow without changing
registration or email verification. A valid password login without a valid
browser grant sends the existing hash-only login step-up code and establishes
no session. Successful code completion establishes the session and one
browser-bound daily grant.

The grant is an opaque 32-byte random token. Only a domain-separated SHA-256
hash is persisted in `parent_daily_login_grants`; the raw value is returned
only to the HTTP layer for an HttpOnly cookie. The grant is account-bound,
expires after 24 hours of server time, and is not bound to IP address or a
browser fingerprint. No authoritative account timezone is introduced.

In production-sensitive runtimes the cookie is host-only using the `__Host-`
prefix, `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`. The browser
grant is separate from session tokens, email verification codes,
password-reset codes, and FAMILY_GENESIS authorization.

## Revocation and fail-closed behavior

- Logout revokes the current session and presented browser grant.
- Revoke-all revokes all service sessions and all daily grants for the account.
- Password reset revokes all daily grants and service sessions.
- Expired, revoked, malformed, cross-account, disabled-account, or suspended-
  family attempts do not bypass the OTP gate.
- If grant persistence is unavailable, the successful OTP does not leave a
  usable authenticated session behind.
- Registration and email verification do not create a daily grant.
- A daily grant is not evidence for PCA-DEC-020-R2 family genesis or first-
  device proof; fresh dedicated password, mailbox, and session evidence remain
  required for that security decision.

## Review checklist

An independent reviewer should confirm:

1. token generation, domain separation, hash-only persistence, and entropy;
2. atomic expiry/revocation/account checks and concurrent-use behavior;
3. cookie scope and production transport attributes;
4. session issuance ordering and fail-closed persistence handling;
5. logout, revoke-all, reset, disabled-account, and suspended-family
   invalidation;
6. unchanged signup and verification semantics;
7. separation from PCA-DEC-020-R2 genesis authorization and proof;
8. migration safety and absence of production execution in this lane.

## Evidence

- Backend focused OTP/grant/routes/cookie tests: PASS (73 tests).
- Full backend non-DB suite: PASS (2,402 tests).
- Parent Web OTP component test: PASS (5 tests).
- Parent Web build and lint: PASS.
- Disposable bootstrap generation/check: PASS.
- Full Parent Web suite: 1,031 passed, 5 failed; the failures are in the
  preserved guide/editorial worktree and existing Members timing behavior, not
  the OTP component. No unrelated guide/editorial files are part of this lane.

No Azure, production database, migration execution, production deployment, or
cryptographic verifier activation is authorized by this source-only change.
Independent security review and the separate production release gates remain
pending.
