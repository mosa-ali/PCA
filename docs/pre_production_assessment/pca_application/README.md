# PCA Application (Android + iOS) — Pre-Production Assessment — Report Set

Status: READ-ONLY assessment of `android/**` and `ios/**` at `pca-dev` @ `9496fb19`.
No application source was modified. Only this report directory was written.

## Reconstruction notice (read first)

The mission text that commissioned this assessment was pasted as a large chat
attachment ("Pasted text #1") and was lost when the chat session restarted
mid-run; only the interrupted run's own working record survived. This set was
therefore reconstructed to match what that record proves the mission required:

- a **mobile** (Android + iOS) pre-production assessment, strictly read-only;
- reports written to `docs/pre_production_assessment/pca_application/`;
- deliverable shape recorded as **"13 mobile reports + 3 JSON registers"** plus a
  final verdict block.

The **file names below may differ** from the original mission's enumeration.
The findings, evidence and verdicts are source-verified and stand on their own;
reconcile names with the owner's original text when it is recoverable.

## Evidence labels used in every report

- `[READ]` — read directly from source this session, with `path:line` citations.
- `[RECORDED]` — from the interrupted run's session record (CI runs, worktree
  state); re-verify with the commands in report 13 when a terminal is available.
- `[BLOCKED]` — cannot be executed in this session (no terminal tool available:
  no `git`, `gh`, `gradle`, `xcodebuild`); exact commands are provided in
  report 13 so the owner can close these gaps.

## Index

| # | Report | Contents |
|---|--------|----------|
| 01 | `01_BASELINE_GIT_AND_WORKTREE.md` | Branch/HEAD/origin, reflog, worktree state, mobile recency, CI-at-HEAD |
| 02 | `02_ANDROID_ARCHITECTURE_AND_COMPOSITION.md` | Packages, manifest, build config, composition root, wired vs dead |
| 03 | `03_ANDROID_ENROLLMENT_FLOW.md` | Deep-link parsing, states, bootstrap API, persistence, recovery, gaps |
| 04 | `04_ANDROID_DEVICE_IDENTITY_AND_PROOF.md` | Device identity, keystore reality, proof pipeline (dead), implications |
| 05 | `05_ANDROID_RUNTIME_FEATURES_AND_BACKGROUND.md` | Feature inventory, background execution, sync transport, tests, security-lite |
| 06 | `06_IOS_ARCHITECTURE_AND_COMPOSITION.md` | Targets, signing, entitlements, composition root, wired vs dead |
| 07 | `07_IOS_ENROLLMENT_FLOW.md` | Entry points, gates, bootstrap/session APIs, link parser, reachability verdict |
| 08 | `08_IOS_FAMILY_CONTROLS_DEVICEACTIVITY_SHIELD.md` | Authorization, picker absence, scheduling, monitor/shield extensions, dead paths |
| 09 | `09_MOBILE_BACKEND_CONTRACT_PARITY.md` | Backend endpoints, client parity table, mismatches |
| 10 | `10_SECURITY_PRIVACY_AND_SIGNING.md` | Exports, secrets scan, TLS posture, entitlements, signing reality |
| 11 | `11_TEST_COVERAGE_AND_CI_EVIDENCE.md` | Test inventories (Android/iOS), CI jobs, UAT workflow reality |
| 12 | `12_EXTERNAL_GATES_AND_RELEASE_READINESS.md` | All mobile external gates, statuses, what each blocks |
| 13 | `13_MASTER_VERDICT.md` | Consolidated verdict, blocking analysis, next steps, command list |

## Registers (`registers/`)

- `mobile_findings_register.json` — every finding with id, severity, area,
  evidence (`path:line`), status and recommendation.
- `mobile_external_gates.json` — the mobile subset of the external gate matrix.
- `mobile_evidence_index.json` — claim -> evidence map and reproduction commands.

## Headline

Neither platform can complete device enrollment end-to-end today: both fail
closed at the cryptography gate (by design, pending external crypto review).
Independently, iOS has a broken enrollment-entry path (`pca://` scheme not
registered; universal-link host is an unowned placeholder), and large parts of
both runtimes are composed only in tests, not in production. See report 13 for
the full verdict.

---

## FINAL CROSS-ASSESSMENT UPDATE — API + PARENT/PLATFORM (2026-09-26)

Documentation-only reconciliation with the completed API assessment
(`docs/pre_production_assessment/api/`) and the Parent+Platform final assessment
(`docs/pre_production_assessment/pca_parent_platform/`). No mobile finding is
rewritten; no severity changed without evidence; historical conclusions preserved.

### Change records

**R1 — Android enrollment dependency is now MULTI-LAYER (new cross-layer blocker PP-F01)**

- ORIGINAL_FINDING = MOB-004 (enrollment link host `enroll.pca.app` is an unowned
  placeholder; App Link path externally gated) + report 03 §1/§7: Android accepts
  `https://enroll.pca.app/<token>` as the App-Link continuation form of the
  enrollment link that Parent Web generates.
- NEW_EVIDENCE = the live Parent Web production bundle
  (`https://parent.pcasafe.com/assets/index-pwh0Qt3P.js`) ships
  `deviceEnrollmentLinkBaseUrl:"http://localhost:4000/enroll"` as the ACTIVE value
  (the env var `VITE_PCA_DEVICE_ENROLLMENT_LINK_BASE_URL` is undocumented and unset;
  `parent-web/src/config/env.ts:79` fallback). Every generated enrollment link/QR is
  therefore `http://localhost:4000/enroll/<token>` — it matches neither Android's
  `pca://enroll?token=` shape nor its `https://<APP_LINK_HOST>/<token>` App-Link shape.
