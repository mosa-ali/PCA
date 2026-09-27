# 12 — External gates & release readiness (mobile scope)

Evidence: `[READ]` `docs/release_readiness/external_gate_matrix.json`,
`EXTERNAL_GATE_MATRIX.md`, `RELEASE_EVIDENCE.md`, `docs/deployment/PCA_MOBILE_UAT_RUNBOOK.md`,
`docs/MAC_XCODE_VALIDATION_CHECKLIST.md`; CI facts `[RECORDED]`.

## 1. Register status

The release register reports **Closed: 0; Open (BLOCKED or EXTERNAL): 39**
(`EXTERNAL_GATE_MATRIX.md:16`). Generated summary for mobile: **ANDROID_D = 17
hard gates; IOS_FUTURE = 9 hard + 5 conditional** (`EXTERNAL_GATE_MATRIX.md:73-75`).

## 2. Mobile-relevant gates

| Gate | State | What it blocks |
|---|---|---|
| `ANDROID_REAL_DEVICE_UAT` | BLOCKED | No real Android hardware has run the UAT catalogue; JVM tests only (`json:27-35`) |
| `ANDROID_APP_LINK_ASSETLINKS_HOSTING` | EXTERNAL | App Links need assetlinks hosting + domain ownership (`json:121-129`) |
| `ANDROID_PHYSICAL_INSTALL_CONTINUATION` | EXTERNAL | Real device + production distribution path (`json:132-140`) |
| `ANDROID_RELEASE_SIGNING_CONFIG` | EXTERNAL | Owner-held keystore; repo half closed 2026-09-08 (`json:445-453`) |
| `DEVICE_OWNER_REAL_DEVICE_AUTHORIZATION` | EXTERNAL | Device-owner authority not source-provable (`json:198-206`) |
| `REAL_DEVICE_TELEPHONY_UAT` / `_SMS_UAT` | EXTERNAL | Telephony/SMS behavior on hardware (`json:222-241`) |
| `CAMERA_REAL_DEVICE_VALIDATION` | EXTERNAL | Eye-distance camera tier on hardware (`json:257-265`) |
| `OEM_DEVICE_DIVERSITY_VALIDATION` | EXTERNAL | OEM matrix (`json:373-381`) |
| `OFFLINE_DEVICE_INTERRUPTION_RECOVERY_VALIDATION` | EXTERNAL | Device-lab reliability runs (`json:340-348`) |
| `IOS_MAC_XCODE` | EXTERNAL | No macOS/Xcode environment (`json:38-46`) |
| `IOS_FAMILY_CONTROLS_ENTITLEMENT` | EXTERNAL | Apple entitlement not granted (`json:49-57`) |
| `IOS_PHYSICAL_DEVICE` | EXTERNAL | No physical iPhone/iPad; simulators cannot exercise Family Controls (`json:60-68`) |
| `REQUIRES_ENTITLEMENT` | EXTERNAL | Apple Family Controls entitlement before `ChildAuthorizationCenter` (`json:291-299`) |
| `PCA_DEC_009_DISCLOSURE_TEXT` | BLOCKED | Named as a disclosure item; description ties to the device gates (`json:351-359`) — reconcile naming with the register owner |

Conditional-only mobile scope: `PRODUCTION_EMAIL_DELIVERY` (`json:419-431`),
`PRODUCTION_EMAIL_CREDENTIAL_ROTATION` (BLOCKED, `json:456-473`), `YOUTUBE_*`,
`CLOUD_AI_OWNER_DECISION`.

## 3. Supporting statements

- `MAC_XCODE_VALIDATION_CHECKLIST.md:4-9,194`: written without Xcode — "None
  of these have been run"; final verdict `MAC_XCODE_VALIDATION =
  BLOCKED_EXTERNAL`, `DEVICE_VALIDATION = BLOCKED_EXTERNAL`,
  `ENTITLEMENT_VALIDATION = BLOCKED_EXTERNAL`.
- `PCA_MOBILE_UAT_RUNBOOK.md`: manual acceptance; workflow source is not
  device evidence (:5); physical job fail-closed on device count (:44-49);
  simulator/emulator unsigned (:50-52); real-iPhone phase not implemented
  (:59).
- `RELEASE_EVIDENCE.md`: Android evidence is JVM-only (:20-23); unsigned APK
  with 0 signature blocks (:114).

## 4. Assessment

Every mobile release gate is open, and each is **external or hardware-bound**
— none can be closed by source changes alone. Two implications:

1. No amount of repository work can produce a "mobile release-ready" claim
   until the owner supplies: signing material, an owned enrollment domain
   (+AASA/assetlinks), an Apple team + Family Controls entitlement, physical
   devices, and a self-hosted Android runner.
2. Several repo-side preconditions for those gate runs are **not yet in
   place** and should be fixed first, otherwise the device runs will fail
   for source reasons: iOS enrollment entry path (report 07), iOS policy
   application + picker (report 08), Android sync/VPN composition (report 05).
## 5. FINAL CROSS-ASSESSMENT UPDATE — API + PARENT/PLATFORM (2026-09-26)

New and revised gates from the API and Parent+Platform assessments (details:
`pca_parent_platform` reports 04/12/13/15; `api` reports 12/15). Documentation-only:
no gate above was removed or downgraded.

| Gate (new/revised) | State | Blocks | Evidence |
|---|---|---|---|
| `PARENT_WEB_ENROLLMENT_LINK_PRODUCTION_CONFIG` (new) | OPEN — production defect | Link/QR-based Android enrollment: the parent production bundle generates `http://localhost:4000/enroll/<token>` | PP-F01 live-bundle extraction (`pca_parent_platform` report 04 §2) |
| `ANDROID_APP_LINK_ASSETLINKS_HOSTING` (revised scope) | EXTERNAL (unchanged state) — now explicitly required to align with the Parent Web link base | End-to-end App-Link enrollment path | PP-F01 chain; `pca_parent_platform` R-PP-02; mobile finding MOB-025 |
| `PARENT_WEB_ENROLLMENT_LINK_ACCEPTANCE` (new) | BLOCKED until the two gates above close | Android real-device enrollment UAT via link | `pca_parent_platform` report 15 (PP-F01 row) |
| `API_DEVICE_SESSION_DURABILITY_AND_REVOCATION` (new) | OPEN | Meaningful device UAT once the crypto gate opens (sessions die on restart; revocation not immediate) | api findings API-F02/F03 (`api/12`) |

Required readiness conclusions (unchanged from the original verdict):

```text
ANDROID_FORMAL_REAL_PHONE_UAT_READY = NO
IOS_REAL_IPHONE_UAT_READY = NO
MOBILE_PRODUCTION_READY = NO
```

The mobile external-gate register (`registers/mobile_external_gates.json`) now carries
these entries plus a `cross_assessment_update_2026_09_26` block.

The supervisor-required final classification block (`PCA_MOBILE_ASSESSMENT_FINAL_RECONCILIATION = COMPLETE`, `ANDROID_ENROLLMENT_CHAIN_STATUS = BLOCKED_MULTI_LAYER`, full Android dependency list) is recorded in `13_MASTER_VERDICT.md` §6 and `README.md`; this report is this set's Android real-device readiness equivalent (no separate report exists).