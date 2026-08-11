# PCA iOS (PCA-15)

Native iOS Child Agent source, built strictly on Apple's public Family
Controls / Managed Settings / Device Activity / Keychain / Core ML APIs
per docs/architecture/07_IOS_ARCHITECTURE.md. No private API, no
SpringBoard manipulation, no jailbreak dependency (PCA-IOS-001) — see
`scripts/static-safety-scan.sh`.

## Layout

- `PCA/` — host app source, organized by capability: `FamilyControls/`,
  `ManagedSettings/`, `DeviceActivity/`, `Keychain/`, `Schedule/`
  (PCA-4 engine port), `Sync/` (PCA-11 adapter), `Retention/` (PCA-12
  adapter), `Location/` (PCA-7), `Prayer/` (PCA-9), `ParentStatus/`
  (PCA-10), `AI/` (PCA-14 boundary), `YouTube/` (PCA-6 honesty adapter),
  `Enrollment/`.
- `PCADeviceActivityMonitor/`, `PCAShieldConfiguration/`,
  `PCAShieldAction/` — source for the three required Screen Time
  extension targets, each with its own physical `Info.plist` and
  `.entitlements` file. The corresponding Xcode `app-extension` targets
  are wired into `PCA.xcodeproj/project.pbxproj` (via
  `scripts/generate_pbxproj.py`, a deterministic, reviewable generator —
  not hand-typed, since no Xcode was available to author them
  interactively) and embedded into the host `PCA` target. This has NOT
  been opened in real Xcode — see `docs/MAC_XCODE_VALIDATION_CHECKLIST.md`
  Section 0 for the exact project-membership checks to run first.
- `PCATests/` — XCTest suite. Every test file added for PCA-15 avoids a
  hard dependency on FamilyControls/ManagedSettings/DeviceActivity/
  Security/CoreLocation at the type level (via protocol seams and
  platform-independent mirror enums), so the logic is unit-testable on
  any platform even though this workspace cannot run `xcodebuild` itself.
- `scripts/static-safety-scan.sh` — private-API/hidden-symbol grep check.

## Open and validate

Open `PCA.xcodeproj` in Xcode on macOS. Xcode and the iOS SDK are not
available in this Windows workspace — no build, simulator, device, or
entitlement validation result is claimed here. Follow
`docs/MAC_XCODE_VALIDATION_CHECKLIST.md` in full before treating any of
this as validated.

## Scope boundary

Anti-removal, shield enforcement, and Family Controls authorization
claims are scoped exactly to what Apple's public API documents (doc 07
Sections 6/10/11) — never a universal uninstall-prevention or
unconditional-protection claim. No production cryptographic algorithm is
selected anywhere in this source tree (`CRYPTO_SUITE =
PENDING_HUMAN_SECURITY_REVIEW`).

