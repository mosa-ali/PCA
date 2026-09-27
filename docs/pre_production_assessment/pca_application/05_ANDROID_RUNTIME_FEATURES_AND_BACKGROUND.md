# 05 — Android runtime features, background execution, sync & tests

Evidence: `[READ]` `android/**` at `9496fb19`.

## 1. Feature inventory (wired vs standalone)

- **Screen time / schedule enforcement**: engine + baselines in `PcaRuntime`;
  schedule authority `ScheduleRuntime` + `PersistentSchedulePolicyStore`
  (`PcaAppGraph.kt:223-227`), `ProductionScheduleRuntimePort` (:263-278),
  `DevicePolicyScheduleEnforcementConsumer` (:244). Platform enforcement is
  `ENFORCED` only under a proven Device-Owner `PROTECTED` state, else
  `UNAVAILABLE` (:272-277). No backend calls. Tests: 12
  (`feature/screentime/**`).
- **Web protection / web rules**: `WebFilterEngine` + last-known-good
  `PersistentWebRuleRepository` (:481). Rule ingress `WebRulePolicyConsumer`
  (:483) **has no production feeder**, and
  `NotApprovedSignedRulePackageVerifier` never approves (:484) -> no remote
  rule updates in production. Tests: 21.
- **Safe Browser**: non-exported activity, reachable from child home
  (`MainActivity.kt:84`; `ChildHomeScreen.kt:178`); WebView loads only
  controller-approved URLs (`SafeBrowserScreen.kt:158-169,194-206`), mixed
  content never allowed (:186), WebView debugging debug-only (:191).
- **Break shield**: trigger wired to `BreakShieldActivity`
  (`PcaAppGraph.kt:747`). Tests: 7.
- **Wellbeing**: `WellbeingRuntimeCoordinator` (:647) driven by real screen
  state transitions (`PcaRuntime.kt:158-170`); card delivery to
  `WellbeingCardActivity` (:630-660). `eligibleAppPackages = { emptySet() }`
  (:600) -> app-based triggers are inert; `ParentPolicySyncCoordinator` is
  **never constructed in production** -> parent-driven wellbeing policy is
  standalone. Tests: 22.
- **Eye distance / eye rest**: engine in `PcaRuntime`; camera tier is
  foreground-gated (:539-565); `EyeRestShieldTrigger` -> `EyeRestShieldActivity`
  (:715). Tests: 8.
- **Protection alerts**: five tamper monitors always run (:956-961); delivery
  via `UsageAccessAlertNotificationDelivery` (:287),
  `CapabilityTamperAlertNotificationDelivery` (:295). Tests: 3 under
  `runtime/tamper`.
- **Notifications**: 8 channels (emergency dial, VPN foreground, wellbeing,
  capability tamper, usage access, geofence, prayer staleness, prayer
  reminder) — see the delivery classes; runtime prompt flow at
  `MainActivity.kt:125,177`.
- **Install approval**: `InstalledAppEventReceiver` -> controller
  (`:257`); `InstallApprovalDecisionApplier`/`BonusGrantSync` are constructed
  **only in tests**.
- **YouTube**: Mode-A adapter (`:524`) + UI (`MainActivity.kt:90`); tests 6.
- **Prayer**: scheduling wired (`PrayerReminderReceiver`, tests 7).
- **Removal decision / settings**: reachable only from the non-exported
  `AdminSecurityActivity` (`AdminSecurityActivity.kt:104,136`).

## 2. Background execution

- **WorkManager**: two unique periodic jobs from `start()`
  (`PcaAppGraph.kt:854-855`): usage ingestion, 15 min floor
  (`BackgroundExecutionScheduler.kt:59`; `PcaBatteryBudgetPolicy.kt:45`) and
  retention maintenance, 1 day (:89). OS-persisted across process death and
  reboot (`UsageIngestionWorker.kt:31`, `RetentionMaintenanceWorker.kt:33`).
- **Exact alarms**: `AlarmManagerPrayerScheduler.setExactAndAllowWhileIdle`
  (:56-59), armed from the ingestion cycle off a live location fix
  (`PcaAppGraph.kt:946`); receiver posts notification + `goAsync()` delivery
  row (`PrayerReminderReceiver.kt:53-70`).
- **Service**: `WebProtectionVpnService` — foreground `specialUse`, DNS-only
  route (:105-110), `START_STICKY`.
- **Boot**: **no** `BOOT_COMPLETED` receiver in `src/main`; boot detection
  reads `Settings.Global.BOOT_COUNT` (`BootInstanceSource.kt:38-46`).
- **App-closed reality**: WorkManager/alarms can resurrect the process;
  after a reboot nothing re-arms the tick loop, shield triggers, wellbeing
  dispatch, geofence or tamper checks until the process starts again.

## 3. Runtime sync transport (defined, not composed)

`HttpUrlConnectionRelayHttpClient.kt` implements:
`POST /v1/runtime-sync/devices/{id}/challenge` (:80),
`POST …/session` (:86, body `{challengeId,signature}`),
`POST /v1/runtime-sync/outbound` (:102, items `{messageId,recipientDeviceId,
ciphertext,messageType,enqueuedAtEpochMillis,ttlMs}`),
`GET /v1/runtime-sync/inbound` (:118),
`POST /v1/runtime-sync/inbound/{messageId}/ack` (:136),
`GET /v1/runtime-sync/status` (:140),
`POST /v1/runtime-sync/protection-status` (:153, `{protectionLevel}`).
Auth = `Authorization: Bearer <sessionToken>` (:49); session minted via DSK
signature (`DeviceSessionManager.kt:22-40`). HTTPS enforced; HTTP only for
`localhost/10.0.2.2` opt-in (:29-38). No mTLS.

**But**: the production port is the always-OFFLINE placeholder
(`PcaAppGraph.kt:1040,1063`; `FamilySyncRuntimePort.kt:57-66`);
`ReconnectSyncOrchestrator`, `DeviceSessionManager` and the transport class
are never instantiated in `src/main` (grep: tests only). There is no
production sync-loop trigger.

## 4. Tests (inventory)

- JVM/Robolectric (`src/test/**`): 249 `.kt` files, 176 classes with `@Test`,
  **1001 `@Test` methods** (grep counts). Largest areas: runtime 73,
  persistence 24, wellbeing 22, webprotection 21, platform 19.
- Instrumentation (`src/androidTest/**`): 4 classes / 10 tests — needs a
  device/emulator: `PcaLocalDatabaseMigrationTest` (6),
  `CameraXFrameSourceInstrumentedTest` (2),
  `EmergencyDialUsageAlertDeliveryTest` (1), `PrayerReminderReceiverTest` (1).

## 5. Security-lite observations

- `allowBackup="false"` (:129); no backup/`data_extraction_rules` XML at all;
  enforced by `AllowBackupManifestTest`.
- Exported components are only: `MainActivity`, `EnrollmentActivity`,
  `InstalledAppEventReceiver`, `WebProtectionVpnService` (BIND-gated) — all
  justified above; everything else non-exported.
- Secret scan over `src/main` + `src/test`
  (`BEGIN … PRIVATE KEY|apiKey|api_key|secret|password=|client_secret`):
  **zero matches**. No `http://` literal in main source.
- Release builds minify+shrink; unsigned unless `PCA_RELEASE_*` env present
  (report 02 §3, report 10 §4).
