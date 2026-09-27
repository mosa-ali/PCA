# 06 — iOS architecture & production composition

Evidence: `[READ]` `ios/**` at `9496fb19` (no Xcode/build available).

## 1. Targets, identifiers, deployment

- Targets (`ios/PCA.xcodeproj/project.pbxproj:211-215`): `PCA` (application),
  `PCATests` (unit tests), `PCADeviceActivityMonitor`,
  `PCAShieldConfiguration`, `PCAShieldAction` (app extensions, embedded).
- Bundle IDs (pbxproj:255-264): `org.pca.app`, `org.pca.app.tests`,
  `org.pca.app.deviceactivitymonitor`, `org.pca.app.shieldconfiguration`,
  `org.pca.app.shieldaction`.
- `IPHONEOS_DEPLOYMENT_TARGET = 17.0` everywhere; Swift 5.0;
  `TARGETED_DEVICE_FAMILY = "1,2"`; `MARKETING_VERSION 0.1.0`.

## 2. Signing reality

- `CODE_SIGN_STYLE = Automatic` on all shipping targets; entitlements set on
  all four (below).
- `"CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]" = NO` on the `PCA` target only
  (pbxproj:255-256).
- **`DEVELOPMENT_TEAM` does not appear anywhere** (grep: 0 matches in the
  pbxproj; one comment in `ios/scripts/wire_app_icon_and_launch_screen.py:3`).
  No `CODE_SIGN_IDENTITY` / `PROVISIONING_PROFILE*` either.
  => The project cannot produce a signed device build without manual team
  selection in Xcode (external gate, report 12).

## 3. Entitlements

- Host `ios/PCA/PCA.entitlements`: `com.apple.developer.family-controls` (:8),
  app group `group.org.pca.app` (:15-19), associated domain
  `applinks:enroll.pca.app` (:23-25).
- Each extension entitlements file: family-controls + the same app group
  (`PCADeviceActivityMonitor.entitlements:5,7-9`; same shape in
  `PCAShieldConfiguration`/`PCAShieldAction`).
- `enroll.pca.app` is a **documented unowned placeholder**
  (`docs/supervision/PCA_FABLE_ACTION_CLOSURE_2026-09-08.csv:52`;
  `PCA_FABLE_RELEASE_ROADMAP.md:200-201`; `PCA_FINAL_GAP_MATRIX_2026-09-08.csv:17`).
  No `apple-app-site-association` file exists anywhere in the repo.

## 4. Info.plist / URL-scheme reality

- Host app has **no** Info.plist file (`GENERATE_INFOPLIST_FILE = YES`,
  pbxproj:255-256); only display-name + launch-screen keys are set. There is
  **no `INFOPLIST_KEY_CFBundleURLTypes`** — grep for
  `CFBundleURLTypes|CFBundleURLSchemes|URLTypes` across `ios/**` = 0
  registration matches. => `pca://` links can never launch the app (report 07 §6).
- Extensions ship physical Info.plists with
  `NSExtensionPointIdentifier`:
  `com.apple.deviceactivity.monitor-extension`
  (`PCADeviceActivityMonitor/Info.plist:31-32`),
  `com.apple.ManagedSettingsUI.shield-configuration-service`
  (`PCAShieldConfiguration/Info.plist:32-33`),
  `com.apple.ManagedSettings.shield-action-service`
  (`PCAShieldAction/Info.plist:34-35`).

## 5. Composition root

`PCAProductionCompositionRoot.make()` — `ios/PCA/Application/PCAApplication.swift:502-547`,
constructed from `PCAApp.swift:9`; base URL `https://api.pcasafe.com` (:503).

Wired (constructed in the root): authorization center, Keychain stores
(`PCAKeychainDeviceStateStore` :516, `FamilyKeyMaterialStore` :517),
enrollment coordinator, transport + three API clients,
`UserDefaultsPCAEnrollmentProfileStore`, `PCAProductionProtectionPolicyRuntime`
(:234-243 of `PCADeviceActivityPolicyRuntime.swift`),
`PCAHostProtectionRuntime`, `UserDefaultsPCADeviceIdentityStore` (:544).

Only unit-tested / never constructed in production (greps in `ios/PCA/**`):
`FamilyActivitySelectionStore`, `RetentionWindow`, `LocationCapabilityAdapter`,
`PrayerNotificationScheduler`, `ChildStatusSnapshot`,
`EmergencySurfaceExclusionSet`, `PolicyApplicationGate`,
`ClassifierRuntimeBoundary`, `InstallApprovalCapabilityResolver`,
`EnrollmentLifecycleMachine`/`PCARecoverySecretDisclosureGate`
(`EnrollmentLifecycle.swift`; `ChildEnrollmentCoordinator.swift:534`).

## 6. Entry points

`PCAApp.swift:15-19`: `.onAppear -> start()`, scenePhase `.active ->
sceneBecameActive()`, `.onOpenURL -> receiveEnrollmentLink(url)` (report 07).

## 7. Immediate architectural observations

1. The iOS client half of runtime sync is composed, but the policy-application
   entry (`PCAApplicationModel.applyVerifiedPolicy`, report 08 §5) has **no
   caller** — pulled envelopes are never applied.
2. Signing, entitlements and the associated domain are all in external-gate
   territory; nothing in-repo can close them alone.
3. The extension skeleton (monitor + shield config + shield action) is real
   and wired via entitlements/Info.plist; behaviour is assessed in report 08.
