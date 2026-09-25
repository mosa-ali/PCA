# PCA implementation decision 003 — parent account identity and family service session

> **Historical decision, superseded for the Parent family, authority and MFA
> journey by [PCA-DEC-037](PCA_DEC_037_PARENT_TOTP_MFA_REPLACES_GENESIS.md).**
> Keep this record for the 2026-08-15 registration and session architecture
> context. Its Genesis provisioning and owner-attestation billing requirements
> are retired and are not normative for current implementation.

| Field | Record |
|---|---|
| Original status | Accepted for PCA-AUTH-SESSION-1, Round 5 (`FAMILY_SERVICE_SESSION_V1`) |
| Original date | 2026-08-15 |
| Current authority | PCA-DEC-037, explicit owner architecture decision dated 2026-09-24; recovery hold selected 2026-09-25 |
| Current identity model | Account + verified email + password + TOTP MFA |
| Current family provisioning | Transactional, idempotent server-side provisioning at first authenticated login, as specified in PCA-DEC-037 |

## Current implementation authority

Use PCA-DEC-037 for the active Parent registration, email verification,
first-login family provisioning, account notifications, three-day MFA grace,
TOTP enrollment, every-login MFA, MFA recovery, and commercial-owner step-up
contracts. The current family membership role remains the existing
`ADMINISTRATOR` contract; server-side provisioning does not use a browser
Genesis ceremony or device-held signing key.

Use `PCA_ADDENDUM_003_PARENT_IDENTITY_REGISTRATION_FREE_ACCESS.md` only for
FREE_ACCESS and entitlement details that PCA-DEC-037 does not supersede. The
Parent service-session cookie, CSRF, account scope, password-hash, and secret
handling requirements remain governed by their current implementations and
tests; this historical record is not an override for those contracts.

## Retired requirements

The following statements from the original decision are retained in repository
history only and must not be implemented or treated as release gates:

- family creation through Parent Genesis, `GenesisAnchorStore`, or a Genesis
  owner-attestation chain;
- deriving commercial ownership from the former Genesis authority proof;
- any Genesis route, challenge, verifier, device-key custody, or step-up path.

Genesis database structures are retired without destructive production cleanup.
Their production presence and row counts require read-only reconciliation; see
PCA-DEC-037 and the release gate. Shared device-signature and family-authority
components remain where they serve non-Parent-Genesis consumers.
