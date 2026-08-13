# PCA Implementation Traceability

## Reconciliation notice (Agent 40 — Traceability Realignment)

This document was re-derived from actual source, tests, and schema evidence by Agent 40 (mission `PCA-TRACEABILITY-REALIGN-1`) at frozen base `5b9d76a4d11edd5e480df1e19f5eea8030139ee5`, using three read-only discovery sub-agents covering backend, Android, and Parent Web/iOS/release. The prior version of this document marked every Addendum-001 row `NOT_IMPLEMENTED` unconditionally; that was stale. Statuses below are evidence-backed, not label changes. Full per-ID evidence (source paths, test paths, notes) lives in [PCA_COMPLETION_V2_MATRIX.json](PCA_COMPLETION_V2_MATRIX.json); a narrative synthesis lives in [PCA_CURRENT_IMPLEMENTATION_STATUS.md](PCA_CURRENT_IMPLEMENTATION_STATUS.md).

**Base A-100 requirements (199 IDs) were not individually re-derived at the normative-text level in this pass** — see the scope limitation below. Only the Addendum-001 matrix (25 IDs) and the PCA-0..19/PCA-WELL-1 phase-level status (in the companion status document) were evidence-based re-derived this pass.

**Addendum 002 (Platform Administration / Billing) is not yet integrated at this base** — it is a parallel controlled lane (Agent 39) and is deliberately excluded from this document. No Addendum-002 requirement IDs are invented here; see `PCA_CURRENT_IMPLEMENTATION_STATUS.md` §12–13 for the current programme-level (non-ID) status of that track.

## Control and counting

| Inventory | Count | Authority | Status |
|---|---:|---|---|
| Base A-100 | 199 | [Architecture traceability matrix](../architecture/32_TRACEABILITY_ACCEPTANCE_MATRIX.md) | Immutable accepted baseline; verified 199 unique normative IDs, 0 duplicates, 0 missing, 0 orphans at this base. Per-ID implementation evidence not yet individually re-derived (see scope limitation). |
| Addendum 001 | 25 | [Secure invite/protected enrollment addendum](addenda/PCA_ADDENDUM_001_SECURE_INVITE_PROTECTED_ENROLLMENT.md) | Owner approved; evidence-backed re-derivation complete this pass (see matrix below). |
| Total implementation authority | 224 | Base A-100 + approved addenda | No requirement is implemented merely by appearing here |

`BASE_A100_REQUIREMENTS = 199` was independently recounted from the architecture matrix's own ID column (not copied from prior documentation) and confirmed exact: 0 missing, 0 duplicate, 0 orphan IDs. Family breakdown: PCA-FR (112), PCA-NFR (43), PCA-SEC (18), PCA-DATA (17), PCA-AND (3), PCA-IOS (3), PCA-PRIV (2), PCA-AI (1).

## Addendum 001 implementation matrix

Statuses below reflect actual backend (`backend/src`, `backend/test`, `backend/migrations`) and Parent Web (`parent-web/src`) source found at this base, not planned paths. See [PCA_COMPLETION_V2_MATRIX.json](PCA_COMPLETION_V2_MATRIX.json) for full sourceEvidence/testEvidence/notes per row. `PCA-15`-linked entries remain platform-validation-dependent regardless of source status: macOS/Xcode build validation and applicable Apple authorization have not occurred at this base.

