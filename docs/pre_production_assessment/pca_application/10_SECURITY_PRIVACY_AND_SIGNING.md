# 10 — Security, privacy & signing posture

Evidence: `[READ]` both mobile trees at `9496fb19`; CI/gates `[RECORDED]` /
`[READ]` from workflows and the release registers.

## 1. Android

- `allowBackup="false"` (`AndroidManifest.xml:129`); no backup/data-extraction
  XML exists; enforced by a test (`AllowBackupManifestTest`).
- Exported surface is minimal and justified: `MainActivity`,
  `EnrollmentActivity` (deep links only), `InstalledAppEventReceiver`
  (`PACKAGE_ADDED`, scheme package-scoped), `WebProtectionVpnService`
  (`BIND_VPN_SERVICE`-protected). Everything else non-exported.
- Secrets scan over `src/main` + `src/test` (`BEGIN … PRIVATE KEY|apiKey|
  api_key|secret|password=|client_secret`): **zero matches**. No `http://`
  literal in main source; HTTPS enforced with a localhost/emulator dev
  exception only (`HttpDeviceBootstrapApiClient.kt:34-36`,
  `HttpUrlConnectionRelayHttpClient.kt:29-38`).
- No cleartext/network-security-config needed (none present), no
  device-admin/DPC registration, no `QUERY_ALL_PACKAGES`.
- Sensitive-permission set (location incl. background, usage stats, camera,
  exact alarms, phone state) is broad but each has a matching in-app feature
  (reports 05); Play-policy justification remains an owner/release task.
- Release builds minify+shrink with `abortOnError` lint; **unsigned unless
  `PCA_RELEASE_*` env vars are provided** at build time
  (`build.gradle.kts:55-58,86`) — no keystore in-tree.

## 2. iOS

- Entitlements: `com.apple.developer.family-controls` (requires Apple
  approval — external gate), app group `group.org.pca.app` shared with all
  three extensions, associated domain `applinks:enroll.pca.app` (placeholder
  host, report 06 §3).
- **No `DEVELOPMENT_TEAM` / provisioning anywhere** -> no signed device build
  can be produced from the repo as-is (external gate).
- Keychain usage: session + enrollment attempt (`PCADeviceSessionStore.swift`);
  NOTE: the device identity is stored in **UserDefaults**
  (`PCAApplication.swift:60-76`) — a privacy/durability observation, not a
  secret leak (the value is a server-issued identifier).
- `FamilyKeyMaterialStore` composed but never written (report 07 §6).
- Shield/authorization logic includes explicit safety validators (report 08).

## 3. Cross-platform

- **Fail-closed crypto gate**: both platforms refuse to generate keys pending
  the external cryptography review; Android surfaces `CryptoReviewRequired`
  before any network call; iOS blocks at the proof guard. This is a
  security-positive posture but means **no end-to-end cryptography exists in
  production today**.
- Device proof: nonce-signature only; **no attestation**
  (Play Integrity / App Attest) anywhere in backend or clients.
- Transport: HTTPS enforced at construction on both platforms; no mTLS.
  Bearer session tokens are 4096-char-bounded at the backend
  (`runtimeSyncRoutes.ts:181-190`).
- CI artifacts: simulator/emulator builds are unsigned by design; RELEASE
  evidence records `app-release-unsigned.apk` with **0 signature blocks**
  (`docs/release_readiness/RELEASE_EVIDENCE.md:114`).

## 4. Signing & distribution readiness

- Android: release signing depends entirely on owner-held env keystore
  (gate `ANDROID_RELEASE_SIGNING_CONFIG` — repo half closed 2026-09-08,
  keystore half EXTERNAL).
- iOS: team selection + Family Controls entitlement + distribution
  provisioning are all external.
- Neither store path is exercisable from the repo; this is consistent with
  the release register (report 12).

## 5. Limitations of this review

- Static source-level review only; no dynamic testing, no live endpoints
  touched, no dependency-CVE scan performed in this session. Logging/telemetry
  content was not audited (no sensitive-data logging was found in the paths
  inspected, but that claim is out of scope here).
