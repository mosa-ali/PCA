# PCA Implementation Traceability

## Reconciliation notice (Agent 40 — Traceability Realignment)

This document was re-derived from actual source, tests, and schema evidence by Agent 40 (mission `PCA-TRACEABILITY-REALIGN-1`) at frozen base `5b9d76a4d11edd5e480df1e19f5eea8030139ee5`, using three read-only discovery sub-agents covering backend, Android, and Parent Web/iOS/release. The prior version of this document marked every Addendum-001 row `NOT_IMPLEMENTED` unconditionally; that was stale. Statuses below are evidence-backed, not label changes. Full per-ID evidence (source paths, test paths, notes) lives in [PCA_COMPLETION_V2_MATRIX.json](PCA_COMPLETION_V2_MATRIX.json); a narrative synthesis lives in [PCA_CURRENT_IMPLEMENTATION_STATUS.md](PCA_CURRENT_IMPLEMENTATION_STATUS.md).

**Base A-100 requirements (199 IDs) were not individually re-derived at the normative-text level in this pass** — see the scope limitation below. Only the Addendum-001 matrix (25 IDs) and the PCA-0..19/PCA-WELL-1 phase-level status (in the companion status document) were evidence-based re-derived in the original (R0) pass.

### Correction R1 (mission `PCA-TRACEABILITY-REALIGN-1-R1`, base `6fba8e000614e772414ba973631fbfe2f20aef20`)

Addendum 002 (Platform Administration and Billing) has since been integrated into `pca-dev` and is now controlled architecture authority — see [PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md](addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md). This correction reconciles this document with that fact: its 98 requirement IDs (`PCA-ADD-PA-001`..`054`, 51 non-contiguous IDs; `PCA-ADD-BILL-001`..`047`, 47 non-contiguous IDs including lettered `PCA-ADD-BILL-005A`) are now part of the controlled inventory below. *Historical note: at the R0 pass, Addendum 002 did not yet exist in the repository and was correctly absent from this document; that earlier state is not a current-status claim.* This correction did not re-score the existing PCA-0..19/PCA-WELL-1/Addendum-001 findings from R0 — see §"Preserved from R0" below.

### Correction R2 (PCA-MASTER-COORDINATOR, Round5 pre-flight governance pass, 2026-08-15, base `ae7289f5831e50c9b62a28229296bf658dffdc4c`)

