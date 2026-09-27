# 11 — Test coverage & CI evidence

Evidence: `[READ]` workflows + test inventories at `9496fb19`; run history
`[RECORDED]` from the interrupted run's session record.

## 1. Android tests

- JVM/Robolectric (`android/app/src/test/**`): **249 `.kt` files, 176 classes
  with `@Test`, 1001 `@Test` methods** (grep counts). Largest areas: runtime
  73, persistence 24, wellbeing 22, webprotection 21, platform 19.
- Instrumentation (`android/app/src/androidTest/**`): **4 classes / 10 tests**
  (needs device/emulator): `PcaLocalDatabaseMigrationTest` (6),
  `CameraXFrameSourceInstrumentedTest` (2),
  `EmergencyDialUsageAlertDeliveryTest` (1), `PrayerReminderReceiverTest` (1).

## 2. iOS tests

`ios/PCATests` — 23 files, **157 `func test`**, grouped:
enrollment (30: `RemainingAdaptersTests` 24, `EnrollmentProfileTests` 4,
`RecoverySecretDisclosureTests` 2); authorization/copy (16);
shield/safety (13); DeviceActivity/schedule (23); sync/policy/integration
(32: `PolicySyncDecoderTests` 10, `SyncConnectionStateTests` 8,
`ProductionIntegrationTests` 8, `PolicyApplicationGateTests` 6); Keychain (9);
other adapters (25); localization 5; alerts 3; shell 1.

## 3. CI — what is actually proven at HEAD

`quality-gates.yml` (push to `pca-dev`/`main`, PR):

- **android job** "Android build, lint, and unit tests" (`ubuntu-24.04`,
  `:1221-1256`): `./gradlew --no-daemon --stacktrace lint test assembleDebug
  assembleRelease`, then asserts `app-release-unsigned.apk` exists
  (`:1292-1296`) — "unsigned by design… gate stays open until the owner
  keystore exists".
- **ios job** "iOS build and unit tests" (`macos-14`, `:1298-1408`):
  simulator selection, then `xcodebuild test … CODE_SIGNING_ALLOWED=NO`
  (`:1375-1381`); 30-day diagnostics artifact.
- `[RECORDED]` run `36193353496` at `9496fb19`: **SUCCESS 27/27** including
  both above.

## 4. Mobile device UAT workflow — configured, not exercised

- `mobile-device-uat.yml`: `workflow_dispatch` only; booleans
  `run_ios_simulator` (default true), `run_android_emulator` (true),
  `run_android_physical` (false) — delegates to the core workflow.
- `mobile-device-uat-core.yml`: `ios-simulator` (macos-14),
  `android-emulator` (ubuntu, API-35 AVD, `connectedDebugAndroidTest`),
  `physical-ref-guard` (requires `refs/heads/pca-dev`),
  `android-physical` "Physical Android device acceptance":
  `runs-on: [self-hosted, Windows, X64, pca-android-device]` (`:494`).
- **Only the physical job needs a self-hosted runner**; the runbook expects
  runner `PCA-Android-Device-01` with custom label `pca-android-device`
  (`PCA_MOBILE_UAT_RUNBOOK.md:27-29`).
- `[RECORDED]` The physical job has **never executed** (always skipped in run
  history; `gh api .../actions/runners` = 0 runners). Last successful mobile
  UAT: 2026-09-19 on `7f62afb9` (emulator + iOS simulator only).
- Runbook itself is explicit: workflow source does not constitute a
  physical-device claim (`PCA_MOBILE_UAT_RUNBOOK.md:5`); simulator/emulator
  builds are unsigned, no IPA/credentials (:50-52); "real-iPhone phase not
  implemented" (:59).

## 5. Release-evidence statements

- `docs/release_readiness/RELEASE_EVIDENCE.md:20-23`: Android run evidence is
  **JVM unit tests only** — "not instrumented (androidTest) coverage and is
  not real-device UAT"; not captured: real-device UAT, iOS build/test,
  androidTest coverage, store/signing artifacts (:27-33); historical packs
  record `"android":{"skipped":true}` (:68); release APK unsigned, 0
  signature blocks (:114).

## 6. Assessment

- Unit-level coverage is **strong** on both platforms (1001 Android JVM tests;
  157 iOS tests) and CI proves compile+lint+unit at HEAD.
- **Device-level evidence is zero on both platforms**: no physical Android run
  (and no runner registered to enable it), no signed iOS build, no real-device
  iOS run, and the enrollment/shield end-to-end paths are unreachable in the
  shipped composition anyway (reports 03/07/08). Any pre-production sign-off
  must treat "CI green" as a build-quality signal only.