| Requirement | Primary phase(s) | Status | Summary |
|---|---|---|---|
| PCA-ADD-ENR-001 | PCA-10 | PARTIAL | Platform/mode selection implemented backend+web; child selection and initial policy profile not modeled in the invitation record. |
| PCA-ADD-ENR-002 | PCA-1, PCA-10 | PARTIAL | Link + raw token exist; no QR code, no short fallback code. |
| PCA-ADD-ENR-003 | PCA-1, PCA-10 | PARTIAL | No secrets found in what exists (token, link); QR/fallback code don't exist to evaluate. |
| PCA-ADD-ENR-004 | PCA-1 | SOURCE_COMPLETE | Token entropy (256-bit CSPRNG), SHA-256 hash-only storage, TTL, single-use, revocation all solid. |
| PCA-ADD-ENR-005 | PCA-1 | PARTIAL | Only 4 of 8 required lifecycle states persisted (`CREATED/OPENED/REDEEMED/REVOKED`); `INSTALL_REQUIRED`/`APP_INSTALLED`/`AUTHORIZATION_REQUIRED` entirely absent; `EXPIRED` is derived, not stored. |
| PCA-ADD-ENR-006 | PCA-1 | SOURCE_COMPLETE | Fail-closed redemption correct within the 4-state model that exists. |
| PCA-ADD-ENR-007 | PCA-10 | SOURCE_COMPLETE | Status + revoke implemented backend and web without exposing a reusable token. |
| PCA-ADD-ENR-008 | PCA-1, PCA-2 | NOT_STARTED | No App Link intent-filter or install-continuation logic found. |
| PCA-ADD-ENR-009 | PCA-2 | NOT_STARTED | Android Protected provisioning correctly self-gated `PENDING_OWNER_DECISION`; no `DeviceAdminReceiver` exists. |
| PCA-ADD-ENR-010 | PCA-15 | NOT_STARTED | iOS crypto/enrollment confirmed absent from source. |
| PCA-ADD-ENR-011 | PCA-10, PCA-16 | PARTIAL | Child home screen exists; specific disclosure content not confirmed in this pass. |
| PCA-ADD-ENR-012 | PCA-10, PCA-13 | NOT_STARTED | No PIN-configuration symbol or UI found anywhere. |
| PCA-ADD-ENR-013 | PCA-10, PCA-11, PCA-13 | PARTIAL | Signed device-auth protocol-complete but crypto-inert (fail-closed verifier); no PIN fallback exists. |
| PCA-ADD-ENR-014 | PCA-13 | NOT_STARTED | No PIN verifier module (salt, slow KDF, rate limiting) found. |
| PCA-ADD-ENR-015 | PCA-13, PCA-17 | NOT_APPLICABLE | Nothing to leak — the PIN feature does not exist yet. |
| PCA-ADD-ENR-016 | PCA-10, PCA-11, PCA-13 | NOT_STARTED | Zero source hits for `PARENT_APPROVAL_REQUIRED`. |
| PCA-ADD-ENR-017 | PCA-10, PCA-11 | NOT_STARTED | Zero source hits for `KEEP_ACTIVE`/`TEMPORARILY_DISABLE`/`ALLOW_REMOVAL`. |
| PCA-ADD-ENR-018 | PCA-11, PCA-13 | NOT_STARTED | No removal/disable decision route or service found. |
| PCA-ADD-ENR-019 | PCA-2, PCA-10, PCA-13, PCA-15 | NOT_STARTED | No matching protection-state enum/UI found under this requirement's vocabulary. |
| PCA-ADD-ENR-020 | PCA-11, PCA-13 | NOT_STARTED | No E2EE alert generator for the addendum's event list; no display component in Parent Web. |
| PCA-ADD-ENR-021 | PCA-10, PCA-13, PCA-15 | NOT_STARTED | Emergency floor exists narrowly (manual toggle in Screen Time only), not evidenced across the required flows generally. |
| PCA-ADD-ENR-022 | PCA-1, PCA-11 | SOURCE_COMPLETE | Strong schema-privacy regression test; enrollment table stores only hash/platform/mode/status/timestamps. |
| PCA-ADD-ENR-023 | PCA-1 | PARTIAL | Solid for the 4-state model that exists; incomplete relative to the full 8-state lifecycle. |
| PCA-ADD-ENR-024 | PCA-1, PCA-11, PCA-13 | PARTIAL | Invitation-side reuse/expiry/revocation/wrong-family covered; removal-side unevaluable since that subsystem doesn't exist. |
| PCA-ADD-ENR-025 | PCA-1, PCA-2, PCA-10, PCA-11, PCA-13, PCA-15 | NOT_STARTED | Per-row backend+DB+security+test evidence is not recorded for most of the 25 requirements; this meta-requirement cannot be marked implemented. |

### Addendum 001 status distribution

| Status | Count | IDs |
|---|---:|---|
| SOURCE_COMPLETE | 4 | 004, 006, 007, 022 |
| PARTIAL | 8 | 001, 002, 003, 005, 011, 013, 023, 024 |
| NOT_STARTED | 12 | 008, 009, 010, 012, 014, 016, 017, 018, 019, 020, 021, 025 |
| NOT_APPLICABLE | 1 | 015 |

## Completion calculation (calculated, not projected)

`BASE_A100_REQUIREMENTS = 199`, `ADDENDUM_REQUIREMENTS = 25`, `TOTAL_CONTROLLED_REQUIREMENTS = 224`.

`MISSING_IDS = 0`, `DUPLICATE_IDS = 0`, `ORPHAN_IDS = 0` — both inventories verified exact against their respective source documents.

Addendum 001: `SOURCE_COMPLETE = 4`, `PARTIAL = 8`, `NOT_STARTED = 12`, `NOT_APPLICABLE = 1`. None are `VALIDATED_COMPLETE` or `PRODUCTION_READY` — no real-device/real-environment execution evidence or closed external gates exist for any addendum requirement yet.

Base A-100: individual per-ID `IMPLEMENTED`/`IMPLEMENTED_TESTED`/`PLATFORM_LIMITED` counts are **not yet calculated** — see scope limitation above. The phase-level (PCA-0..19) re-derivation in `PCA_CURRENT_IMPLEMENTATION_STATUS.md` §4 stands in as the best current evidence-based signal until a full per-ID pass is done; treat it as directionally reliable, not as a substitute for the still-pending per-ID base-inventory audit.

Platform-limited requirements (PCA-15/iOS-linked, and any requirement depending on Android real-device/Device-Owner validation) must identify the unavailable environment and pending evidence; they cannot be represented as tested. See `PCA_CURRENT_IMPLEMENTATION_STATUS.md` §9 for the current external gate matrix.
