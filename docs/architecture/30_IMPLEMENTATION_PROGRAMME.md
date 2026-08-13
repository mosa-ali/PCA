# 30 — Implementation Programme

**Status note (realignment `PCA-DOC-REALIGN-1`, 2026-08-14):** this document previously read "Future; Not Yet Authorized — Implementation starts only after `A-100 DOCUMENTATION ACCEPTED`" as if no phase had begun. `A-100` has been declared `OWNER_ACCEPTED` (doc 34), and a repository survey conducted as part of this realignment confirms that implementation has, in fact, progressed well past PCA-0 across several domains. This document is corrected below to report actual status using the three-tier completion framework defined in doc 00 Section 8A. This correction is a status-accuracy fix; it does not itself grant authorization for any phase not already evidenced as underway, and it does not change any external gate in doc 31.

## Completion framework

Every phase below is reported on three independent tiers (doc 00 Section 8A):

- **`SOURCE_COMPLETE`** — code exists implementing the phase's scope. `YES` (source evidence found), `PARTIAL` (some but not all scope has source), or `NO`.
- **`VALIDATED_COMPLETE`** — tested/verified against acceptance criteria with recorded evidence (doc 28/32). This realignment pass confirmed the *existence* of test suites alongside source in several domains (survey found ~35 backend test subdirectories mirroring `src/` modules, 140 Android test files, 39 Parent Web test files across unit/component/route/accessibility/i18n/responsive, and 14 iOS test files) but did not itself execute those suites or confirm a passing state — so `VALIDATED_COMPLETE` below is reported conservatively as `NOT_CONFIRMED` unless independently re-verified, never inferred from source/test-file presence alone.
- **`PRODUCTION_READY`** — cleared every applicable external gate (doc 31) and release criterion (doc 25/28/29). No phase below is `PRODUCTION_READY`: every external gate in doc 31 remains open.

## Phase status (realigned 2026-08-14)

| Phase | Scope | SOURCE_COMPLETE | VALIDATED_COMPLETE | PRODUCTION_READY | Evidence / notes |
|---|---|---|---|---|---|
| **PCA-0** — Repository and quality foundation | Native workspace structure, shared contracts, test/lint/security baselines | YES | NOT_CONFIRMED | NO | `contracts/`, `tooling/` (bootstrap, quality, release, repo-checks, security, test-fixtures), `.github/workflows/quality-gates.yml` present |
| **PCA-1** — Cryptographic enrollment and local vault | Family/device keys, QR pairing, encrypted local storage, recovery baseline | PARTIAL | NOT_CONFIRMED | NO | `backend/src/{enrollment,pairing,deviceauth,invitation,familytrustset,familyenvelope,recovery}`, `android/persistence/crypto`, `docs/security/production-crypto-review/` package exist; iOS `Keychain`/`Enrollment` scaffolding is thin (~part of the 3,550-line iOS total). Gated `PRODUCTION_READY` on `CRYPTO_SECURITY_REVIEW` (doc 31) regardless of source maturity |
| **PCA-2** — Android platform foundation | Standard Mode capability adapter, usage access, VPN baseline, Protected Mode feasibility gate | YES (Standard Mode adapter) | NOT_CONFIRMED | NO | `DevicePolicyCapabilitySource`/`StandardDevicePolicyCapabilitySource` present; Protected Mode gated on `PCA-DEC-001` (doc 31) |
| **PCA-3** — Screen-time/break engine | Deterministic state machine, offline persistence, break UX, emergency exceptions | YES | NOT_CONFIRMED | NO | `android/feature/screentime/engine/ScreenTimeEngine.kt` + baseline policy/applier/persistence/restorer present |
| **PCA-4** — App usage and schedule controls | — | PARTIAL | NOT_CONFIRMED | NO | `backend/src/{schedule,usage}` present |
| **PCA-5** — Web filtering and PCA Safe Browser | — | YES | NOT_CONFIRMED | NO | `android/feature/webprotection` (engine + full Safe Browser UI: Activity/Controller/Screen/UiState), `backend/src/safebrowser` |
| **PCA-6** — YouTube controlled-mode feasibility and compliant integration | — | PARTIAL | NOT_CONFIRMED | NO | `backend/src/youtube`, `ios/PCA/YouTube` (thin); gated on `YOUTUBE_MODE_B_POLICY_REVIEW` (doc 31) for Mode B regardless of source state |
| **PCA-7** — Location and last-seen | — | PARTIAL | NOT_CONFIRMED | NO | `backend/src/location`, `android runtime/location`, `ios/PCA/Location` (thin) |
| **PCA-8** — Eye-distance/proximity protection | — | NOT_CONFIRMED | NOT_CONFIRMED | NO | No dedicated module surfaced in this pass's survey; requires targeted re-check before being reported otherwise |
| **PCA-9** — Prayer-time engine | — | PARTIAL | NOT_CONFIRMED | NO | `ios/PCA/Prayer` scaffolding present; backend/Android prayer-engine presence not confirmed in this pass |
| **PCA-10** — Parent dashboard, RBAC and child requests | — | YES | NOT_CONFIRMED | NO | `backend/src/{parentpanel,familyrbac,childrequests,childprofiles}`, `parent-web/src/{rbac,pages/family,pages/children}` |
| **PCA-11** — E2EE relay synchronization | — | YES | NOT_CONFIRMED | NO | `backend/src/{familyenvelope,familysync,runtime-sync,relay}`; recent commit history shows active work on sync-envelope atomicity. Gated `PRODUCTION_READY` on `CRYPTO_SECURITY_REVIEW` |
| **PCA-12** — Retention/deletion and encrypted export | — | YES | NOT_CONFIRMED | NO | `backend/src/{retention,export}` present |
| **PCA-13** — Tamper detection and recovery hardening | — | YES | NOT_CONFIRMED | NO | `backend/src/tamper`, `backend/src/recovery` present |
| **PCA-14** — On-device AI classifiers and signed model lifecycle | — | PARTIAL | NOT_CONFIRMED | NO | `backend/src/ai` present; on-device Android/iOS classifier maturity not separately confirmed. Gated on `CLOUD_AI_OWNER_DECISION` where applicable |
| **PCA-15** — iOS Family Controls implementation | — | PARTIAL (early) | NOT_CONFIRMED | NO | `ios/PCA/{FamilyControls,DeviceActivity,ManagedSettings}` directories exist but the entire iOS source tree is ~3,550 lines/44 files — materially thinner than Android/backend; treat as early-stage, not "substantial," until re-surveyed. Gated on `IOS_MAC_XCODE`, `IOS_FAMILY_CONTROLS_ENTITLEMENT`, `IOS_PHYSICAL_DEVICE` (doc 31) regardless of source maturity |
| **PCA-16** — Arabic/English accessibility and UX closure | — | YES (Parent Web) | NOT_CONFIRMED | NO | `parent-web/src/i18n/locales/ar.json`, dedicated `tests/i18n`/`tests/responsive` suites present; Android/iOS-side i18n completeness not separately confirmed |
| **PCA-17** — Security/privacy red team and store compliance | — | PARTIAL (documentation-level) | NOT_CONFIRMED | NO | `docs/release_readiness/{RELEASE_GATE.md,RELEASE_EVIDENCE.md,UAT_TEST_PLAN.md,EXTERNAL_GATE_MATRIX.md,ROLLBACK_CHECKLIST.md}` and `docs/security/production-crypto-review/` exist as operational/process artifacts; this is evidence a process exists, not evidence the red team or store submission has completed |
| **PCA-18** — Family beta/UAT | — | NO | NOT_CONFIRMED | NO | No evidence of a beta/UAT cohort found in this pass |
| **PCA-19** — Production release | — | NO | NOT_CONFIRMED | NO | Blocked on all applicable doc 31 external gates plus doc 25/28/29 release gates |

