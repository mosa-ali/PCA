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

### Correction R3 (PCA-MASTER-COORDINATOR, Round5 finalization pass, base `22cd31e1d31deaa51b8055a070b21e5d7f5b37b8`)

Addenda 003 (`PCA-ADD-IDENT-*`, 24 IDs) and 004 (`PCA-ADD-COMP-*`, 25 IDs) — new controlled architecture authored during Round5 pre-flight — now have real, tested Round5 source (`PCA-AUTH-SESSION-1`, `PCA-COMPLIMENTARY-ENTITLEMENTS-1`, `PCA-COMMERCIAL-RUNTIME-1`) reconciled against them, per each lane's independently-verified Writer/QA report. Key cross-cutting finding: complimentary-capacity **consumption** gates (`SlotReservationService`, `ChangeRequestService`, the `over_limit_managed_device` calculation in `EntitlementRepository`) are not yet wired to consult complimentary grants — a family's granted extra capacity is fully visible (Platform Admin UI, and once wired, MyKids) but not yet consumable, a real, honestly-scoped gap outside Writer58's file ownership (`PCA-ADD-COMP-005/010/011` marked `PARTIAL`). The genesis-device-signer bridging `PCA-ADD-IDENT-009/010` is source-complete and independently QA-confirmed fail-closed in production today (pending `PCA-DEC-020`'s human security review of `CRYPTO_SUITE`), matching every other crypto-gated surface's existing posture. `FREE_ACCESS`'s daily-reminder UI and admin bulk-change path were not built this round (`PCA-ADD-IDENT-019/020/021` `NOT_STARTED`).

### Correction R4 (PCA-MASTER-COORDINATOR, Round6 traceability finalization pass, base `c880e191891b8f2a978c218cae32479f40261e28`)

Round6 (`PCA-COMPLIMENTARY-CONSUMPTION-1` Writer60, `PCA-FREE-ACCESS-1` Writer61, `PCA-BILL-3` Writer62, plus Coordinator glue `c880e19`) closes the majority of the real gaps R3 identified. Reconciled directly against Round6 source/tests (not against Writer/QA self-reports alone — every upgrade below cites the specific file(s)/test(s) read during this pass):

