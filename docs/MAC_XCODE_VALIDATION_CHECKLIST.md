# PCA-15 iOS — Mac/Xcode Validation Checklist

This source tree was written and reviewed on a Windows workspace with no
Xcode/iOS SDK available. Every item below requires a Mac with a
currently-supported Xcode/iOS SDK and, for the entitlement/device rows, an
Apple Developer account with the Family Controls entitlement approved.
**None of these have been run.** Do not treat this document as evidence
they passed — it exists so the person who *can* run them has an exact,
ordered list.

## 0. Project membership (must precede Build/Test — PCA-15 correction F2)

`ios/PCA.xcodeproj/project.pbxproj` was hand-edited (via the deterministic,
reviewable `ios/scripts/generate_pbxproj.py`, not by Xcode) to add three
new extension targets and wire every PCA-15 Swift file into a Compile
Sources phase. Because no Xcode was available to generate or verify this
file, confirm the following BEFORE attempting Section 1's build:

- [ ] Open `ios/PCA.xcodeproj` in Xcode. **It must open without a "project
  file is damaged" / repair prompt.** If Xcode offers to "fix" the
  project, STOP and diff what it changed before accepting — that is a
  sign this hand-authored file has a structural error a manual review
  missed (the automated checks that could run in this workspace —
  brace/paren balance, duplicate-ID detection, dangling-reference
  detection — all passed, but none of them substitute for Xcode's own
  project-model validation).
- [ ] Confirm exactly **5 targets** exist: `PCA` (app), `PCATests` (unit
  tests), `PCADeviceActivityMonitor`, `PCAShieldConfiguration`,
  `PCAShieldAction` (all three `app-extension` product type).
- [ ] Confirm **every** file below appears in the Project Navigator under
  its expected group, with NO file shown in red (missing-on-disk) and no
  file duplicated across two groups:
  - `PCA/` group: 13 subgroups (`AI`, `DeviceActivity`, `Enrollment`,
    `FamilyControls`, `Keychain`, `Location`, `ManagedSettings`,
    `ParentStatus`, `Prayer`, `Retention`, `Schedule`, `Sync`, `YouTube`)
    containing 23 `.swift` files total, plus the two pre-existing
    `PCAApp.swift`/`ContentView.swift`, plus `PCA.entitlements`.
  - `PCATests/` group: 13 new test files plus the pre-existing
    `PCATests.swift` (14 total).
  - `PCADeviceActivityMonitor/` group: `DeviceActivityMonitorExtension.swift`,
    `Info.plist`, `PCADeviceActivityMonitor.entitlements`.
  - `PCAShieldConfiguration/` group: `ShieldConfigurationExtension.swift`,
    `Info.plist`, `PCAShieldConfiguration.entitlements`.
  - `PCAShieldAction/` group: `ShieldActionExtension.swift`, `Info.plist`,
    `PCAShieldAction.entitlements`.
- [ ] For each of the 5 targets, open **Build Phases → Compile Sources**
  and confirm: (a) it lists exactly the files that belong to it per the
  list above, (b) **no test file (`PCATests/**`) appears in any
  non-test target's Compile Sources**, (c) **no extension's own source
  file appears in the host `PCA` target's Compile Sources or vice
  versa**, (d) no file is listed twice in the same phase.
- [ ] Confirm `PCA` target's **Build Phases → Embed App Extensions**
  (a Copy Files phase, destination "PlugIns") lists all three `.appex`
  products, each with "Code Sign On Copy" effectively applied (the
  generated `RemoveHeadersOnCopy` attribute is set; confirm Xcode also
  shows the expected code-signing behavior for embedded extensions).
  Confirm **General → Frameworks, Libraries, and Embedded Content**
  shows all three extensions as "Embed & Sign" for the `PCA` target.
- [ ] Confirm `PCA` target's **General → Dependencies** (or Build Phases
  → Target Dependencies) lists all three extension targets, so they
  build before the host app.
- [ ] For each of the 3 extension targets, confirm **Build Settings**
  shows `INFOPLIST_FILE` pointing at that extension's own physical
  `Info.plist` (NOT `GENERATE_INFOPLIST_FILE = YES` — the `NSExtension`
  dictionary is not representable via synthesized-Info.plist build
  settings) and `CODE_SIGN_ENTITLEMENTS` pointing at that extension's
  own `.entitlements` file.
