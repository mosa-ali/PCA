# 08 — iOS Family Controls, DeviceActivity & ManagedSettings (wired core, dead outer edges)

Evidence: `[READ]` `ios/**` at `9496fb19`.

## 1. Authorization (FamilyControls)

- Status refresh: `AuthorizationCenter.shared.authorizationStatus`
  (`ChildAuthorizationCenter.swift:88-94`).
- Request: `requestAuthorization(for: .child)` (:97-98), only reachable from
  the ContentView affordance (report 07 §1).
- Approved -> non-approved transitions surface `.revoked` (:51-58); thrown
  request errors map to `.entitlementUnavailable` (:70-76); state model
  `ChildAuthorizationState.swift:24-52`.
- Requires the Apple-granted `com.apple.developer.family-controls`
  entitlement (external gate, report 12).

## 2. App selection — the picker does not exist

- Grep `FamilyActivityPicker(` across `ios/**`: **0 matches**. The identifier
  appears only in doc-comments (`FamilyActivitySelectionStore.swift:10`,
  `InstallApprovalCapability.swift:27`, `ManagedSettings/EmergencySurface.swift:19`,
  `ManagedSettings/ShieldSafetyValidator.swift:19`) and as *intended* in
  `docs/architecture/07_IOS_ARCHITECTURE.md:19`.
- `FamilyActivitySelectionStore` is defined
  (`FamilyActivitySelectionStore.swift:28-52`) with an `AppGroupBlobStore`
  (:85-107) but has **no production instantiation** (grep in `ios/PCA/**`:
  tests only, `RemainingAdaptersTests.swift:79`).
- Production instead persists raw plist token data under fixed keys
  (`schedule.<id>`, `applicationTokens.<id>`, `activeActivityId`,
  `protectedApplicationTokens`) — `PCADeviceActivityPolicyRuntime.swift:151-158`.

=> **On iOS the parent cannot select which apps to shield.** The shield can
only ever apply the tokens that such a picker would have produced. This is a
functional gap independent of the entitlement, and it must be closed in
source before any device UAT of shielding is meaningful.

## 3. DeviceActivity scheduling

- `SystemPCADeviceActivityScheduler.start` always uses a full-day envelope
  `00:00-23:59 repeats` with **empty events**
  (`PCADeviceActivityPolicyRuntime.swift:75-83`;
  `DeviceActivityScheduleMapper.monitoringSchedule()` :19-26).
- `DeviceActivityScheduleMapper.schedule(for window:)` (:34) and
  `thresholdEvent(...)` (:56) have **zero callers anywhere** -> per-window
  scheduling and threshold events are not in the live path.
- Monitor extension (`PCADeviceActivityMonitor/DeviceActivityMonitorExtension.swift`):
  reads policy + tokens from the app group (:150-176), re-evaluates
  `ScheduleEngine` per callback, validator-gates, then sets
  `shield.applications` (:104-127); missing/untrusted policy leaves the shield
  unchanged (:91-98); callbacks `intervalDidStart/End`,
  `eventDidReachThreshold` are recorded + applied (:48-72).

## 4. Shield apply path

- `PCAProductionProtectionPolicyRuntime.applyVerifiedPolicy`
  (`PCADeviceActivityPolicyRuntime.swift:110-190`): authorization guard ->
  decode -> `ShieldPolicyValidator` (:148-152) -> blob writes (:151-158) ->
  schedule (:161) -> `ManagedSettingsAdapter.apply/removeAll` (:163-182;
  adapter `ManagedSettingsAdapter.swift:43-76`).
- Safety validators: `ShieldSafetyValidator` / `ShieldPolicyValidator`
  (`ShieldSafetyValidator.swift:26-80`).
- Extensions: `ShieldConfigurationExtension` returns the default
  `ShieldConfiguration()` unconditionally (:24-40);
  `ShieldActionExtension` never unshields (:26-46).

## 5. Dead in production

- `PCAApplicationModel.applyVerifiedPolicy` (`PCAApplication.swift:261-299`)
  has **no caller** (grep: definition + runtime delegation only) -> envelopes
  pulled from `/v1/runtime-sync/inbound` are never decrypted or applied.
- Revocation never calls `ManagedSettingsAdapter.removeAll()` — the only call
  site is the apply path itself (`PCADeviceActivityPolicyRuntime.swift:181`;
  definition `ManagedSettingsAdapter.swift:72`; grep `.revoked` finds only
  state mapping).

## 6. Assessment

The enforcement machinery (monitor extension, schedulers, shield adapters,
validators) is real and unit-tested, but the *outer edges* that would make a
user-visible shield possible are missing: no picker (no tokens can be chosen),
no policy application from the sync feed (applyVerifiedPolicy dead), and no
shield removal on revocation. Combined with report 07, iOS Screen Time
enforcement is **not end-to-end wired** in the shipped composition.