- SOURCE_ASSESSMENT = `pca_parent_platform`: report 04 §2 (PP-F01 evidence chain),
  report 07 §3–4, register `parent_platform_findings.json` PP-F01, risk R-PP-02.
- REVISED_DEPENDENCY = Android enrollment is a **MULTI_LAYER** dependency:
  1. Parent Web (link base configuration + missing production guard),
  2. Android (App-Link/deep-link host contract — `EnrollmentDeepLinkConfig.APP_LINK_HOST`),
  3. API/security gate (the existing crypto gate, MOB-001, still blocks the ceremony),
  4. deployment/domain configuration (owned host + assetlinks/AASA hosting, MOB-004).
- VERDICT_CHANGED = **NO** (MOB-004 stays P1/EXTERNAL; scope expanded and recorded).

**R2 — API assessment confirms the mobile findings (none contradicted)**

- ORIGINAL_FINDING = the API-relevant mobile set (MOB-001/002/005/008/009/012/014/015/019/024 …).
- NEW_EVIDENCE = `api/14_API_TO_MOBILE_RECONCILIATION.md`: 12 mobile findings CONFIRMED,
  0 reclassified, 0 contradicted; `api/08`: 16-call mobile↔API contract matrix, zero drift;
  backend twin gate confirmed at source (`main.ts:363`); iOS invitation minting refused by
  decision (`invitationRoutes.ts:113`, `PLATFORM_ENROLLMENT_UNAVAILABLE`) — the iOS
  bootstrap path is additionally unreachable by construction.
- SOURCE_ASSESSMENT = `api/08`, `api/14`.
- REVISED_DEPENDENCY = Android/iOS API dependency remains CONDITIONAL (unchanged).
- VERDICT_CHANGED = **NO**.

**R3 — New backend/API dependencies recorded for the pre-UAT slice**

- ORIGINAL_FINDING = client-side composition gaps MOB-012/014/015/018 (+MOB-005/009).
- NEW_EVIDENCE = api findings API-F02 (in-memory device sessions), F03 (no session
  revocation), F04 (no device-initiated unenroll), F05 (audit/logging gaps), F06 (no
  policy read-back), F07 (web-rules 503 scaffold), F08 (post-commit 500 recoverable via
  `/recover`), F12 (no client-version gating).
- SOURCE_ASSESSMENT = `api/12`, `api/14`, `api/15` (roadmap).
- REVISED_DEPENDENCY = the API roadmap's P2 slice (durable sessions + revocation bundled
  with the crypto-gate exit) is a precondition for meaningful device UAT.
- VERDICT_CHANGED = **NO**.

**R4 — iOS: server-side refusal of iOS invitation minting recorded**

- ORIGINAL_FINDING = MOB-002/MOB-003/MOB-004 (iOS entry + crypto gates).
- NEW_EVIDENCE = `api/04 §2` + `api/14`: iOS invitation minting returns
  `400 PLATFORM_ENROLLMENT_UNAVAILABLE` by committed decision (regression-guarded).
- SOURCE_ASSESSMENT = `api/04`, `api/14`.
- REVISED_DEPENDENCY = iOS enrollment remains blocked on product/engineering decision
  + crypto gate + entry-path fixes (unchanged set; the server side is now explicit).
- VERDICT_CHANGED = **NO**.

### Required final conclusions

```text
MOBILE_VERDICT_CHANGED = NO
API_MOBILE_FINDINGS_CONFIRMED = YES
API_FINDINGS_CONTRADICTING_MOBILE = 0
NEW_API_DEPENDENCIES_RECORDED = YES
PP_F01_PARENT_ANDROID_DEPENDENCY_RECORDED = YES
ANDROID_FORMAL_REAL_PHONE_UAT_READY = NO
IOS_REAL_IPHONE_UAT_READY = NO
MOBILE_PRODUCTION_READY = NO
```

### Final reconciliation classification

```text
PCA_MOBILE_ASSESSMENT_FINAL_RECONCILIATION = COMPLETE

ORIGINAL_MOBILE_VERDICT = NOT_READY
FINAL_MOBILE_VERDICT = NOT_READY
VERDICT_CHANGED = NO

API_ASSESSMENT_EFFECT = CONFIRMED_AND_EXPANDED_EXISTING_MOBILE_FINDINGS
API_FINDINGS_CONTRADICTING_MOBILE = 0

NEW_API_DEPENDENCIES =
API-F02
API-F03
API-F04
API-F05
API-F06
API-F07
API-F08
API-F12

NEW_PARENT_PLATFORM_CROSS_LAYER_FINDING = PP-F01 / R-PP-02

ANDROID_ENROLLMENT_CHAIN_STATUS = BLOCKED_MULTI_LAYER

ANDROID_ENROLLMENT_DEPENDENCIES =
- Parent production enrollment-link base
- canonical Android App-Link host
- DNS / assetlinks where required
- Android deep-link configuration
- Android runtime composition
- approved device-proof / crypto path
- API durable device sessions
- API session revocation
- documented de-enrollment/recovery path

ANDROID_FORMAL_REAL_PHONE_UAT = NOT_READY
IOS_REAL_IPHONE_UAT = NOT_READY
MOBILE_PRODUCTION = NO_GO
```

### Files updated by this reconciliation

- `README.md` (this section)
- `03_ANDROID_ENROLLMENT_FLOW.md` (§8)
- `09_MOBILE_BACKEND_CONTRACT_PARITY.md` (§4)
- `12_EXTERNAL_GATES_AND_RELEASE_READINESS.md` (§5)
- `13_MASTER_VERDICT.md` (§6)
- `registers/mobile_findings_register.json` (MOB-025 + cross-assessment block)
- `registers/mobile_external_gates.json` (new/updated gates + cross-assessment block)

SOURCE_CHANGES = 0 · PRODUCTION_MUTATIONS = 0