- [ ] Open each extension's `Info.plist` in Xcode's plist editor (not a
  text editor) to confirm it parses as valid XML/plist and shows the
  `NSExtension` → `NSExtensionPointIdentifier` / `NSExtensionPrincipalClass`
  keys correctly. Current values (see each Info.plist's own inline
  comment for the source citation used to pick them, since this
  workspace could not compile-verify them):
  - `PCADeviceActivityMonitor`: `com.apple.deviceactivity.monitor-extension`
  - `PCAShieldConfiguration`: `com.apple.ManagedSettingsUI.shield-configuration-service`
  - `PCAShieldAction`: `com.apple.ManagedSettings.shield-action-service`
    (note: NOT the `ManagedSettingsUI` prefix — confirmed asymmetric
    against a real App Store Connect rejection/correction case; verify
    this is still current for the Xcode/SDK version in use).
- [ ] Add the **App Group** capability (Signing & Capabilities tab, not
  just the entitlements file) to all 4 non-test targets in Xcode itself,
  using identifier `group.org.pca.app` (or update it consistently across
  `ios/PCA/PCA.entitlements`, each extension's own `.entitlements` file,
  and the three `AppGroup.identifier`/`appGroupIdentifier` call sites in
  source — `PCADeviceActivityMonitor/DeviceActivityMonitorExtension.swift`
  is the primary one — if a different identifier is actually provisioned).
- [ ] Add the **Family Controls** capability (Signing & Capabilities tab)
  to all 4 non-test targets in Xcode itself — the entitlements files in
  this repo declare the key, but Xcode's own capability UI is what
  actually provisions it against the developer account/profile.
- [ ] Confirm the app's `Info.plist` (host target, synthesized via
  `GENERATE_INFOPLIST_FILE = YES`) has whatever usage-description strings
  the target iOS version requires for Family Controls / Location /
  Notifications, once those features are wired into UI (none of this
  source tree presents a permission-request UI yet — see Section 3).

## 1. Build

- [ ] `PCA` (host app) scheme builds with zero errors/warnings.
- [ ] `PCADeviceActivityMonitor`, `PCAShieldConfiguration`, `PCAShieldAction`
  extension targets each build with zero errors/warnings.
- [ ] Build succeeds with the Family Controls entitlement present (some
  FamilyControls API surfaces only fully type-check/link correctly once
  the entitlement is attached to the target — confirm no entitlement-
  gated symbol resolution issue appears only at this stage).
- [ ] Pay particular attention to `ManagedSettingsAdapter.swift`'s
  `store.shield.applicationCategories = ... .specific(categories)` call
  and `DeviceActivityScheduleMapper.swift`'s `DeviceActivityEvent(...)`
  initializer — these were written from documented API shape recollection
  without SDK access and are the most likely spots for a parameter-label
  or overload mismatch against the actual current SDK.

## 2. Unit tests (`PCATests`, no device/entitlement required)

Run `xcodebuild test -scheme PCA -destination 'platform=iOS Simulator,name=<any available simulator>'` (a plain simulator, no Family Controls entitlement needed for these — every test file added in this pass avoids the real framework via protocol seams). Confirm ALL of the following pass:

- [ ] `ChildAuthorizationCenterTests` — authorization state transitions, revocation detection, entitlement-unavailable surfacing.
- [ ] `ShieldSafetyValidatorTests` + `EmergencyShieldFloorTests` — emergency exclusion floor, token-opacity-preserving equality-only checks, independent-dimension rejection.
- [ ] `ScheduleEngineTests` — precedence, cross-midnight/weekday-rollover/DST, FINDING-006 school-mode intersection, enforcement-unavailable reporting.
- [ ] `DeviceActivityCallbackHealthTests` — missed-callback degraded-state reconciliation.
- [ ] `CallbackObservationLogTests` — record/readAll round trip, monotonic sequencing, bounded eviction, duplicate/replay determinism (PCA-15 correction F1).
- [ ] `PolicySyncDecoderTests` — well-formed decode, malformed/garbage data, wrong schema version, invalid timezone, invalid window config, empty required fields, decoded-policy-still-subject-to-emergency-floor (PCA-15 correction F1).
- [ ] `KeychainStoreTests` — write/read/delete contract, accessibility-attribute recording, DSK/DEK isolation (via `InMemoryKeychainStore`; see Section 4 for the REAL Keychain check).
- [ ] `PolicyApplicationGateTests` — epoch/replay floor (genesis, equal, higher, stale-trustSetEpoch, stale-keyEpoch, idempotent replay).
- [ ] `SyncConnectionStateTests`, `RetentionWindowTests`, `LocationCapabilityAdapterTests`, `RemainingAdaptersTests` — remaining ported/adapter logic.
- [ ] `PCATests.swift` (pre-existing launch-shell test) still passes unchanged.

## 3. Family Controls / entitlement-gated manual checks (real device or entitled simulator)

