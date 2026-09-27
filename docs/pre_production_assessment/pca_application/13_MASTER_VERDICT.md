# 13 — Master verdict

Reconstructed deliverable set — see README ("Reconstruction notice").
Method: read-only source assessment at `pca-dev` @ `9496fb19` (mobile trees
unchanged since ~2026-09-19), four independent evidence passes (Android core,
Android runtime, iOS core, contracts/CI/gates), plus direct spot checks.
No terminal was available; `[RECORDED]` items require the commands in §5.

## 1. Verdict block

```
PCA_MOBILE_PRE_PRODUCTION_ASSESSMENT = NOT_READY

ANDROID = SOURCE_SUBSTANTIAL / NOT_PRODUCTION_COMPOSED / EXTERNALLY_GATED
IOS     = SOURCE_PARTIAL / ENROLLMENT_ENTRY_BROKEN / EXTERNALLY_GATED

END_TO_END_ENROLLMENT          = UNREACHABLE (both platforms, fail-closed crypto gate)
DEVICE_PROOF                   = ABSENT in production (both platforms)
RUNTIME_SYNC                   = ANDROID not composed; IOS composed but policy never applied
POLICY_ENFORCEMENT_UI (IOS)    = ABSENT (no app picker)
PHYSICAL_DEVICE_EVIDENCE       = ZERO (never run; no runner registered)
SIGNED_BUILDS                  = NONE (unsigned APK by design; iOS unsignable without team)
EXTERNAL_GATES                 = 39 open (mobile subset: 17 Android hard; 9+5 iOS)
CI_AT_HEAD (9496fb19)          = GREEN 27/27 (build+lint+unit only) [RECORDED]
```

## 2. Why "NOT_READY" — three independent classes

**Class A — external gates (owner/universe deliverables, close only outside
the repo):** cryptography review that unblocks key generation on both
platforms; owned enrollment domain + assetlinks/AASA hosting; Apple developer
team + Family Controls entitlement + physical iPhone; Android release
keystore; self-hosted Android device runner; physical-device UAT execution.

**Class B — repo-solvable defects found by this assessment (fix in source
before the Class A gate runs are attempted):**

- iOS `pca://` scheme is not registered (no `CFBundleURLTypes`) — one of the
  two enrollment entry paths can never launch the app (MOB-003).
- iOS `applyVerifiedPolicy` has no caller — synced policy envelopes are never
  applied (MOB-005); revocation never clears the shield (MOB-008).
- iOS has no `FamilyActivityPicker` UI and no production use of
  `FamilyActivitySelectionStore` — app selection cannot happen (MOB-006).
- iOS schedule is a fixed all-day envelope with no events; the window/threshold
  mapper is dead (MOB-007).
- Android runtime-sync, VPN enforcement and web-rule ingestion are composed
  only in tests (OFFLINE placeholder); wellbeing parent policy is standalone;
  web-rule verifier never approves (MOB-012/013/014/018).
- Android has no de-enrollment path and writes `familyId: ""` on success
  (MOB-015/016); no boot re-arm (MOB-017).
- Neither client drives the backend's invitation-state transitions; iOS never
  acknowledges inbound sync messages (MOB-009/019).

**Class C — by-design fail-closed states (not defects, but they mean zero
end-to-end evidence):** Android `CryptoReviewRequired` before any network
call; iOS `enrollmentBlockedBySecurityGate` / `cryptoActivationPending`;
unsigned CI artifacts. These are the correct posture given the pending crypto
review — the mobile programme is deliberately parked behind it.

## 3. Per-area summary

| Area | Android | iOS |
|---|---|---|
| Enrollment mechanics | complete, defensive (parser/persistence/recovery) | complete, defensive (parser/profile/session) |
| Enrollment reachability | OK via `pca://`; App Link host external | **broken** (scheme + host + proof gate) |
| Device identity/proof | proof pipeline absent/UI-only | proof pipeline empty keys (by design) |
| Runtime sync | implemented, not composed | composed; apply/ack gaps |
| Enforcement engines | local engines wired; platform enforcement device-owner gated | extensions real; picker/apply gaps |
| Tests | 1001 JVM + 10 instrumentation | 157 unit tests |
| CI | build+lint+unit green at HEAD | simulator test green at HEAD |

## 4. Exit criteria to re-assess "READY"

1. Crypto review cleared; approved key generator implemented on both platforms
   (and wired: keystore, challenge client, key persistence).
2. iOS entry path fixed + owned universal-link domain live with AASA; Android
   assetlinks hosted on the same domain.
3. iOS picker + policy-application + revocation wired; Android sync/VPN
   composition decision (owner) executed or explicitly deferred.
4. Physical-device UAT executed on both platforms with signed builds
   (runner registered; keystore + Apple team available).