**Domain-level summary** (repository survey, `PCA-DOC-REALIGN-1`, 2026-08-14): `backend/` (~16,800 lines/205 files across ~30 modules) and `android/` (~33,000 lines/394 files) are the most developed domains, with working implementations of RBAC, enrollment/device auth, family trust set/sync, screen-time engine, and web filtering/Safe Browser. `parent-web/` (~10,600 lines/153 files) is moderately developed with dashboard/RBAC/i18n and a sizeable test suite. `ios/` (~3,550 lines/44 files) is comparatively early-stage — per-feature directories exist but with materially less depth than Android/backend. `parent-sdk/` (~1,700 lines/23 files) supplies small shared runtime-sync/wellbeing-control contract packages. No Platform Administration or Billing source exists anywhere in the repository (confirmed by targeted search for billing/payment/invoice/subscription/stripe/paypal terms); `parent-web/src/pages/Subscription.tsx` is a static 14-line placeholder only. See `docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md` Section 21 for that programme's own phase table (`PCA-PA-*`/`PCA-BILL-*`/`PCA-MYKIDS-BILL-1`), all currently `NOT_STARTED` on every tier.

**Traceability caveat**: `docs/implementation/PCA_IMPLEMENTATION_TRACEABILITY.md` currently marks all 25 Addendum 001 requirements `NOT_IMPLEMENTED`. This realignment pass did not re-verify Addendum 001's requirement-by-requirement implementation status against the source found (e.g. `backend/src/invitation`, `backend/src/pairing`, `backend/src/deviceauth` plausibly implement some `PCA-ADD-ENR-*` requirements) — that granular re-verification is a follow-up item, not something this documentation-realignment pass certifies. Do not treat this document's phase-level `SOURCE_COMPLETE = YES/PARTIAL` marks above as equivalent to a specific `PCA-ADD-ENR-*` or `PCA-FR-*` ID being individually confirmed; only doc 32/`PCA_IMPLEMENTATION_TRACEABILITY.md`, kept current, can make that claim at ID granularity.

## Addendum 002 — Platform Administration and Billing programme

A new programme, fully specified but with no source implementation, is defined in `docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md` Section 21: workstreams `PCA-PA-1` through `PCA-PA-6`, `PCA-PA-UAT`, `PCA-BILL-1` through `PCA-BILL-3`, `PCA-BILL-UAT`, and `PCA-MYKIDS-BILL-1`. Every workstream in that programme is `SOURCE_COMPLETE = NO` as of this realignment; see the addendum for full scope, entitlement/pricing model, and the platform-commercial external gates (`PAYMENT_PROVIDER_SELECTION`, `MERCHANT_ACCOUNT_APPROVAL`, `SUPPORTED_CHARGE_CURRENCIES`, `SUPPORTED_SETTLEMENT_CURRENCIES`, `SETTLEMENT_BANK_CONFIGURATION`, `PAYMENT_PRODUCTION_CERTIFICATION`) that gate its `PRODUCTION_READY` tier independent of engineering completion.

## Programme control

- one main orchestrator;
- exact file/module ownership;
- no uncontrolled parallel writes to shared files;
- implementation agents must test their owned slice;
- independent red-team verification before phase acceptance;
- no "100% complete" report while any acceptance criterion is partial — and, per the three-tier framework above, no report may claim `VALIDATED_COMPLETE` or `PRODUCTION_READY` on the strength of `SOURCE_COMPLETE` alone.
