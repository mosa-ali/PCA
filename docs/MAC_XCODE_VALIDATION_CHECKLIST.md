# PCA-15 iOS — Mac/Xcode Validation Checklist

This source tree was written and reviewed on a Windows workspace with no
Xcode/iOS SDK available. Every item below requires a Mac with a
currently-supported Xcode/iOS SDK and, for the entitlement/device rows, an
Apple Developer account with the Family Controls entitlement approved.
**None of these have been run.** Do not treat this document as evidence
they passed — it exists so the person who *can* run them has an exact,
ordered list.

## 0. Project setup (one-time)

- [ ] Open `ios/PCA.xcodeproj` in Xcode.
- [ ] Add three new targets via **File → New → Target**:
  - [ ] **Device Activity Monitor Extension** → point its source at `ios/PCADeviceActivityMonitor/DeviceActivityMonitorExtension.swift`. Xcode generates the extension's `Info.plist` (`NSExtensionPointIdentifier` = `com.apple.deviceactivity.monitor-extension`) — do not hand-author one.
  - [ ] **Shield Configuration Extension** (part of the ManagedSettingsUI extension point) → point at `ios/PCAShieldConfiguration/ShieldConfigurationExtension.swift`.
  - [ ] **Shield Action Extension** → point at `ios/PCAShieldAction/ShieldActionExtension.swift`.