- [ ] Request child authorization via `ChildAuthorizationCenter` wired to `SystemAuthorizationSource` → confirm the system consent flow appears and `.approved`/`.denied` are correctly observed afterward.
- [ ] Revoke authorization from the parent/guardian side (Screen Time settings or the documented revocation API) → confirm the NEXT `refresh()` call surfaces `.revoked(to:)`, not a stale `.approved`.
- [ ] Present `FamilyActivityPicker`, select a mix of apps/categories/domains, persist the resulting `FamilyActivitySelection` via `FamilyActivitySelectionStore` into the App Group container under key `applicationTokens.<activityId>` (and a separate one-time `protectedApplicationTokens` key for the emergency reference set), and confirm the Device Activity Monitor extension (a separate process) reads the same selection back via `AppGroupDeviceActivityPolicySource`.
- [ ] Write a schema-valid `StoredDeviceActivityPolicy` JSON payload (ISO-8601 dates, `schemaVersion` = `policySyncSchemaVersion`) to the App Group container under key `schedule.<activityId>` from the host app, and confirm the extension's `PolicySyncDecoder.decode` accepts it and `ScheduleEngine.evaluate` runs against real window/bonus/exception data end-to-end.
- [ ] Write a deliberately malformed/wrong-schema-version payload to the same key and confirm the extension leaves the shield in its prior state rather than crashing or inventing a decision (PCA-15 correction F1 requirement 2/3).
- [ ] Configure a `DeviceActivitySchedule` from a `ScheduleWindow` via `DeviceActivityScheduleMapper` and confirm `intervalDidStart`/`intervalDidEnd` actually fire in the extension at the expected wall-clock times, including a cross-midnight window.
- [ ] Configure a `DeviceActivityEvent` threshold and confirm `eventDidReachThreshold` fires once the monitored usage reaches it, and confirm `AppGroupCallbackObservationLog.record` actually persists the observation (read it back from the host app after the extension process exits — proves cross-process persistence the in-memory tests cannot).
- [ ] Apply a shield via `ManagedSettingsAdapter.apply` for a real `ApplicationToken`/`ActivityCategoryToken` set and confirm the system shield UI actually appears when the child opens a shielded app.
- [ ] Confirm the Shield Configuration extension renders (Apple's default presentation, per doc 07 PCA-DEC-017) and the Shield Action extension's primary-button tap dismisses it without unshielding.
- [ ] With a deliberately malformed policy that would shield Phone/Emergency-SOS-equivalent tokens, confirm `ManagedSettingsAdapter.apply` throws `.rejectedByEmergencySafetyFloor` and the shield is never applied to those tokens; separately confirm placing an actual emergency call remains possible on a device with an active PCA shield configured for other apps.
- [ ] Toggle Airplane Mode / kill the app process during an active DeviceActivity schedule; on next foreground, confirm `DeviceActivityCallbackReconciler`, fed from `AppGroupCallbackObservationLog.readAll()`, reports `.degraded` rather than silently showing full compliance.
- [ ] Confirm removing/uninstalling the app while child authorization is active behaves exactly as Apple documents (blocked/requires parent action) — and separately confirm an authorized parent/guardian CAN still remove it via the supported path (doc 07 Section 6 / PCA-IOS-002: no universal-uninstall-prevention claim).

## 4. Keychain (real device or simulator Keychain, not `InMemoryKeychainStore`)

- [ ] `SystemKeychainStore.store`/`retrieve`/`delete` round-trip real bytes.
- [ ] Confirm an item stored via `FamilyKeyMaterialStore` (default `.whenUnlockedThisDeviceOnly`) does NOT appear in an iCloud Keychain backup/another device's synced Keychain.
- [ ] Confirm `SecItemAdd` on a duplicate account/service pair is handled by `store`'s delete-then-add sequence (no `errSecDuplicateItem` surfaced to the caller).

## 5. Static/App-Review-readiness

- [ ] Run `ios/scripts/static-safety-scan.sh ios` (already run once in this pass with a clean result — re-run after any further edits).
- [ ] Run Xcode's own Analyze (Product → Analyze) across all five targets.
- [ ] Confirm no target links a private/undocumented framework or symbol (Build Phases → Link Binary With Libraries, for each target).

## 6. Entitlement approval

- [ ] Confirm Apple has approved the Family Controls entitlement for this app's bundle identifier (doc 07 Section 4/11) — until then, Section 3's device checks cannot run on a non-development-entitled build, and PCA-15's release scope is limited to doc 07 Section 11's fallback feature set.

---

**Do not mark PCA-15 "fully validated" until every box above is checked by someone running actual Xcode on macOS.** This source-only pass reports `MAC_XCODE_VALIDATION = BLOCKED_EXTERNAL`, `DEVICE_VALIDATION = BLOCKED_EXTERNAL`, `ENTITLEMENT_VALIDATION = BLOCKED_EXTERNAL` for exactly this reason.