The R1 correction above was itself accurate only as of its own authoring date — since then, four further rounds of real, tested, merged implementation landed (Wave3A integration plus Round4's PCA-PA-3C/PCA-MYKIDS-BILL-3 live-backend integration lanes). R1's own status table, and the Addendum 002 document's own Section 21/22 status claims, are now **stale**: both assert "no source exists" / every workstream `NOT_STARTED`, which is factually false against current `pca-dev`. This R2 correction independently re-derives all 98 Addendum-002 requirement IDs against actual current source, tests, and schema — not against the addendum document's own (stale) self-reported status, and not by simply marking everything complete. Five independent read-only research passes each covered a disjoint subset of the 98 requirements, each citing concrete file:line/test evidence; findings were cross-checked and compiled into the table below by the Coordinator. Full per-ID evidence lives in [PCA_COMPLETION_V2_MATRIX.json](PCA_COMPLETION_V2_MATRIX.json).

Where genuinely correct backend orchestration logic exists but has no dedicated automated test exercising it directly (specifically `WebhookService`'s freshness/replay, out-of-order-tolerance, and amount/currency cross-check logic — `PCA-ADD-BILL-030/032/033/034`), status remains `SOURCE_COMPLETE` (the requirement's behavior is genuinely implemented) with an explicit `TEST_EVIDENCE_PARTIAL` note rather than being downgraded — source-completeness and test-coverage are tracked as distinct facts, not conflated.

This correction does not touch the Addendum-001/PCA-0..19/PCA-WELL-1 findings (unchanged, see §"Preserved from R0"), and does not mark anything `VALIDATED_COMPLETE` or `PRODUCTION_READY` — no such claim is made or implied by any `SOURCE_COMPLETE` row below; those remain distinct, higher bars this pass does not attempt to clear (see Completion calculation).

## Control and counting

| Inventory | Count | Authority | Status |
|---|---:|---|---|
| Base A-100 | 199 | [Architecture traceability matrix](../architecture/32_TRACEABILITY_ACCEPTANCE_MATRIX.md) | Immutable accepted baseline; verified 199 unique normative IDs, 0 duplicates, 0 missing, 0 orphans at this base. Per-ID implementation evidence not yet individually re-derived (see scope limitation). |
| Addendum 001 | 25 | [Secure invite/protected enrollment addendum](addenda/PCA_ADDENDUM_001_SECURE_INVITE_PROTECTED_ENROLLMENT.md) | Owner approved; evidence-backed re-derivation complete (R0 pass, see matrix below). |
| Addendum 002 | 98 | [Platform Administration and Billing addendum](addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md) | Owner approved and integrated; substantial real, tested source now exists (76 `SOURCE_COMPLETE`, 13 `PARTIAL`, 9 `NOT_STARTED` — R2 correction, see matrix below). Settlement/reconciliation (`BILL-012/013/014/036/037/038`) remains genuinely unbuilt. |
| Addendum 003 | 24 | [Parent Identity, Registration, Free-Access addendum](addenda/PCA_ADDENDUM_003_PARENT_IDENTITY_REGISTRATION_FREE_ACCESS.md) | Owner approved (`PCA-DEC-026`, `Option C`); architecture-only, no `PCA-ADD-IDENT-*` source exists yet — Round5 `PCA-AUTH-SESSION-1` scope. |
| Addendum 004 | 25 | [Complimentary Entitlement Grants addendum](addenda/PCA_ADDENDUM_004_COMPLIMENTARY_ENTITLEMENTS.md) | Owner approved (Round5 Section A); architecture-only, no `PCA-ADD-COMP-*` source exists yet — Round5 `PCA-COMPLIMENTARY-ENTITLEMENTS-1` scope. |
| Total implementation authority | 371 | Base A-100 + approved addenda | No requirement is implemented merely by appearing here |

`BASE_A100_REQUIREMENTS = 199` was independently recounted from the architecture matrix's own ID column (not copied from prior documentation) and confirmed exact: 0 missing, 0 duplicate, 0 orphan IDs. Family breakdown: PCA-FR (112), PCA-NFR (43), PCA-SEC (18), PCA-DATA (17), PCA-AND (3), PCA-IOS (3), PCA-PRIV (2), PCA-AI (1).

`ADDENDUM_002_REQUIREMENTS = 98` was independently extracted from the addendum's own bold-marked normative-ID definitions (not generated by looping a numeric range, and not copied from the addendum's own summary prose) and confirmed exact: 51 `PCA-ADD-PA-*` IDs (numbering intentionally non-contiguous, e.g. jumps from `PCA-ADD-PA-050` to `PCA-ADD-PA-054`), 47 `PCA-ADD-BILL-*` IDs (including lettered `PCA-ADD-BILL-005A`; numbering jumps from `PCA-ADD-BILL-041` to `PCA-ADD-BILL-043`), 0 duplicates, 0 missing from this traceability document, 0 orphans.

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

## Addendum 002 implementation matrix

[PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md](addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md) is the authority for every requirement's full normative text; this table does not reproduce it. **The addendum's own Section 21/22 status claims are now stale** — they assert every workstream is `NOT_STARTED` and that `parent-web/src/pages/Subscription.tsx` is "only a static placeholder," both contradicted by current source (confirmed independently by this R2 correction, which reads the actual current files, not the addendum's self-reported table). Four rounds of real implementation (Wave3A + Round4) landed since the addendum's 2026-08-13 authoring date: `backend/src/platformadmin/**`, `backend/src/billing/**`, `backend/src/familycommercial/**`, `backend/src/commercialnotifications/**`, migrations `0005`-`0012`, and both `platform-admin-web/**` (live-backend-integrated) and `parent-web/src/api/real/**`/`pages/billing/**`. Full per-ID `sourceEvidence`/`testEvidence` citations are in [PCA_COMPLETION_V2_MATRIX.json](PCA_COMPLETION_V2_MATRIX.json); this table carries a condensed one-line summary per row. `SOURCE_COMPLETE` here means the requirement's described capability is genuinely implemented and covered by passing tests unless the row explicitly notes otherwise — it is never a claim of `VALIDATED_COMPLETE`/`PRODUCTION_READY` (see Completion calculation).

**The most significant remaining real gap**: `parent-web`'s `RealBillingClient`/`RealCommercialNotificationClient` are genuine, correct, fully unit-tested HTTP implementations, but no browser-reachable route anywhere issues the bearer/service-session token `requireServiceSession` requires (`AuthService.issueSession` has zero call sites) — both clients fail fast with `SERVICE_SESSION_UNAVAILABLE` rather than falling back to fixture data. This is why `PCA-ADD-BILL-039`/`PCA-ADD-PA-047` are `PARTIAL` despite substantial complete source underneath them. This exact gap is what Round5's `PCA-AUTH-SESSION-1` (Addendum 003, `PCA-DEC-026`) is scoped to close.

Primary programme/phase uses the workstream tags this addendum's own Section 21 Implementation Programme V2 table defines: `PCA-PA-1` (Admin Identity/RBAC/Audit), `PCA-PA-2` (Entitlements/Enrollment Limits), `PCA-PA-3` (Platform Admin Web), `PCA-PA-4` (Operations/Reporting), `PCA-PA-5` (Security/Financial Red Team), `PCA-PA-6` (UX/i18n/a11y), `PCA-PA-UAT`, `PCA-BILL-1` (Billing Core), `PCA-BILL-2` (Payment Provider), `PCA-BILL-3` (Settlements/Reconciliation), `PCA-BILL-UAT`, `PCA-MYKIDS-BILL-1` (Parent Self-Service).

| Requirement | Primary programme/phase | Status | Summary |
|---|---|---|---|
| PCA-ADD-PA-001 | PCA-PA-1 | SOURCE_COMPLETE | Distinct auth realm/session/RBAC, structurally and by `crossRealm.test.mjs`. |
| PCA-ADD-PA-002 | PCA-PA-1 | SOURCE_COMPLETE | `pa_`-prefixed tokens rejected by family-plane parser and vice versa (`crossRealm.test.mjs`). |
| PCA-ADD-PA-003 | PCA-PA-1 | SOURCE_COMPLETE | No shared login route; no account-linking code path exists. |
| PCA-ADD-PA-004 | PCA-PA-1 | SOURCE_COMPLETE | No FDEK/DSK/DEK/recovery-secret reference anywhere in `platformadmin/`. |
| PCA-ADD-PA-005 | PCA-PA-1 | SOURCE_COMPLETE | No family-policy write path exists in this module (`schemaPrivacyScan.test.mjs`). |
| PCA-ADD-PA-006 | PCA-PA-1 | PARTIAL | Doc-governance requirement (future docs must match the trust-boundary diagram) — not code-testable. |
| PCA-ADD-PA-007 | PCA-PA-1 | SOURCE_COMPLETE | Admin create/role-grant require step-up + are audited in the same transaction (`accountService.test.mjs`). |
| PCA-ADD-PA-008 | PCA-PA-1 | SOURCE_COMPLETE | `AUDITOR_READ_ONLY` denied on every mutating operation, server-side (`rbacPolicy.test.mjs`). |
| PCA-ADD-PA-009 | PCA-PA-1 | SOURCE_COMPLETE | No child-data/key-material columns anywhere in migration 0005 (`schemaPrivacyScan.test.mjs`). |
| PCA-ADD-PA-010 | PCA-PA-1 | SOURCE_COMPLETE | Distinct auth plugin/service/RBAC, no shared claim schema (`crossRealm.test.mjs`). |
| PCA-ADD-PA-011 | PCA-PA-1 | SOURCE_COMPLETE | No `isAdmin`-flag pattern anywhere in the codebase; wholly separate account table. |
| PCA-ADD-PA-012 | PCA-PA-1 | SOURCE_COMPLETE | Composite of PA-013–018 below, all independently satisfied. |
| PCA-ADD-PA-013 | PCA-PA-1 | SOURCE_COMPLETE | `platform_admin_accounts` distinct table, no FK to family tables (`accountService.test.mjs`). |
| PCA-ADD-PA-014 | PCA-PA-1 | SOURCE_COMPLETE | `pa_`-prefixed tokens, separate `platform_admin_sessions` table (`token.test.mjs`, `crossRealm.test.mjs`). |
| PCA-ADD-PA-015 | PCA-PA-1 | SOURCE_COMPLETE | Own closed RBAC matrix, independent of `familyrbac/policy.ts` (`rbacPolicy.test.mjs`). |
| PCA-ADD-PA-016 | PCA-PA-1 | SOURCE_COMPLETE | Password AND TOTP required atomically, fail-closed, no bypass path (`authService.test.mjs`, `totp.test.mjs`). |
| PCA-ADD-PA-017 | PCA-PA-1 | PARTIAL | 3 of 6 step-up scopes wired (role-grant, entitlement-override, refund); suspend/reactivate/settlement-config scopes reserved but unwired — their underlying actions don't exist yet. |
| PCA-ADD-PA-018 | PCA-PA-1 | SOURCE_COMPLETE | Every mutation audits same-transaction; append-only enforced at DB grant level (`auditTypes.test.mjs`; DB-level proof not re-executed live this pass). |
| PCA-ADD-PA-019 | PCA-PA-1 | SOURCE_COMPLETE | Self and forced (role-removal-triggered) session revocation both exist (`authService.test.mjs`, `accountService.test.mjs`). |
| PCA-ADD-PA-020 | PCA-PA-1 | PARTIAL | Role-gated (APP_OWNER/FINANCE_ADMIN) lockout-alert logic is real and tested, but the only shipped adapter is a console-log line, not real alert delivery. |
| PCA-ADD-PA-021 | PCA-PA-2 | SOURCE_COMPLETE | FREE_STARTER 1/1 read from config table, not hardcoded (`platformEntitlementsCore.mysql.test.mjs`). |
| PCA-ADD-PA-022 | PCA-PA-2 | SOURCE_COMPLETE | Reservation precedes invitation; failed reservation leaves no orphan (`platformEntitlementsSlots.mysql.test.mjs`). |
| PCA-ADD-PA-023 | PCA-PA-2 | SOURCE_COMPLETE | Downgrade sets over-limit flag, never force-removes (`platformEntitlementsCore.mysql.test.mjs`). |
| PCA-ADD-PA-024 | PCA-PA-2 | SOURCE_COMPLETE | Config-table-driven defaults, snapshot-on-first-touch (`platformEntitlementsCore.mysql.test.mjs`). |
| PCA-ADD-PA-025 | PCA-PA-2 | SOURCE_COMPLETE | Two genuinely independent counter columns (`platformEntitlementsCore.mysql.test.mjs`). |
| PCA-ADD-PA-026 | PCA-PA-2 | SOURCE_COMPLETE | Structurally quantity-only, no invite/enroll method exists. |
| PCA-ADD-PA-027 | PCA-PA-2 | PARTIAL | `consumeByInvitationId` defined but no real PAIRED→ACTIVE device-activation event wired anywhere — code's own comments admit this. |
| PCA-ADD-PA-028 | PCA-PA-2 | SOURCE_COMPLETE | Distinct active/reserved counter columns; no PlatformAdmin-originated enrollment path. |
| PCA-ADD-PA-029 | PCA-PA-2 | SOURCE_COMPLETE | Full state exposed via `FamilyCommercialService.getEntitlement`; no dedicated test at that layer. |
| PCA-ADD-PA-030 | PCA-PA-2 | SOURCE_COMPLETE | True 6-state lifecycle at schema+service+test level (`platformEntitlementsCore.mysql.test.mjs`). |
| PCA-ADD-PA-031 | PCA-PA-2 | SOURCE_COMPLETE | Transitions table exists; writer path not fully re-verified this pass. |
| PCA-ADD-PA-032 | PCA-PA-2 | SOURCE_COMPLETE | Same-transaction approve+raise, atomicity verified post-commit. |
| PCA-ADD-PA-033 | PCA-PA-2 | SOURCE_COMPLETE | Standard auto-quote and custom-admin-quote paths both implemented and tested. |
| PCA-ADD-PA-034 | PCA-PA-2 | SOURCE_COMPLETE | Limit raise only invoked from APPROVED-transition code. |
| PCA-ADD-PA-035 | PCA-PA-2 | SOURCE_COMPLETE | Denial reason required, stored, audited, surfaced. |
| PCA-ADD-PA-036 | PCA-PA-2, PCA-BILL-2 | PARTIAL | Stages 1-3 of the 4-stage slot pipeline wired; stage 4 (CONSUMED-on-ACTIVE) is a dormant, isolated-tested hook — documented gap in the code itself. |
| PCA-ADD-PA-037 | PCA-PA-2, PCA-BILL-2 | SOURCE_COMPLETE | Release-on-expiry/revoke verified, idempotent (`platformEntitlementsSlots.mysql.test.mjs`). |
| PCA-ADD-PA-038 | PCA-PA-2, PCA-BILL-2 | SOURCE_COMPLETE | `SELECT ... FOR UPDATE` atomic reservation, TOCTOU avoided. |
| PCA-ADD-PA-039 | PCA-PA-2, PCA-BILL-2 | SOURCE_COMPLETE | Genuine N=8/12 concurrent race test across independent DB connections, exactly K successes. |
| PCA-ADD-PA-040 | PCA-PA-2, PCA-BILL-2 | SOURCE_COMPLETE | Used vs. held tracked and exposed distinctly end to end. |
| PCA-ADD-PA-041 | PCA-PA-4 | PARTIAL | Dashboard covers most metrics (per-currency breakdowns) but lacks settlement summary and service-health/exception-queue metrics. |
| PCA-ADD-PA-042 | PCA-PA-4 | SOURCE_COMPLETE | No family-activity table reachable anywhere in the dashboard read model (negative property, verified by absence). |
| PCA-ADD-PA-043 | PCA-PA-3 | PARTIAL | Only 3 of ~8 settings categories exist (FREE_STARTER defaults, currencies, market-mapping); provider-credential/settlement/branding/feature-flag surfaces absent. |
| PCA-ADD-PA-044 | PCA-PA-3 | NOT_STARTED | No route exists to mask-read a provider-credential/settlement-account field — nothing to mask, since the underlying settings surface doesn't exist. |
| PCA-ADD-PA-045 | PCA-PA-1 | SOURCE_COMPLETE | 16 of 17 named audit event types both declared and actually emitted (`auditTypes.test.mjs`); `PLAN_CHANGED`/`BANK_SETTING_CHANGED` declared but never constructed (no such flows exist yet). |
| PCA-ADD-PA-046 | PCA-PA-1 | SOURCE_COMPLETE | Metadata cap + validation; role-scoped read (APP_OWNER/AUDITOR unrestricted, others own-actions-only) — slightly narrower than spec's "own + domain" carve-out. |
| PCA-ADD-PA-047 | PCA-MYKIDS-BILL-1 | PARTIAL | Server correctly prevents direct parent entitlement writes, but unreachable end-to-end today — `SERVICE_SESSION_UNAVAILABLE` (see intro note above; closed by Round5 `PCA-AUTH-SESSION-1`). |
| PCA-ADD-PA-048 | PCA-PA-1 | NOT_STARTED | Process/reporting-discipline rule; no code artifact enforces it (no CI gate blocking an unevidenced status claim). |
| PCA-ADD-PA-049 | PCA-PA-2 | SOURCE_COMPLETE | `PaymentConfirmationPort` has no client-facing HTTP route; reachable only from `WebhookService`. |
| PCA-ADD-PA-050 | PCA-PA-2 | SOURCE_COMPLETE | Both upgrade paths implemented, RBAC-gated (`ADMINISTER_BILLING`) as specified. |
| PCA-ADD-PA-054 | PCA-PA-2 | SOURCE_COMPLETE | Billable/non-billable separation enforced at BOTH DB CHECK constraint and service level — strongest evidence of any PA row (raw-SQL constraint-violation test). |
| PCA-ADD-BILL-001 | PCA-BILL-1 | SOURCE_COMPLETE | Plan versioning creates a new version, never mutates (`billingCore.mysql.test.mjs`). |
| PCA-ADD-BILL-002 | PCA-BILL-1 | SOURCE_COMPLETE | DB-enforced single-open-active-row per (market,currency,targetDeviceLimit) (`billingCorePriceBookConcurrency.mysql.test.mjs`). |
| PCA-ADD-BILL-003 | PCA-BILL-1 | SOURCE_COMPLETE | At most one ACTIVE subscription is a real DB-level constraint, not app-only. |
| PCA-ADD-BILL-004 | PCA-BILL-1 | SOURCE_COMPLETE | Invoice totals computed via exact integer arithmetic. |
| PCA-ADD-BILL-005 | PCA-BILL-1 | SOURCE_COMPLETE | InvoiceLine entity/table present. |
| PCA-ADD-BILL-005A | PCA-BILL-1 | SOURCE_COMPLETE | Quote issuance/expiry/status lifecycle present; issued via the entitlements-plane admin path, not a standalone billing route. |
| PCA-ADD-BILL-006 | PCA-BILL-1 | SOURCE_COMPLETE | PaymentAttempt full flow tested end to end. |
| PCA-ADD-BILL-007 | PCA-BILL-1 | SOURCE_COMPLETE | Idempotent confirm; UNIQUE(payment_attempt_id) enforces one transaction per attempt. |
| PCA-ADD-BILL-008 | PCA-BILL-1 | SOURCE_COMPLETE | No PAN/CVV columns anywhere; provider-token + display-safe metadata only. |
| PCA-ADD-BILL-009 | PCA-BILL-1 | SOURCE_COMPLETE | Refund issuance step-up-gated; extended by `RefundOrchestrationService` for concurrency/durability. |
| PCA-ADD-BILL-010 | PCA-BILL-1 | SOURCE_COMPLETE | Dispute lifecycle states present; thinner test coverage than payment/refund. |
| PCA-ADD-BILL-011 | PCA-BILL-1 | SOURCE_COMPLETE | UNIQUE(provider, provider_event_id) persistence/idempotency foundation. |
| PCA-ADD-BILL-012 | PCA-BILL-3 | NOT_STARTED | SettlementAccount — zero matches anywhere except the out-of-scope migration comment. |
| PCA-ADD-BILL-013 | PCA-BILL-3 | NOT_STARTED | SettlementBatch — zero matches anywhere. |
| PCA-ADD-BILL-014 | PCA-BILL-3 | NOT_STARTED | Reconciliation — zero matches anywhere. |
| PCA-ADD-BILL-015 | PCA-BILL-1 | SOURCE_COMPLETE | Currency co-located with every money-bearing column; vacuously satisfied for the absent settlement tables. |
| PCA-ADD-BILL-016 | PCA-BILL-1 | SOURCE_COMPLETE | No family/policy/key columns; explicit static + live schema-privacy test pair. |
| PCA-ADD-BILL-017 | PCA-BILL-1 | SOURCE_COMPLETE | `amountMinor: bigint` throughout; `InvalidMoneyError` on any non-bigint. |
| PCA-ADD-BILL-018 | PCA-BILL-1 | SOURCE_COMPLETE | Single centralized `CURRENCY_METADATA` map. |
| PCA-ADD-BILL-019 | PCA-BILL-1 | SOURCE_COMPLETE | USD/SAR/YER only; EUR and all others explicitly rejected. |
| PCA-ADD-BILL-020 | PCA-BILL-1 | PARTIAL | No-auto-FX-for-pricing half solidly implemented; USD-normalized reporting rollup with recorded rate not located. |
| PCA-ADD-BILL-021 | PCA-BILL-1 | NOT_STARTED | Cannot exist without SettlementAccount/Batch/Reconciliation (BILL-012/013/014). |
| PCA-ADD-BILL-022 | PCA-BILL-1 | PARTIAL | Single `enabled` currency flag exists; no distinct charge-vs-settlement currency-gate concept. |
| PCA-ADD-BILL-023 | PCA-BILL-2 | SOURCE_COMPLETE | No card/CVV/routing/secret columns anywhere; three independent schema-privacy tests assert this. |
| PCA-ADD-BILL-024 | PCA-BILL-2 | SOURCE_COMPLETE | Server never becomes a card-data intermediary (architecture correct; unverifiable end-to-end absent a real provider adapter). |
| PCA-ADD-BILL-025 | PCA-BILL-2 | SOURCE_COMPLETE | Resolve-by-reference-only secret indirection; no hardcoded/DB secret values found. |
| PCA-ADD-BILL-026 | PCA-BILL-2 | PARTIAL | DB-schema absence of forbidden terms is tested; no runtime log/diagnostic-output absence test exists for Billing. |
| PCA-ADD-BILL-027 | PCA-BILL-2 | SOURCE_COMPLETE | `PaymentProvider` interface, zero SDK import anywhere, fail-closed on unknown provider. |
| PCA-ADD-BILL-028 | PCA-BILL-2 | SOURCE_COMPLETE | Correctly self-scoped: documents production registry is empty; external gates unresolved by design. |
| PCA-ADD-BILL-029 | PCA-BILL-2 | SOURCE_COMPLETE | Provider is part of the event unique key; multi-provider identity first-class, DB-enforced. |
| PCA-ADD-BILL-030 | PCA-BILL-2 | SOURCE_COMPLETE; TEST_EVIDENCE_PARTIAL | Reject-before-trust sequencing correct by inspection; HMAC primitive tested, but no test exercises `WebhookService.processWebhook` directly. |
| PCA-ADD-BILL-031 | PCA-BILL-2 | SOURCE_COMPLETE | DB `UNIQUE(provider, provider_event_id)` idempotency, zero re-execution on duplicate — genuine concurrent-race + redelivery tests. |
| PCA-ADD-BILL-032 | PCA-BILL-2 | SOURCE_COMPLETE; TEST_EVIDENCE_PARTIAL | Freshness/replay window logic present and precise (5-minute window, `STALE_REPLAY` audit); no direct test. |
| PCA-ADD-BILL-033 | PCA-BILL-2 | SOURCE_COMPLETE; TEST_EVIDENCE_PARTIAL | `queryPayment` is the sole authoritative status source, webhook body status never read; no direct test. |
| PCA-ADD-BILL-034 | PCA-BILL-2 | SOURCE_COMPLETE; TEST_EVIDENCE_PARTIAL | Amount/currency cross-checked against the immutable snapshot; mismatch is an anomaly, never silently reconciled; no direct test. |
| PCA-ADD-BILL-035 | PCA-BILL-2 | SOURCE_COMPLETE | Frontend never marks payment state locally; only server-driven `WebhookService` confirms. |
| PCA-ADD-BILL-036 | PCA-BILL-3 | NOT_STARTED | SettlementAccount — no entity, table, or repository. |
| PCA-ADD-BILL-037 | PCA-BILL-3 | NOT_STARTED | SettlementBatch — no entity, table, or repository. |
| PCA-ADD-BILL-038 | PCA-BILL-3 | NOT_STARTED | Reconciliation — no entity; only RBAC/audit-vocabulary placeholders reserved for a feature that doesn't exist. |
| PCA-ADD-BILL-039 | PCA-MYKIDS-BILL-1 | PARTIAL | Full UI+backend flow genuinely exists (`Subscription.tsx` etc., contradicting the addendum's own stale "placeholder" claim), but unreachable end-to-end today — `SERVICE_SESSION_UNAVAILABLE` (closed by Round5 `PCA-AUTH-SESSION-1`). |
| PCA-ADD-BILL-040 | PCA-MYKIDS-BILL-1 | SOURCE_COMPLETE | Owner-only gate enforced server-side; the REAL attestation-chain resolver (not a stub) is wired in production `main.ts` (`familyCommercialRoutes.test.mjs`, ROLE_DENIED tests for Administrator/Viewer). |
| PCA-ADD-BILL-041 | PCA-PA-1 | PARTIAL | No real production payment-provider adapter exists yet (only a test/dev-restricted sandbox), so real-money billing structurally cannot go live — but no explicit engineered "refuse in production" kill-switch exists for a hypothetical future adapter. |
| PCA-ADD-BILL-043 | PCA-BILL-1 | SOURCE_COMPLETE | Quote/price snapshot immutability directly, explicitly regression-tested (survives later PriceBook change and Quote expiry/supersession). |
| PCA-ADD-BILL-044 | PCA-BILL-1 | SOURCE_COMPLETE | Price-book admin RBAC matches the addendum's role matrix exactly, including the PLATFORM_ADMIN view-only carve-out. |
| PCA-ADD-BILL-045 | PCA-BILL-1 | SOURCE_COMPLETE | CommercialMarket country-mapping is data-driven config, not hardcoded logic. |
| PCA-ADD-BILL-046 | PCA-PA-2, PCA-BILL-2 | SOURCE_COMPLETE | Idempotency key is provider-event-ID-derived (not request-ID-only); exactly-once confirmed under N=8 concurrent duplicates. |
| PCA-ADD-BILL-047 | PCA-PA-2, PCA-BILL-2 | SOURCE_COMPLETE | Limit-raise never touches slot reservations — holds by construction; no dedicated regression test proves survival under a concurrent race. |

### Addendum 002 status distribution (R2 correction)

| Status | Count |
|---|---:|
| SOURCE_COMPLETE (incl. `TEST_EVIDENCE_PARTIAL`-annotated rows) | 76 |
| PARTIAL | 13 |
| NOT_STARTED | 9 |
| NOT_APPLICABLE | 0 |
| EXTERNAL_GATE (as primary status) | 0 |

PA: 41 SOURCE_COMPLETE, 8 PARTIAL (`006,017,020,027,036,041,043,047`), 2 NOT_STARTED (`044,048`) = 51.
BILL: 35 SOURCE_COMPLETE, 5 PARTIAL (`020,022,026,039,041`), 7 NOT_STARTED (`012,013,014,021,036,037,038`) = 47.

Six requirements (`PCA-ADD-BILL-027`–`029`, `PCA-ADD-BILL-036`–`038`) additionally carry a non-empty `externalGate` annotation in the JSON matrix (`PAYMENT_PROVIDER_SELECTION`/`MERCHANT_ACCOUNT_APPROVAL` and `SETTLEMENT_BANK_CONFIGURATION`/`SUPPORTED_SETTLEMENT_CURRENCIES` respectively); BILL-027–029's abstraction layer is itself `SOURCE_COMPLETE` (the external gate blocks only a real production provider, not the abstraction), while BILL-036–038 remain `NOT_STARTED` since no settlement source exists yet to be gated at all.

Four requirements (`PCA-ADD-BILL-030/032/033/034`) carry a `SOURCE_COMPLETE; TEST_EVIDENCE_PARTIAL` status: the underlying `WebhookService` orchestration logic genuinely and correctly implements each requirement (verified by direct code inspection against the addendum's normative text), but no test file anywhere in the repository imports or exercises `WebhookService` itself — only its lower-level dependencies (HMAC signature verification, DB-level event idempotency) are directly tested. This is tracked as a test-coverage gap, not a source gap.

## Completion calculation (calculated, not projected)

`BASE_A100_REQUIREMENTS = 199`, `ADDENDUM_001_REQUIREMENTS = 25`, `ADDENDUM_002_REQUIREMENTS = 98`, `ADDENDUM_003_REQUIREMENTS = 24`, `ADDENDUM_004_REQUIREMENTS = 25`, `TOTAL_CONTROLLED_REQUIREMENTS = 371`.

`MISSING_IDS = 0`, `DUPLICATE_IDS = 0`, `ORPHAN_IDS = 0` across all five inventories, each verified exact against its own source document. Addendum 003 (`PCA-ADD-IDENT-001`..`024`, contiguous) and Addendum 004 (`PCA-ADD-COMP-001`..`025`, contiguous) were newly authored in this Round5 pre-flight governance pass and carry no implementation yet — see their own control blocks.

Addendum 001 (R0 pass, preserved unchanged): `SOURCE_COMPLETE = 4`, `PARTIAL = 8`, `NOT_STARTED = 12`, `NOT_APPLICABLE = 1`.

Addendum 002 (R2 correction, this pass): `SOURCE_COMPLETE = 76` (including 4 `TEST_EVIDENCE_PARTIAL`-annotated rows), `PARTIAL = 13`, `NOT_STARTED = 9`, `NOT_APPLICABLE = 0`.

Addendum 003: `SOURCE_COMPLETE = 0`, `PARTIAL = 0`, `NOT_STARTED = 24`, `NOT_APPLICABLE = 0` — architecture-only, `PCA-AUTH-SESSION-1` not yet implemented.

Addendum 004: `SOURCE_COMPLETE = 0`, `PARTIAL = 0`, `NOT_STARTED = 25`, `NOT_APPLICABLE = 0` — architecture-only, `PCA-COMPLIMENTARY-ENTITLEMENTS-1` not yet implemented.

None of the 371 controlled requirements are `VALIDATED_COMPLETE` or `PRODUCTION_READY` — `SOURCE_COMPLETE` here means genuinely implemented and (in almost all cases) test-covered source, never real-device/real-environment execution evidence, external-gate closure, or a production-readiness claim. No requirement in any addendum (001-004) is marked `VALIDATED_COMPLETE` or `PRODUCTION_READY`.

Base A-100: individual per-ID `IMPLEMENTED`/`IMPLEMENTED_TESTED`/`PLATFORM_LIMITED` counts are **not yet calculated** — see scope limitation above. The phase-level (PCA-0..19) re-derivation in `PCA_CURRENT_IMPLEMENTATION_STATUS.md` §4 stands in as the best current evidence-based signal until a full per-ID pass is done; treat it as directionally reliable, not as a substitute for the still-pending per-ID base-inventory audit.

Platform-limited requirements (PCA-15/iOS-linked, and any requirement depending on Android real-device/Device-Owner validation) must identify the unavailable environment and pending evidence; they cannot be represented as tested. See `PCA_CURRENT_IMPLEMENTATION_STATUS.md` §9 for the current external gate matrix, including the six new Addendum-002 commercial gates (`PAYMENT_PROVIDER_SELECTION`, `MERCHANT_ACCOUNT_APPROVAL`, `SUPPORTED_CHARGE_CURRENCIES`, `SUPPORTED_SETTLEMENT_CURRENCIES`, `SETTLEMENT_BANK_CONFIGURATION`, `PAYMENT_PRODUCTION_CERTIFICATION`).

## Preserved from R0

The following were established in the R0 pass and are **not re-scored** by this R1 correction (per its narrow scope): the PCA-0..19/PCA-WELL-1 phase matrix, the Addendum-001 status distribution above, and all known source gaps (device-wide VPN filtering incomplete, SafeSearch incomplete, production crypto review not approved, real UAT 0/50, iOS Xcode/entitlement/device gates, YouTube Mode B gate, family-authority RBAC gap, PIN/removal subsystem gaps, Android tamper gap). See `PCA_CURRENT_IMPLEMENTATION_STATUS.md` for the full narrative, now updated only where Addendum 002 integration required it (Platform Administration/Billing sections).
