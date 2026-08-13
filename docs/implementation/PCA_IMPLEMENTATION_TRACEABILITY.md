# PCA Implementation Traceability

## Control and counting

| Inventory | Count | Authority | Status |
|---|---:|---|---|
| Base A-100 | 199 | [Architecture traceability matrix](../architecture/32_TRACEABILITY_ACCEPTANCE_MATRIX.md) | Immutable accepted baseline; implementation evidence pending |
| Addendum 001 | 25 | [Secure invite/protected enrollment addendum](addenda/PCA_ADDENDUM_001_SECURE_INVITE_PROTECTED_ENROLLMENT.md) | Owner approved; implementation evidence pending |
| Total implementation authority | 224 | Base A-100 + approved addenda | No requirement is implemented merely by appearing here |

`BASE_A100_REQUIREMENTS = 199` is not edited or recounted by this file. This is the implementation-facing index for approved addenda and eventual evidence. IDs are exact: duplicate IDs, missing IDs, orphan IDs, or a status claiming evidence without linked artifacts are gate failures.

## Addendum 001 implementation matrix

All rows are `NOT_IMPLEMENTED`; planned paths are ownership targets, not evidence of existing code. `PCA-15` entries require macOS/Xcode and applicable Apple authorization before platform validation can pass.

| Requirement | Primary phase(s) | Backend / database coverage | Client / security coverage | Planned test evidence | Status |
|---|---|---|---|---|---|
| PCA-ADD-ENR-001 | PCA-10 | Invitation create command carries opaque selected IDs | Parent form/RBAC validation | Parent panel contract and validation tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-002 | PCA-1, PCA-10 | Create opaque invitation and short-code mapping | Link/QR rendering without secrets | URL/QR/fallback-code absence tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-003 | PCA-1, PCA-10 | Reject secret-bearing fields | Redaction boundary | Synthetic-secret absence tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-004 | PCA-1 | Verifier/hash, TTL, scope, revocation fields | No client token persistence beyond flow need | Entropy, expiry, verifier and revocation tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-005 | PCA-1 | `enrollment_invitations` transition/audit records | Lifecycle presentation | State-machine/property and migration tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-006 | PCA-1 | Atomic redemption/idempotency record | Fail-closed redemption UI | Concurrent redeem, reuse, expiry, revocation tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-007 | PCA-10 | Status/revoke endpoint with bounded metadata | Parent invitation status/revoke UI | Authorization and token-nondisclosure tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-008 | PCA-1 | Continuation exchange only | Android App Link/store continuation | Android Standard flow/negative silent-install tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-009 | PCA-2 | Capability attestation record only | Android managed provisioning/DPC gate | Managed-authority and Standard fallback tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-010 | PCA-15 | Continuation exchange only | iOS Universal Link and authorization gate | Xcode simulator/entitlement negative tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-011 | PCA-10, PCA-16 | None beyond capability state | Child transparency/accessibility/RTL | UX, accessibility, Arabic/English tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-012 | PCA-10, PCA-13 | No raw-PIN storage | Parent Security panel | PIN policy/UI tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-013 | PCA-10, PCA-11, PCA-13 | Authorized parent-device records | Step-up and recovery selection | Authorization-path tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-014 | PCA-13 | Salted verifier/rate-limit state; no raw PIN | Local PIN entry | KDF, throttle, delay and lockout-recovery tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-015 | PCA-13, PCA-17 | Redacted persistence/observability | No secret UI serialization | Logs/push/API/support-bundle privacy absence tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-016 | PCA-10, PCA-11, PCA-13 | Removal-request lifecycle record | Child request and local approval flows | Request-path and capability-gate tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-017 | PCA-10, PCA-11 | Decision status/metadata record | Parent decision panel | Decision UI/RBAC/audit tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-018 | PCA-11, PCA-13 | Opaque signed envelope/delivery receipt | Signature/expiry/replay verification | Wrong-parent, substitution, replay and expiry tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-019 | PCA-2, PCA-10, PCA-13, PCA-15 | Capability state record | Honest protection-status card | Standard/Protected/degraded/not-supported tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-020 | PCA-11, PCA-13 | Opaque relay/delivery metadata only | E2EE alert display and minimized push | Alert trigger, payload absence and E2EE tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-021 | PCA-10, PCA-13, PCA-15 | None | Emergency access in all relevant states | Emergency-floor regression/accessibility tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-022 | PCA-1, PCA-11 | Minimal enrollment/relay schema | No plaintext service submission | DB schema and privacy-sentinel tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-023 | PCA-1 | Migrations, constraints, transaction and expiry worker | Correlation display only when safe | Clean DB migration, concurrency, lifecycle tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-024 | PCA-1, PCA-11, PCA-13 | Strict endpoint/state validation | Error minimization | Negative security/contract/fuzz tests | NOT_IMPLEMENTED |
| PCA-ADD-ENR-025 | PCA-1, PCA-2, PCA-10, PCA-11, PCA-13, PCA-15 | Per-row evidence ledger | Cross-phase integration ownership | Traceability completeness audit | NOT_IMPLEMENTED |

## Completion calculation

At engineering closeout, independently calculate `BASE_A100_REQUIREMENTS`, `ADDENDUM_REQUIREMENTS`, `IMPLEMENTED`, `IMPLEMENTED_TESTED`, `PLATFORM_LIMITED`, `MISSING`, `DUPLICATES`, and `ORPHANS`. The required traceability condition is `MISSING = 0`, `DUPLICATES = 0`, and `ORPHANS = 0`. Platform-limited requirements must identify the unavailable environment and pending evidence; they cannot be represented as tested.
