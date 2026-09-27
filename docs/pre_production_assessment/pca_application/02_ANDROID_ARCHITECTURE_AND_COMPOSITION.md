# 02 — Android architecture & production composition

Evidence: `[READ]` `android/**` at `9496fb19`. Primary files cited inline.

## 1. Shape of the app

- Single application module `org.pca.app`, Kotlin + Compose, one process.
- Top-level source packages (`android/app/src/main/java/org/pca/app/`):
  `accessibility`, `enrollment`, `feature` (`breakshield`, `eyedistance`,
  `installapproval`, `prayer`, `removaldecision`, `screentime`, `settings`,
  `webprotection`, `wellbeing`, `youtube`), `foundation`, `i18n`,
  `persistence`, `platform`, `runtime`, `security`, `storage`.
- Composition root: `runtime/graph/PcaAppGraph.kt:174` (per-process singleton),
  started from `PcaApplication.kt:19`.
- API base URL: `https://api.pcasafe.com` — the **only** production endpoint
  literal (`PcaAppGraph.kt:357`).

## 2. Manifest (`android/app/src/main/AndroidManifest.xml`)

- Permissions include: `ACCESS_FINE/COARSE/BACKGROUND_LOCATION` (:9-15),
  `POST_NOTIFICATIONS` (:28), `READ_PHONE_STATE` (:51),
  `SCHEDULE_EXACT_ALARM` (:56), `PACKAGE_USAGE_STATS` with
  `tools:ignore="ProtectedPermissions"` (:75-77), `FOREGROUND_SERVICE` +
  `FOREGROUND_SERVICE_SPECIAL_USE` (:86-87), `CAMERA` (:96);
  `<queries>` is scoped MAIN/LAUNCHER only — explicitly **not**
  `QUERY_ALL_PACKAGES` (:105-115).
- `android:allowBackup="false"` (:129); **no** `res/xml/`, no
  network-security-config, no `usesCleartextTraffic` anywhere.
- Activities: `MainActivity` exported (:136-141, MAIN/LAUNCHER);
  `EnrollmentActivity` exported with **two filters** — custom scheme
  `pca://enroll` (:153-158) and App Link `https://enroll.pca.app` with
  `autoVerify="true"` (:171-176); all other activities non-exported
  (`SafeBrowserActivity` :184, `AdminSecurityActivity` :192,
  `YouTubeModeActivity` :200, `EyeDistanceCameraPermissionActivity` :210,
  `EyeRestShieldActivity` :221, `BreakShieldActivity` :232,
  `WellbeingCardActivity` :245).
- Receivers: `PrayerReminderReceiver` non-exported (:263-267);
  `InstalledAppEventReceiver` **exported** for `PACKAGE_ADDED` (:280-285).
- Service: `WebProtectionVpnService` exported with
  `BIND_VPN_SERVICE`, foreground `specialUse` (:299-307).
- No device-admin / DPC registration anywhere (grep for
  `DeviceAdminReceiver|BIND_DEVICE_ADMIN` -> none).

## 3. Build configuration (`android/app/build.gradle.kts`)

- `applicationId org.pca.app` (:15), `minSdk 26` (:16), `target/compile 35`
  (:12,:17), `versionCode 1` / `versionName "0.1.0"` (:18-19).
- Release: `isMinifyEnabled = true`, `isShrinkResources = true` (:83-85);
  lint `abortOnError=true`, `checkReleaseBuilds=true` (:92-93).
- Signing: release keystore comes from `PCA_RELEASE_*` env vars (:55-58);
  **without them `assembleRelease` yields an unsigned artifact**
  (`signingConfig = null` :86). No keystore material is in-tree.
- Dependencies of note: Room 2.6.1 (KSP schema export), WorkManager 2.9.1,
  CameraX 1.4.1, biometric 1.1.0, security-crypto 1.1.0, coroutines 1.9.0;
  **no OkHttp/Retrofit/Ktor** — HTTP via `HttpURLConnection`
  (`HttpUrlConnectionRelayHttpClient.kt:14`).

## 4. What production actually composes (proved by grep)

Wired into `PcaAppGraph.start()` (`PcaAppGraph.kt:~854, 1030`):

- `enrollmentCoordinator` -> `EnrollmentActivity.kt:26,64`;
- `installApprovalController` -> `InstalledAppEventReceiver.kt:93`;
- `parentUnblockRequestService` -> `SafeBrowserActivity.kt:32`;
- `modeAAndroidUsageAdapter` -> `YouTubeModeActivity.kt:50`;
- runtime (`PcaRuntime`) with schedules, wellbeing, shield triggers,
  tamper monitors, 15 s tick loop (`PcaRuntime.kt:360`);
- WorkManager: usage ingestion (15 min) + retention (1 day)
  (`PcaAppGraph.kt:854-855`; `BackgroundExecutionScheduler.kt:59,89`);
- alarming: `AlarmManagerPrayerScheduler` `setExactAndAllowWhileIdle`
  (:56-59), armed from the ingestion cycle (`PcaAppGraph.kt:946`).

**Constructed but never called in production** (grep shows only the
construction line or its own file):

- `vpnEnforcementController` (`PcaAppGraph.kt:520`, marked
  `OWNER_DECISION_PENDING` :517; `VpnEnforcementPolicy.kt:5`);
- `webRulePolicyConsumer` (:483 — its comment :456-463 admits the only caller
  is test injection) and `signedRulePackageConsumer` (:485) behind a verifier
  that never approves (`NotApprovedSignedRulePackageVerifier` :484);
- `geofenceZoneStore` (:432-435 — no zone-authoring UI);
- `ReconnectSyncOrchestrator`, `DeviceSessionManager`,
  `HttpUrlConnectionRelayHttpClient` — the real sync transport is never
  instantiated; the sync port is the always-OFFLINE placeholder
  (`:1040,1063`; `FamilySyncRuntimePort.kt:57-66` shows OFFLINE behaviour).

## 5. Implications

- The runtime half of the product (sync, web-rule delivery, VPN enforcement,
  geofencing) is **not production-composed**; it exists as tested units and
  in-app local engines.
- Enrollment UI is reachable (exported + scheme) but the flow itself stops at
  the crypto gate (report 03).
- No boot receiver: after a reboot nothing re-arms the tick loop, shield
  triggers, wellbeing dispatch or geofence checks until some other component
  restarts the process (WorkManager/alarm/service or a user launch)
  (`[READ]` merged-manifest/`src/main` grep for `BOOT_COMPLETED` = none).