- [ ] Add an **App Group** capability to the host app target AND all three new extension targets, using the same App Group identifier. Wire that identifier into `AppGroupBlobStore`/`AppGroupDeviceActivityPolicySource`/`AppGroupCallbackObservationLog` call sites (currently placeholder/unwired — see `DeviceActivityMonitorExtension.swift`'s `AppGroupDeviceActivityPolicySource.currentPolicy` stub).
- [ ] Add the **Family Controls** capability/entitlement to the host app target and to the Device Activity Monitor + Shield Configuration + Shield Action extension targets (Apple requires it on each process that calls into these frameworks).
- [ ] Confirm the app's `Info.plist` has whatever usage-description strings the target iOS version requires for Family Controls / Location / Notifications, once those features are wired into UI (none of this source tree presents a permission-request UI yet — see Section 3 below).

## 1. Build

- [ ] `PCA` (host app) scheme builds with zero errors/warnings on the current Xcode toolchain.
- [ ] `PCADeviceActivityMonitor`, `PCAShieldConfiguration`, `PCAShieldAction` extension targets each build with zero errors/warnings.
- [ ] `swift build` / Xcode build succeeds with the Family Controls entitlement present (some FamilyControls API surfaces only fully type-check/link correctly once the entitlement is attached to the target — confirm no entitlement-gated symbol resolution issue appears only at this stage).

## 2. Unit tests (`PCATests`, no device/entitlement required)

Run `xcodebuild test -scheme PCA -destination 'platform=iOS Simulator,name=<any available simulator>'` (a plain simulator, no Family Controls entitlement needed for these — every test file added in this pass avoids the real framework via protocol seams). Confirm ALL of the following pass:

- [ ] `ChildAuthorizationCenterTests` — authorization state transitions, revocation detection, entitlement-unavailable surfacing.
- [ ] `ShieldSafetyValidatorTests` + `EmergencyShieldFloorTests` — emergency exclusion floor, token-opacity-preserving equality-only checks, independent-dimension rejection.
- [ ] `ScheduleEngineTests` — precedence, cross-midnight/weekday-rollover/DST, FINDING-006 school-mode intersection, enforcement-unavailable reporting.
- [ ] `DeviceActivityCallbackHealthTests` — missed-callback degraded-state reconciliation.
- [ ] `KeychainStoreTests` — write/read/delete contract, accessibility-attribute recording, DSK/DEK isolation (via `InMemoryKeychainStore`; see Section 4 for the REAL Keychain check).
- [ ] `PolicyApplicationGateTests` — epoch/replay floor (genesis, equal, higher, stale-trustSetEpoch, stale-keyEpoch, idempotent replay).
- [ ] `SyncConnectionStateTests`, `RetentionWindowTests`, `LocationCapabilityAdapterTests`, `RemainingAdaptersTests` — remaining ported/adapter logic.
- [ ] `PCATests.swift` (pre-existing launch-shell test) still passes unchanged.

## 3. Family Controls / entitlement-gated manual checks (real device or entitled simulator)

- [ ] Request child authorization via `ChildAuthorizationCenter` wired to `SystemAuthorizationSource` → confirm the system consent flow appears and `.approved`/`.denied` are correctly observed afterward.
- [ ] Revoke authorization from the parent/guardian side (Screen Time settings or the documented revocation API) → confirm the NEXT `refresh()` call surfaces `.revoked(to:)`, not a stale `.approved`.
- [ ] Present `FamilyActivityPicker`, select a mix of apps/categories/domains, persist the resulting `FamilyActivitySelection` via `FamilyActivitySelectionStore` into the App Group container, and confirm the Device Activity Monitor extension (a separate process) can read the same selection back.
- [ ] Configure a `DeviceActivitySchedule` from a `ScheduleWindow` via `DeviceActivityScheduleMapper` and confirm `intervalDidStart`/`intervalDidEnd` actually fire in the extension at the expected wall-clock times, including a cross-midnight window.
- [ ] Configure a `DeviceActivityEvent` threshold and confirm `eventDidReachThreshold` fires once the monitored usage reaches it.
- [ ] Apply a shield via `ManagedSettingsAdapter.apply` for a real `ApplicationToken`/`ActivityCategoryToken` set and confirm the system shield UI actually appears when the child opens a shielded app.
- [ ] Confirm the Shield Configuration extension renders (Apple's default presentation, per doc 07 PCA-DEC-017) and the Shield Action extension's primary-button tap dismisses it without unshielding.
- [ ] With a deliberately malformed policy that would shield Phone/Emergency-SOS-equivalent tokens, confirm `ManagedSettingsAdapter.apply` throws `.rejectedByEmergencySafetyFloor` and the shield is never applied to those tokens; separately confirm placing an actual emergency call remains possible on a device with an active PCA shield configured for other apps.
- [ ] Toggle Airplane Mode / kill the app process during an active DeviceActivity schedule; on next foreground, confirm `DeviceActivityCallbackReconciler` (fed from the App-Group-shared observation log) reports `.degraded` rather than silently showing full compliance.
- [ ] Confirm removing/uninstalling the app while child authorization is active behaves exactly as Apple documents (blocked/requires parent action) — and separately confirm an authorized parent/guardian CAN still remove it via the supported path (doc 07 Section 6 / PCA-IOS-002: no universal-uninstall-prevention claim).

## 4. Keychain (real device or simulator Keychain, not `InMemoryKeychainStore`)

- [ ] `SystemKeychainStore.store`/`retrieve`/`delete` round-trip real bytes.
- [ ] Confirm an item stored via `FamilyKeyMaterialStore` (default `.whenUnlockedThisDeviceOnly`) does NOT appear in an iCloud Keychain backup/another device's synced Keychain.
- [ ] Confirm `SecItemAdd` on a duplicate account/service pair is handled by `store`'s delete-then-add sequence (no `errSecDuplicateItem` surfaced to the caller).

## 5. Static/App-Review-readiness

- [ ] Run `ios/scripts/static-safety-scan.sh ios` (already run once in this pass with a clean result — re-run after any further edits).
- [ ] Run Xcode's own Analyze (Product → Analyze) across all four targets.
- [ ] Confirm no target links a private/undocumented framework or symbol (Build Phases → Link Binary With Libraries, for each of the four targets).

## 6. Entitlement approval

- [ ] Confirm Apple has approved the Family Controls entitlement for this app's bundle identifier (doc 07 Section 4/11) — until then, Section 3's device checks cannot run on a non-development-entitled build, and PCA-15's release scope is limited to doc 07 Section 11's fallback feature set.

---

**Do not mark PCA-15 "fully validated" until every box above is checked by someone running actual Xcode on macOS.** This source-only pass reports `MAC_XCODE_VALIDATION = BLOCKED_EXTERNAL`, `DEVICE_VALIDATION = BLOCKED_EXTERNAL`, `ENTITLEMENT_VALIDATION = BLOCKED_EXTERNAL` for exactly this reason.