- **Complimentary-capacity consumption gap (COMP-005/010/011/018), closed.** `EffectiveEntitlementCapacity.computeEffectiveEntitlementSnapshot` is now consulted by the real consumption gates (`MySqlEntitlementRepository`, `MySqlSlotReservationRepository`), wired unconditionally in `main.ts` by Coordinator glue. Complimentary capacity is genuinely consumable and now displayed in MyKids (`familyCommercialRoutes.ts`). All 25 Addendum-004 requirements are now `SOURCE_COMPLETE`.
- **FREE_ACCESS daily-reminder UI and audited admin adjustment path (IDENT-019/020), closed.** `FreeAccessReminderBannerView` (MyKids) and `FreeAccessAdminService.adjustAccount()` (Platform Administration) both landed with real tests.
- **FREE_ACCESS expiry-driven acquisition restriction (IDENT-021), partially closed.** The allowed/denied operation matrix is correct by construction and the negative half (never disable existing protection) holds structurally; the positive half (block new commercial-capability acquisition post-expiry) has no consuming call site yet — upgraded `NOT_STARTED` → `PARTIAL`, not `SOURCE_COMPLETE`. This is the largest genuinely open item this correction leaves behind.
- **Settlement/Reconciliation (BILL-012/013/014/021/036/037/038, PA-044), closed.** The entire domain — previously zero source anywhere — now has a migration, repository, service, RBAC, HTTP routes, and three wired-and-navigable Platform Admin pages, all independently re-verified (355/355 DB tests, 1435/1435 backend unit tests, on a freshly created MySQL container after the Coordinator glue commit).
- **Charge-vs-settlement currency-gate concept (BILL-022), closed at the source level** — `SettlementAccount.settlementCurrency` now exists as its own field, independent of charge currency. Actual per-currency enablement remains correctly gated externally (unchanged).
- **Left open, unchanged:** `PA-041` (dashboard settlement/service-health metrics — Round6 did not touch `Dashboard.tsx`), `PA-043` (5 of ~8 settings categories still missing — provider-credential, branding, notification, maintenance-mode, feature-flag), `BILL-020` (cross-batch USD-normalized reporting rollup still not located, though a new per-batch FX snapshot reinforces the recorded-rate discipline), `PA-048` (the sole remaining Addendum-002 `NOT_STARTED` row, unrelated to Round6's scope).

`MISSING_IDS=0`, `DUPLICATE_IDS=0`, `ORPHAN_IDS=0` reconfirmed against the full 371-row inventory after this correction (programmatic uniqueness/completeness check re-run, not assumed carried-forward from R3).
### R3 evidence reconciliation (2026-08-17)

The live source tree was re-checked after the handoff range. PCA-ADD-ENR-005, PCA-ADD-ENR-006, and PCA-ADD-ENR-023 now have source-backed eight-state lifecycle, fail-closed transition, expiry, atomic redemption, and immutable-audit evidence; focused unit/MySQL test files are recorded in the matrix, while the elevated backend unit/security suite passed 1,495 tests, while MySQL integration execution remains a separate open validation gate. PCA-ADD-ENR-008 has Android App Link parser, manifest, coordinator, and tests, but remains PARTIAL because Digital Asset Links hosting and physical install-return behavior are external gates. PCA-ADD-ENR-019 remains PARTIAL because no concrete runtime enrollment-to-AUTHORIZATION_REQUIRED transition is claimed.


### Correction R5 (PCA-FINAL-SOURCE-COMPLETION-100, base `e50a94799d1d99fbc8247ad50114a1696676f186`)

This is the largest single reconciliation this document has ever undergone. Ten parallel Writers (63–72, in four sequential integration waves — enrollment lifecycle; PIN/removal-decision built from scratch; platform/commercial ops; family-authority/trust hardening; retention/export/recovery; Android runtime platform; Android protection experience; Android wellbeing/sensors; iOS; and AI/i18n/accessibility/cross-platform), each independently QA-verified before integration, plus a final Writer73 gap-eradication pass (also independently QA-verified), closed the great majority of source-solvable gaps across the entire controlled inventory. A mandatory second full 371-requirement audit ran after full integration specifically to (a) independently re-confirm every Writer's and QA's claims rather than trust self-reports, (b) perform — for the first time since this document's creation — the **individual normative-text-level re-derivation of all 199 Base A-100 requirement IDs**, which every prior correction (R0–R4) explicitly left as a known, called-out scope limitation (see the top of this document and `documentControl.scopeLimitation` in the JSON matrix), and (c) run a repo-wide gap hunt (TODO/FIXME/stub/placeholder/"not wired" pattern sweep with manual context classification) plus targeted runtime-reachability spot-checks on the round's highest-risk new subsystems.

**Base A-100 reconciliation, closed.** All 199 Base A-100 IDs (previously carried forward unconditionally as placeholder `NOT_STARTED`, `phase: UNMAPPED_PHASE_CROSSWALK_PENDING`, per the R0 pass's own documented scope limitation) now have individually-derived statuses backed by real source/test evidence read against the actual normative text in `docs/architecture/03_FUNCTIONAL_REQUIREMENTS.md` / `04_NON_FUNCTIONAL_REQUIREMENTS.md` / `05_SYSTEM_CONTEXT_ARCHITECTURE.md` / `09_SECURITY_PRIVACY_E2EE.md` / `10_DATA_MODEL_LOCAL_STORAGE.md` / `11_DATA_RETENTION_DELETION.md`, not against the phase-level PCA-0..19 narrative alone. 189 of the 371 controlled requirement IDs changed status this correction — the great majority are Base A-100 IDs receiving their first-ever real derivation (most moved `NOT_STARTED` → `SOURCE_COMPLETE`, reflecting that a great deal of real backend/Android/iOS/web source already existed and simply had never been individually checked against its own requirement text before). The full before/after list is preserved in the programme's working files (`MATRIX_CHANGE_LOG.txt`) for audit purposes.

**Genuine new closures this round** (source that did not exist before this programme, not just newly-derived status for pre-existing source): the entire PIN configuration + biometric-gate + removal/disable decision subsystem (`PCA-ADD-ENR-013/014/016/017/018`, previously zero source anywhere, `NOT_STARTED` since the addendum was authored); the 8-state invitation lifecycle (`PCA-ADD-ENR-005/023`, was a 4-state model); QR code + Android App Link enrollment continuation (`PCA-ADD-ENR-002/008`); the non-overridable emergency-dialer allowlist floor (`PCA-AND-003`); real WorkManager background execution + the prayer-reminder receiver finally firing + a real tamper-event producer + a tombstone/proof-of-deletion mechanism (`PCA-AND-002`, `PCA-NFR-033`, `PCA-FR-073`, `PCA-FR-085`, `PCA-DATA-026`); real geofence entry/exit alerting with hysteresis+debounce (`PCA-FR-063`); a deliberately-safe, camera-data-free proximity classifier plus honest camera-permission disclosure copy (`PCA-PRIV-001`); a real emergency `ACTION_DIAL` action plus same-device trusted-contact alert (`PCA-FR-132`); the previously-orphaned YouTube Mode A/B screen given a real hosting Activity and reachable navigation entry (`PCA-FR-054`); iOS's AI classifier converted from a `fatalError` crash to a typed fail-safe error, and real, scoped anti-removal-claim copy with a reachable navigation surface (`PCA-AI-001`, `PCA-IOS-002`); platform-admin-web's first-ever accessibility test suite (0 → 21 pages) and parent-web's extended from 13 → 23 pages, plus real RTL-rendering tests where previously zero existed (`PCA-NFR-041/045`, `PCA-FR-111`, `PCA-NFR-043`); two entirely new MyKids pages — a consolidated activity timeline and a "What Parents Can See" transparency page (`PCA-FR-092/096/121`) — built and wired into real routing; `Retention.tsx` wired to the real backend retention API for the first time (`PCA-FR-093`); a `Notifications.tsx` honesty fix (non-functional toggles no longer presented as live); real family-account-suspend enforcement at login, closing the write-only gap Writer65 honestly self-reported (`PCA-ADD-PA-017`); a production payment-provider kill-switch; and real CycloneDX SBOM generation wired into CI (`PCA-NFR-006`).

**Self-report/audit corrections caught during this pass** (documented per this program's "do not trust self-report — applies symmetrically to QA and audit verdicts" discipline): the second-audit's Android pass initially reported `PCA-FR-141` (device-key fingerprint confirmation UI) as still absent; independently re-verified against actual source (`KeyFingerprint.kt`, `EnrollmentScreen.kt`'s `KeyFingerprintConfirmation` composable) and found genuinely present and wired since Writer63/QA63's original, correctly-verified closure — the second audit's finding was a false negative, corrected before synthesis into this document. A prior writer's self-reported test count for a security-test bundle was independently found to be off by roughly 5× (16 real tests reported as 89) — the underlying code claims were all independently confirmed true; only the count itself needed correcting.

**Genuinely remaining gaps, left open honestly, not smoothed over:** production cryptography remains fail-closed pending `PCA-DEC-020`'s human security review (`RejectingDeviceSignatureVerifier`/`RejectingEnvelopeSignatureVerifier` unchanged, unweakened, re-confirmed airtight by adversarial testing this round) — this single gate is still the largest cross-cutting blocker, affecting family-trust/envelope/recovery/export surfaces exactly as in every prior round; Device Owner/DPC mode remains `PENDING_OWNER_DECISION` (no `DeviceAdminReceiver` exists, by design); YouTube Mode B remains permanently gated off (no mutator exists); real camera-based proximity capture (`PCA-FR-023/024`) was deliberately NOT built this round — a writer judged, correctly per this programme's safety boundaries, that verifying a camera-session frame-discard lifecycle was not achievable without physical hardware, and built only the safe, camera-data-free classifier math instead, leaving the actual capture wiring as an explicit, documented gap rather than risking an unverified privacy-sensitive feature; geofence zone-*authoring* has no UI on any surface (the detection engine is real and wired, but a parent has no way to define a zone yet); a returning parent's real family role cannot be resolved server-side at web sign-in (client-side-only heuristic, documented, low severity); parent-web's own SBOM generation is blocked on a pre-existing lockfile/workspace-hoisting issue in its `@pca/parent-sdk-*` sibling packages, independently reproduced and confirmed genuine, not a shortcut.

`MISSING_IDS=0`, `DUPLICATE_IDS=0`, `ORPHAN_IDS=0` reconfirmed against the full 371-row inventory (programmatic check re-run against the final matrix, not assumed carried-forward).

## Control and counting

| Inventory | Count | Authority | Status |
|---|---:|---|---|
| Base A-100 | 199 | [Architecture traceability matrix](../architecture/32_TRACEABILITY_ACCEPTANCE_MATRIX.md) | Immutable accepted baseline; verified 199 unique normative IDs, 0 duplicates, 0 missing, 0 orphans at this base. **Individually re-derived for the first time in R5** (84 `SOURCE_COMPLETE`, 83 `PARTIAL`, 19 `NOT_APPLICABLE`, 13 `NOT_STARTED`) — see R5 correction above. |
| Addendum 001 | 25 | [Secure invite/protected enrollment addendum](addenda/PCA_ADDENDUM_001_SECURE_INVITE_PROTECTED_ENROLLMENT.md) | Owner approved; re-derived through R5 (4 `SOURCE_COMPLETE`, 9 `PARTIAL`, 12 `NOT_STARTED` — the PIN/removal-decision subsystem closed several IDs this round; the E2EE-alert-list and protection-state-vocabulary IDs remain genuinely unbuilt). |
| Addendum 002 | 98 | [Platform Administration and Billing addendum](addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md) | Owner approved and integrated; through R5: 86 `SOURCE_COMPLETE`, 11 `PARTIAL`, 1 `NOT_STARTED`. Family-account-suspend enforcement (`PA-017`), dashboard settlement metrics, settings categories, and SBOM generation closed this round. |
| Addendum 003 | 24 | [Parent Identity, Registration, Free-Access addendum](addenda/PCA_ADDENDUM_003_PARENT_IDENTITY_REGISTRATION_FREE_ACCESS.md) | Owner approved (`PCA-DEC-026`, `Option C`); through R5: 22 `SOURCE_COMPLETE`, 2 `PARTIAL`, 0 `NOT_STARTED` (unchanged this round — Round6's IDENT-021 enforcement-wiring gap remains open, correctly re-confirmed rather than closed). |
| Addendum 004 | 25 | [Complimentary Entitlement Grants addendum](addenda/PCA_ADDENDUM_004_COMPLIMENTARY_ENTITLEMENTS.md) | Owner approved (Round5 Section A); 25/25 `SOURCE_COMPLETE`, unchanged since Round6 — complimentary-capacity consumption gates remain wired end-to-end. |
| Total implementation authority | 371 | Base A-100 + approved addenda | No requirement is implemented merely by appearing here. Final distribution (R5): 221 `SOURCE_COMPLETE`, 105 `PARTIAL`, 26 `NOT_STARTED`, 19 `NOT_APPLICABLE`. |

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
| PCA-ADD-ENR-005 | PCA-1 | SOURCE_COMPLETE | Full eight-state persisted lifecycle, validated forward transitions, timestamps, immutable transition audit rows, and focused unit/MySQL evidence are present; the elevated backend unit/security suite passed 1,495 tests, while MySQL integration execution remains a separate validation gate. |
| PCA-ADD-ENR-006 | PCA-1 | SOURCE_COMPLETE | Redeemed, expired, revoked, malformed, and invalid-state paths fail closed through generic outcomes; focused unit/MySQL evidence is recorded. |
| PCA-ADD-ENR-007 | PCA-10 | SOURCE_COMPLETE | Status + revoke implemented backend and web without exposing a reusable token. |
| PCA-ADD-ENR-008 | PCA-1, PCA-2 | PARTIAL | Android App Link parser, autoVerify manifest filter, coordinator wiring, and focused tests are present; Digital Asset Links hosting and physical install-return behavior remain external gates. |
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
| PCA-ADD-ENR-019 | PCA-2, PCA-10, PCA-13, PCA-15 | PARTIAL | Child-home and parent device UIs now use the requirement vocabulary (`STANDARD`/`PROTECTED`/`NOT_SUPPORTED`) with a mapped placeholder for `AUTHORIZATION_REQUIRED`; one explicit authorization-required path is still not end-to-end bound to an enrollment/authority transition. |
| PCA-ADD-ENR-020 | PCA-11, PCA-13 | NOT_STARTED | No E2EE alert generator for the addendum's event list; no display component in Parent Web. |
| PCA-ADD-ENR-021 | PCA-10, PCA-13, PCA-15 | NOT_STARTED | Emergency floor exists narrowly (manual toggle in Screen Time only), not evidenced across the required flows generally. |
| PCA-ADD-ENR-022 | PCA-1, PCA-11 | SOURCE_COMPLETE | Strong schema-privacy regression test; enrollment table stores only hash/platform/mode/status/timestamps. |
| PCA-ADD-ENR-023 | PCA-1 | SOURCE_COMPLETE | Creation, transition, expiry, revocation, atomic redemption, opaque correlation, immutable audit persistence, and focused unit/MySQL evidence are present; the elevated backend unit/security suite passed 1,495 tests, while MySQL integration execution remains a separate validation gate. |
| PCA-ADD-ENR-024 | PCA-1, PCA-11, PCA-13 | PARTIAL | Invitation-side reuse/expiry/revocation/wrong-family covered; removal-side unevaluable since that subsystem doesn't exist. |
| PCA-ADD-ENR-025 | PCA-1, PCA-2, PCA-10, PCA-11, PCA-13, PCA-15 | NOT_STARTED | Per-row backend+DB+security+test evidence is not recorded for most of the 25 requirements; this meta-requirement cannot be marked implemented. |

### Addendum 001 status distribution

| Status | Count | IDs |
|---|---:|---|
| SOURCE_COMPLETE | 4 | 004, 006, 007, 022 |
| PARTIAL | 9 | 001, 002, 003, 005, 011, 013, 019, 023, 024 |
| NOT_STARTED | 11 | 008, 009, 010, 012, 014, 016, 017, 018, 020, 021, 025 |
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
| PCA-ADD-PA-041 | PCA-PA-4 | PARTIAL | Dashboard covers most metrics (per-currency breakdowns) but lacks settlement summary and service-health/exception-queue metrics. Unchanged by Round6 (Writer62 owned the Settlement domain/pages, not Dashboard.tsx). |
| PCA-ADD-PA-042 | PCA-PA-4 | SOURCE_COMPLETE | No family-activity table reachable anywhere in the dashboard read model (negative property, verified by absence). |
| PCA-ADD-PA-043 | PCA-PA-3 | PARTIAL | Round6: settlement configuration (SettlementAccount references, access-gated per Section 14) is now real and administrable via the dedicated `/settlement/accounts` surface — 4 of ~8 categories now exist (was 3). Provider-credential/branding/feature-flag surfaces still absent. |
| PCA-ADD-PA-044 | PCA-PA-3 | SOURCE_COMPLETE | Round6: settlement configuration is the first sensitive-settings surface to actually exist and be exercised — `accountToDto` (`settlementRoutes.ts`) returns only `settlementAccountId`/`displayLabel`/`settlementCurrency`/`status`, never the raw `providerRef`, satisfying write-only/masked-read semantics exactly as specified. |
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
| PCA-ADD-BILL-012 | PCA-BILL-3 | SOURCE_COMPLETE | Round6 (Writer62): SettlementAccount entity, migration `0015`, `MySqlSettlementRepository`, full RBAC, Platform Admin UI wired end-to-end by Coordinator glue `c880e19`. |
| PCA-ADD-BILL-013 | PCA-BILL-3 | SOURCE_COMPLETE | Round6 (Writer62): SettlementBatch carries settlement account ref/currency/period/expected gross/fees/net/received/computed difference exactly per spec, DB CHECK-constrained. |
| PCA-ADD-BILL-014 | PCA-BILL-3 | SOURCE_COMPLETE | Round6 (Writer62): Reconciliation MATCHED/UNDER_INVESTIGATION/RESOLVED states; DB-authoritative UNIQUE constraint prevents double-attribution of a `PaymentTransaction` to more than one batch item. |
| PCA-ADD-BILL-015 | PCA-BILL-1 | SOURCE_COMPLETE | Currency co-located with every money-bearing column; vacuously satisfied for the absent settlement tables. |
| PCA-ADD-BILL-016 | PCA-BILL-1 | SOURCE_COMPLETE | No family/policy/key columns; explicit static + live schema-privacy test pair. |
| PCA-ADD-BILL-017 | PCA-BILL-1 | SOURCE_COMPLETE | `amountMinor: bigint` throughout; `InvalidMoneyError` on any non-bigint. |
| PCA-ADD-BILL-018 | PCA-BILL-1 | SOURCE_COMPLETE | Single centralized `CURRENCY_METADATA` map. |
| PCA-ADD-BILL-019 | PCA-BILL-1 | SOURCE_COMPLETE | USD/SAR/YER only; EUR and all others explicitly rejected. |
| PCA-ADD-BILL-020 | PCA-BILL-1 | PARTIAL | No-auto-FX-for-pricing half solidly implemented; USD-normalized reporting rollup still not located. Round6 adds a per-batch `RecordedSettlementFxSnapshotRecord` (recorded rate, not live-fetched) — reinforces the discipline but does not itself add the cross-batch rollup. |
| PCA-ADD-BILL-021 | PCA-BILL-1 | SOURCE_COMPLETE | Round6: now buildable — `SettlementAccount.settlementCurrency` is modeled distinctly from Invoice/PaymentTransaction charge currency, and the Batch/FX-snapshot pair make gross/fees/net/received auditable per spec. |
| PCA-ADD-BILL-022 | PCA-BILL-1 | SOURCE_COMPLETE | Round6: the distinct charge-vs-settlement currency-gate concept now exists at the source level (`SettlementAccount.settlementCurrency` is its own field). Actual per-currency enablement remains correctly gated on `SUPPORTED_CHARGE_CURRENCIES`/`SUPPORTED_SETTLEMENT_CURRENCIES` (external, unchanged, NOT closed here). |
| PCA-ADD-BILL-023 | PCA-BILL-2 | SOURCE_COMPLETE | No card/CVV/routing/secret columns anywhere; three independent schema-privacy tests assert this. |
| PCA-ADD-BILL-024 | PCA-BILL-2 | SOURCE_COMPLETE | Server never becomes a card-data intermediary (architecture correct; unverifiable end-to-end absent a real provider adapter). |
| PCA-ADD-BILL-025 | PCA-BILL-2 | SOURCE_COMPLETE | Resolve-by-reference-only secret indirection; no hardcoded/DB secret values found. |
| PCA-ADD-BILL-026 | PCA-BILL-2 | PARTIAL | DB-schema absence of forbidden terms is tested; no runtime log/diagnostic-output absence test exists for Billing. |
| PCA-ADD-BILL-027 | PCA-BILL-2 | SOURCE_COMPLETE | `PaymentProvider` interface, zero SDK import anywhere, fail-closed on unknown provider. |
| PCA-ADD-BILL-028 | PCA-BILL-2 | SOURCE_COMPLETE | Correctly self-scoped: documents production registry is empty; external gates unresolved by design. |
| PCA-ADD-BILL-029 | PCA-BILL-2 | SOURCE_COMPLETE | Provider is part of the event unique key; multi-provider identity first-class, DB-enforced. |
| PCA-ADD-BILL-030 | PCA-BILL-2 | SOURCE_COMPLETE | TEST_EVIDENCE_PARTIAL: reject-before-trust sequencing correct by inspection, HMAC primitive tested, but no test exercises `WebhookService.processWebhook` directly. |
| PCA-ADD-BILL-031 | PCA-BILL-2 | SOURCE_COMPLETE | DB `UNIQUE(provider, provider_event_id)` idempotency, zero re-execution on duplicate — genuine concurrent-race + redelivery tests. |
| PCA-ADD-BILL-032 | PCA-BILL-2 | SOURCE_COMPLETE | TEST_EVIDENCE_PARTIAL: freshness/replay window logic present and precise (5-minute window, `STALE_REPLAY` audit), but no direct test. |
| PCA-ADD-BILL-033 | PCA-BILL-2 | SOURCE_COMPLETE | TEST_EVIDENCE_PARTIAL: `queryPayment` is the sole authoritative status source, webhook body status never read, but no direct test. |
| PCA-ADD-BILL-034 | PCA-BILL-2 | SOURCE_COMPLETE | TEST_EVIDENCE_PARTIAL: amount/currency cross-checked against the immutable snapshot, mismatch is an anomaly never silently reconciled, but no direct test. |
| PCA-ADD-BILL-035 | PCA-BILL-2 | SOURCE_COMPLETE | Frontend never marks payment state locally; only server-driven `WebhookService` confirms. |
| PCA-ADD-BILL-036 | PCA-BILL-3 | SOURCE_COMPLETE | Round6 (Writer62): SettlementAccount carries id/`providerRef`/currency exactly per spec; `providerRef` never leaves the backend in any GET response (`accountToDto` exposes only `displayLabel`). |
| PCA-ADD-BILL-037 | PCA-BILL-3 | SOURCE_COMPLETE | Round6 (Writer62): SettlementBatch carries all required fields per spec. `batchToDto` does return `providerRef`, but a batch's `providerRef` is the provider's own payout/batch tracking number, not a bank credential — distinct from BILL-036's masking rule, confirmed correct-by-design during this reconciliation. |
| PCA-ADD-BILL-038 | PCA-BILL-3 | SOURCE_COMPLETE | Round6 (Writer62): Reconciliation status exactly MATCHED/UNDER_INVESTIGATION/RESOLVED; DB CHECK + service-layer enforcement both block treating an UNDER_INVESTIGATION batch as resolved. |
| PCA-ADD-BILL-039 | PCA-MYKIDS-BILL-1 | PARTIAL | Full UI+backend flow genuinely exists (`Subscription.tsx` etc., contradicting the addendum's own stale "placeholder" claim), but unreachable end-to-end today — `SERVICE_SESSION_UNAVAILABLE` (closed by Round5 `PCA-AUTH-SESSION-1`). |
| PCA-ADD-BILL-040 | PCA-MYKIDS-BILL-1 | SOURCE_COMPLETE | Owner-only gate enforced server-side; the REAL attestation-chain resolver (not a stub) is wired in production `main.ts` (`familyCommercialRoutes.test.mjs`, ROLE_DENIED tests for Administrator/Viewer). |
| PCA-ADD-BILL-041 | PCA-PA-1 | PARTIAL | No real production payment-provider adapter exists yet (only a test/dev-restricted sandbox), so real-money billing structurally cannot go live — but no explicit engineered "refuse in production" kill-switch exists for a hypothetical future adapter. |
| PCA-ADD-BILL-043 | PCA-BILL-1 | SOURCE_COMPLETE | Quote/price snapshot immutability directly, explicitly regression-tested (survives later PriceBook change and Quote expiry/supersession). |
| PCA-ADD-BILL-044 | PCA-BILL-1 | SOURCE_COMPLETE | Price-book admin RBAC matches the addendum's role matrix exactly, including the PLATFORM_ADMIN view-only carve-out. |
| PCA-ADD-BILL-045 | PCA-BILL-1 | SOURCE_COMPLETE | CommercialMarket country-mapping is data-driven config, not hardcoded logic. |
| PCA-ADD-BILL-046 | PCA-PA-2, PCA-BILL-2 | SOURCE_COMPLETE | Idempotency key is provider-event-ID-derived (not request-ID-only); exactly-once confirmed under N=8 concurrent duplicates. |
| PCA-ADD-BILL-047 | PCA-PA-2, PCA-BILL-2 | SOURCE_COMPLETE | Limit-raise never touches slot reservations — holds by construction; no dedicated regression test proves survival under a concurrent race. |

### Addendum 002 status distribution (R4 correction, Round6)

| Status | Count |
|---|---:|
| SOURCE_COMPLETE (incl. `TEST_EVIDENCE_PARTIAL`-annotated rows) | 85 |
| PARTIAL | 12 |
| NOT_STARTED | 1 |
| NOT_APPLICABLE | 0 |
| EXTERNAL_GATE (as primary status) | 0 |

PA: 42 SOURCE_COMPLETE, 8 PARTIAL (`006,017,020,027,036,041,043,047`), 1 NOT_STARTED (`048`) = 51. Round6 closes `044` (settlement-config masked-read now real).
BILL: 43 SOURCE_COMPLETE, 4 PARTIAL (`020,026,039,041`), 0 NOT_STARTED = 47. Round6 (Writer62, `PCA-BILL-3`) closes the entire Settlement/Reconciliation gap (`012/013/014/021/036/037/038`) and the charge-vs-settlement currency-gate concept (`022`).

Six requirements (`PCA-ADD-BILL-027`–`029`, `PCA-ADD-BILL-022`, `PCA-ADD-BILL-036`–`038`) carry a non-empty `externalGate` annotation in the JSON matrix (`PAYMENT_PROVIDER_SELECTION`/`MERCHANT_ACCOUNT_APPROVAL`/`SUPPORTED_CHARGE_CURRENCIES`/`SUPPORTED_SETTLEMENT_CURRENCIES` and `SETTLEMENT_BANK_CONFIGURATION` respectively) — all are `SOURCE_COMPLETE` as of Round6 (the external gate blocks only real production use/enablement, not the abstraction or the settlement domain itself, which is now fully built and tested).

Four requirements (`PCA-ADD-BILL-030/032/033/034`) carry a `SOURCE_COMPLETE; TEST_EVIDENCE_PARTIAL` status: the underlying `WebhookService` orchestration logic genuinely and correctly implements each requirement (verified by direct code inspection against the addendum's normative text), but no test file anywhere in the repository imports or exercises `WebhookService` itself — only its lower-level dependencies (HMAC signature verification, DB-level event idempotency) are directly tested. This is tracked as a test-coverage gap, not a source gap.

## Addendum 003 implementation matrix (parent identity, registration, free-access)

[PCA_ADDENDUM_003_PARENT_IDENTITY_REGISTRATION_FREE_ACCESS.md](addenda/PCA_ADDENDUM_003_PARENT_IDENTITY_REGISTRATION_FREE_ACCESS.md) is the authority for full normative text. Reconciled against Round5 `PCA-AUTH-SESSION-1` source (Writer57, independently QA57-verified). Full per-ID evidence in [PCA_COMPLETION_V2_MATRIX.json](PCA_COMPLETION_V2_MATRIX.json).

| Requirement | Status | Summary |
|---|---|---|
| PCA-ADD-IDENT-001 | SOURCE_COMPLETE | Independent credential domain, no shared table/session/RBAC with Platform Administration. |
| PCA-ADD-IDENT-002 | SOURCE_COMPLETE | Session response carries no field usable to authenticate into Platform Administration. |
| PCA-ADD-IDENT-003 | SOURCE_COMPLETE | Email stored only as a normalized-lowercase hash; password only as a salted hash. |
| PCA-ADD-IDENT-004 | SOURCE_COMPLETE | Register requires email/password/passwordConfirmation; server never trusts client-asserted match. |
| PCA-ADD-IDENT-005 | SOURCE_COMPLETE | TEST_SANDBOX-style sender; production uses a fail-closed sender (Coordinator-wired), real provider remains EXTERNAL_GATE. |
| PCA-ADD-IDENT-006 | SOURCE_COMPLETE | PENDING_VERIFICATION until correct code submitted before expiry. |
| PCA-ADD-IDENT-007 | SOURCE_COMPLETE | Single-use, TTL-bounded codes; keyed rate limiting per account and source IP. |
| PCA-ADD-IDENT-008 | SOURCE_COMPLETE | DB CHECK-constraint-atomic verification transition produces the VerifiedIdentity AuthService already required. |
| PCA-ADD-IDENT-009 | PARTIAL | Genesis trigger wired/tested via an ephemeral browser-signed keypair (flagged INTERFACE_CHANGE_REQUEST); production remains fail-closed pending PCA-DEC-020. |
| PCA-ADD-IDENT-010 | SOURCE_COMPLETE | No existing trusted family device required — a fresh ephemeral keypair is generated at registration. |
| PCA-ADD-IDENT-011 | SOURCE_COMPLETE | Invitation-based joining is unchanged; no join-on-register behavior was added. |
| PCA-ADD-IDENT-012 | SOURCE_COMPLETE | HttpOnly/Secure(prod)/SameSite=Strict cookie + double-submit CSRF, issued only after verification/login. |
| PCA-ADD-IDENT-013 | SOURCE_COMPLETE | Session never carries a role/authority field; FamilyCommercialAuthorityResolver remains the sole Owner-authority source. |
| PCA-ADD-IDENT-014 | SOURCE_COMPLETE | Expired/revoked/missing session all collapse to the same 401, verified live. |
| PCA-ADD-IDENT-015 | SOURCE_COMPLETE | Session bound to one accountId at issuance; per-request family-scope authorization unchanged. |
| PCA-ADD-IDENT-016 | SOURCE_COMPLETE | Ephemeral genesis private key never persisted/logged — every call site traced by QA57. |
| PCA-ADD-IDENT-017 | SOURCE_COMPLETE | FREE_ACCESS_MODE/DURATION_DAYS/default limits all env-configurable, bounds-validated. |
| PCA-ADD-IDENT-018 | SOURCE_COMPLETE | FreeAccessSnapshot captured at registration; distinct from and layered alongside FREE_STARTER entitlement_defaults. |
| PCA-ADD-IDENT-019 | SOURCE_COMPLETE | Round6 (Writer61): `FreeAccessAdminService.adjustAccount()` is an explicit, separately audited administrative action (EXTEND/REDUCE/CONVERT_TO_PERPETUAL/CONVERT_TO_TIME_LIMITED), step-up-gated, structurally independent of `getGlobalDefaults` — never a side effect of a platform-wide default change. |
| PCA-ADD-IDENT-020 | SOURCE_COMPLETE | Round6 (Writer61): `FreeAccessReminderBannerView` renders exact remaining days, expiry date, and a Billing CTA during `TIME_LIMITED` free access, matching the requirement verbatim. |
| PCA-ADD-IDENT-021 | PARTIAL | Round6 (Writer61): the allowed/denied matrix is correct by construction (auth/billing/status always available; existing protections never disabled on expiry) but the positive half — restricting new commercial-capability acquisition — has no consuming call site yet in SlotReservationService/ChangeRequestService/enrollment. Enforcement function built/tested in isolation only. |
| PCA-ADD-IDENT-022 | SOURCE_COMPLETE | True by construction: FREE_ACCESS and entitlement OVER_LIMIT are structurally separate, unconnected systems. |
| PCA-ADD-IDENT-023 | SOURCE_COMPLETE | Platform-Administration-owned configuration (env var only, no live UI yet). |
| PCA-ADD-IDENT-024 | SOURCE_COMPLETE | 30-day default explicitly labeled illustrative; every value runtime-configurable. |

### Addendum 003 status distribution (R4 correction, Round6)

| Status | Count |
|---|---:|
| SOURCE_COMPLETE | 22 |
| PARTIAL | 2 |
| NOT_STARTED | 0 |

## Addendum 004 implementation matrix (complimentary entitlement grants)

[PCA_ADDENDUM_004_COMPLIMENTARY_ENTITLEMENTS.md](addenda/PCA_ADDENDUM_004_COMPLIMENTARY_ENTITLEMENTS.md) is the authority for full normative text. Reconciled against Round5 `PCA-COMPLIMENTARY-ENTITLEMENTS-1` source (Writer58, independently QA58-verified). Full per-ID evidence in [PCA_COMPLETION_V2_MATRIX.json](PCA_COMPLETION_V2_MATRIX.json).

| Requirement | Status | Summary |
|---|---|---|
| PCA-ADD-COMP-001 | SOURCE_COMPLETE | Architecturally distinct from Billing — no Invoice/PaymentAttempt/PaymentTransaction/ProviderEvent type referenced. |
| PCA-ADD-COMP-002 | SOURCE_COMPLETE | Zero billing-object construction found; PriceBook completely untouched. |
| PCA-ADD-COMP-003 | SOURCE_COMPLETE | Grant record matches the frozen field list exactly. |
| PCA-ADD-COMP-004 | SOURCE_COMPLETE | Three scopes, never combined in one record. |
| PCA-ADD-COMP-005 | SOURCE_COMPLETE | Round6 (Writer60): `EffectiveEntitlementCapacity.computeEffectiveEntitlementSnapshot` is now consulted by the real consumption gates (`MySqlEntitlementRepository`/`MySqlSlotReservationRepository`, both take an optional `ComplimentaryGrantRepository`, wired unconditionally by Coordinator glue in `main.ts`). Capacity is now genuinely consumable. |
| PCA-ADD-COMP-006 | SOURCE_COMPLETE | Conditional UPDATE ... WHERE status=ACTIVE; retried mutation verified to produce no double-apply under real concurrency. |
| PCA-ADD-COMP-007 | SOURCE_COMPLETE | Bounded enum, all 10 categories. |
| PCA-ADD-COMP-008 | SOURCE_COMPLETE | No email-domain inference; manual admin grant only, no HR integration. |
| PCA-ADD-COMP-009 | SOURCE_COMPLETE | Zero special-cased authority logic for any category — STAFF is a label only. |
| PCA-ADD-COMP-010 | SOURCE_COMPLETE | Round6: now reachable in practice via the same consumption-gate wiring as COMP-005; capacity above a grant correctly falls through to normal PriceBook rules. |
| PCA-ADD-COMP-011 | SOURCE_COMPLETE | Round6: real OVER_LIMIT triggering now depends on the effective (base+active-grants) limit, recomputed at read time on every limit check, verified under real concurrency. |
| PCA-ADD-COMP-012 | SOURCE_COMPLETE | Expiry/revoke only flip grant status; active/reserved counts never touched. |
| PCA-ADD-COMP-013 | SOURCE_COMPLETE | No family-facing mutation route exists; Platform Administration only. |
| PCA-ADD-COMP-014 | SOURCE_COMPLETE | Role matrix matches the frozen spec exactly, server-enforced (live HTTP-level denial test). |
| PCA-ADD-COMP-015 | SOURCE_COMPLETE | COMPLIMENTARY_GRANT_MUTATION step-up required and single-use-consumed before every mutation. |
| PCA-ADD-COMP-016 | SOURCE_COMPLETE | Full audit event vocabulary, safe metadata only, same-transaction as the mutation. |
| PCA-ADD-COMP-017 | SOURCE_COMPLETE | Platform Admin UI built; server independently re-checks every mutation regardless of UI state. |
| PCA-ADD-COMP-018 | SOURCE_COMPLETE | Round6 (Coordinator glue `c880e19`): `buildEffectiveEntitlementDto` now composed into `familyCommercialRoutes.ts`'s entitlement GET handler; MyKids now displays complimentary capacity. Closes the Round5-deferred item. |
| PCA-ADD-COMP-019 | SOURCE_COMPLETE | Serialized read-model output verified to never contain internalNote or grantedByAdminId. |
| PCA-ADD-COMP-020 | SOURCE_COMPLETE | No "payment bypass"-style language found anywhere in the family-facing surface. |
| PCA-ADD-COMP-021 | SOURCE_COMPLETE | All 5 required concurrency scenarios pass under genuinely concurrent execution, independently re-run by QA58. |
| PCA-ADD-COMP-022 | SOURCE_COMPLETE | Conditional UPDATE/DELETE pattern throughout; no in-memory lock anywhere. |
| PCA-ADD-COMP-023 | SOURCE_COMPLETE | Dedicated migration/table; entitlement_defaults/Billing tables untouched. |
| PCA-ADD-COMP-024 | SOURCE_COMPLETE | Migration lease (0014) assigned from the actual current inventory at launch time. |
| PCA-ADD-COMP-025 | SOURCE_COMPLETE | Disposable Docker Compose MySQL only; no production SQL touched. |

### Addendum 004 status distribution (R4 correction, Round6)

| Status | Count |
|---|---:|
| SOURCE_COMPLETE | 25 |
| PARTIAL | 0 |
| NOT_STARTED | 0 |

## Completion calculation (calculated, not projected)

`BASE_A100_REQUIREMENTS = 199`, `ADDENDUM_001_REQUIREMENTS = 25`, `ADDENDUM_002_REQUIREMENTS = 98`, `ADDENDUM_003_REQUIREMENTS = 24`, `ADDENDUM_004_REQUIREMENTS = 25`, `TOTAL_CONTROLLED_REQUIREMENTS = 371`.

`MISSING_IDS = 0`, `DUPLICATE_IDS = 0`, `ORPHAN_IDS = 0` across all five inventories, each verified exact against its own source document. Addendum 003 (`PCA-ADD-IDENT-001`..`024`, contiguous) and Addendum 004 (`PCA-ADD-COMP-001`..`025`, contiguous) were authored in Round5 pre-flight and now have real Round5 source reconciled against them (R3 correction below).

Addendum 001 (R0 pass, preserved unchanged): `SOURCE_COMPLETE = 4`, `PARTIAL = 8`, `NOT_STARTED = 12`, `NOT_APPLICABLE = 1`.

Addendum 002 (R2 correction): `SOURCE_COMPLETE = 76` (including 4 `TEST_EVIDENCE_PARTIAL`-annotated rows), `PARTIAL = 13`, `NOT_STARTED = 9`, `NOT_APPLICABLE = 0`.

Addendum 003 (R3 correction, this pass): `SOURCE_COMPLETE = 20`, `PARTIAL = 1`, `NOT_STARTED = 3`, `NOT_APPLICABLE = 0` — `PCA-AUTH-SESSION-1` landed; genesis-device-signer fail-closed pending `PCA-DEC-020`; `FREE_ACCESS` daily-reminder UI/admin bulk-change path not built.

Addendum 004 (R3 correction, this pass): `SOURCE_COMPLETE = 22`, `PARTIAL = 3`, `NOT_STARTED = 0`, `NOT_APPLICABLE = 0` — `PCA-COMPLIMENTARY-ENTITLEMENTS-1` landed; complimentary-capacity consumption gates not yet wired (real, honestly-scoped Coordinator follow-up, outside Writer58 ownership).

None of the 371 controlled requirements are `VALIDATED_COMPLETE` or `PRODUCTION_READY` — `SOURCE_COMPLETE` here means genuinely implemented and (in almost all cases) test-covered source, never real-device/real-environment execution evidence, external-gate closure, or a production-readiness claim. No requirement in any addendum (001-004) is marked `VALIDATED_COMPLETE` or `PRODUCTION_READY`.

Base A-100: individual per-ID `IMPLEMENTED`/`IMPLEMENTED_TESTED`/`PLATFORM_LIMITED` counts are **not yet calculated** — see scope limitation above. The phase-level (PCA-0..19) re-derivation in `PCA_CURRENT_IMPLEMENTATION_STATUS.md` §4 stands in as the best current evidence-based signal until a full per-ID pass is done; treat it as directionally reliable, not as a substitute for the still-pending per-ID base-inventory audit.

Platform-limited requirements (PCA-15/iOS-linked, and any requirement depending on Android real-device/Device-Owner validation) must identify the unavailable environment and pending evidence; they cannot be represented as tested. See `PCA_CURRENT_IMPLEMENTATION_STATUS.md` §9 for the current external gate matrix, including the six new Addendum-002 commercial gates (`PAYMENT_PROVIDER_SELECTION`, `MERCHANT_ACCOUNT_APPROVAL`, `SUPPORTED_CHARGE_CURRENCIES`, `SUPPORTED_SETTLEMENT_CURRENCIES`, `SETTLEMENT_BANK_CONFIGURATION`, `PAYMENT_PRODUCTION_CERTIFICATION`).

## Preserved from R0

The following were established in the R0 pass and are **not re-scored** by this R1 correction (per its narrow scope): the PCA-0..19/PCA-WELL-1 phase matrix, the Addendum-001 status distribution above, and all known source gaps (device-wide VPN filtering incomplete, SafeSearch incomplete, production crypto review not approved, real UAT 0/50, iOS Xcode/entitlement/device gates, YouTube Mode B gate, family-authority RBAC gap, PIN/removal subsystem gaps, Android tamper gap). See `PCA_CURRENT_IMPLEMENTATION_STATUS.md` for the full narrative, now updated only where Addendum 002 integration required it (Platform Administration/Billing sections).