5. Re-run this report set at the exact SHA validated, updating statuses.

## 5. Commands to run when a terminal is available `[BLOCKED here]`

```powershell
# Repository truth
git status --short
git branch --show-current
git rev-parse HEAD; git rev-parse origin/pca-dev
git log -1 --format='%H %ci %s' -- android
git log -1 --format='%H %ci %s' -- ios

# CI / runner evidence
gh run view 36193353496 --json conclusion,jobs
gh run list --workflow=mobile-device-uat.yml --limit 10
gh api /repos/mosa-ali/PCA/actions/runners    # confirm remote first: git remote -v

# Local Android artifact (JDK 17 + SDK android-35 were confirmed present earlier)
cd D:\PCA\pca-app\android
.\gradlew.bat --no-daemon assembleDebug
& "C:\Android\sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs app\build\outputs\apk\debug\app-debug.apk

# Physical Android UAT (only once a runner with label pca-android-device exists)
gh workflow run mobile-device-uat.yml -f run_android_physical=true
```

## 6. FINAL CROSS-ASSESSMENT UPDATE — API + PARENT/PLATFORM (2026-09-26)

Appended after the completed API assessment (`docs/pre_production_assessment/api/`)
and the Parent+Platform final assessment (`docs/pre_production_assessment/pca_parent_platform/`).
Documentation-only: the §1 verdict block and every original finding are preserved;
no severity was changed without evidence.

### Change records

**R1 — Android enrollment dependency becomes MULTI_LAYER (PP-F01).**
- ORIGINAL_FINDING = MOB-004 + report 03 §1/§7 (link host placeholder; App Link externally gated).
- NEW_EVIDENCE = the live Parent Web bundle ships
  `deviceEnrollmentLinkBaseUrl:"http://localhost:4000/enroll"` — every generated
  enrollment link/QR is `http://localhost:4000/enroll/<token>`, matching neither Android
  link shape (`pca://enroll?token=` nor `https://<APP_LINK_HOST>/<token>`).
- SOURCE_ASSESSMENT = `pca_parent_platform` report 04 §2 / registers PP-F01, R-PP-02.
- REVISED_DEPENDENCY = **MULTI_LAYER**: Parent Web + Android + API/security gate +
  deployment/domain configuration.
- VERDICT_CHANGED = **NO**.

**R2 — API assessment confirms the mobile findings; contradictions = 0.**
- ORIGINAL_FINDING = the API-relevant mobile set.
- NEW_EVIDENCE = `api/08` (16-call matrix, zero drift), `api/14` (12 confirmed /
  0 reclassified / 0 contradicted); backend twin gate confirmed at source; iOS
  invitation minting refused by server decision.
- SOURCE_ASSESSMENT = `api/08`, `api/14`.
- REVISED_DEPENDENCY = API dependency stays CONDITIONAL.
- VERDICT_CHANGED = **NO**.

**R3 — New backend dependencies recorded (API-F02–F08, F12) against MOB-012/014/015/018.**
- NEW_EVIDENCE = `api/12` findings + `api/15` roadmap (durable sessions + revocation
  bundled with the crypto-gate exit).
- SOURCE_ASSESSMENT = `api/12`, `api/14`, `api/15`.
- REVISED_DEPENDENCY = the pre-UAT backend slice is extended; nothing contradicts the
  client-side composition findings.
- VERDICT_CHANGED = **NO**.

**R4 — iOS bootstrap additionally unreachable by server decision.**
- NEW_EVIDENCE = `PLATFORM_ENROLLMENT_UNAVAILABLE` refusal of iOS invitation minting
  (`invitationRoutes.ts:113`; regression-guarded) — `api/04 §2`, `api/14`.
- VERDICT_CHANGED = **NO**.

### Final conclusions (this reconciliation)

```text
MOBILE_VERDICT_CHANGED = NO
API_MOBILE_FINDINGS_CONFIRMED = YES
API_FINDINGS_CONTRADICTING_MOBILE = 0
NEW_API_DEPENDENCIES_RECORDED = YES
PP_F01_PARENT_ANDROID_DEPENDENCY_RECORDED = YES
ANDROID_FORMAL_REAL_PHONE_UAT_READY = NO
IOS_REAL_IPHONE_UAT_READY = NO
MOBILE_PRODUCTION_READY = NO
SOURCE_CHANGES = 0
PRODUCTION_MUTATIONS = 0
```

### Final reconciliation classification (supervisor-required block)

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

## 7. Reconciliation note

If the original mission text is recovered, map its 13-report enumeration onto
this set; the findings and registers are content-complete and can be renamed
or split without re-verification. All `path:line` citations refer to
`9496fb19` and remain valid while the mobile trees stay frozen.
