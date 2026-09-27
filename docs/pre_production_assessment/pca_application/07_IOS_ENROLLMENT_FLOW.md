# 07 — iOS enrollment flow & entry reachability

Evidence: `[READ]` `ios/**` at `9496fb19`; backend shapes cross-checked.

## 1. Entry points and gates

- `.onOpenURL -> application.receiveEnrollmentLink(url)` (`PCAApp.swift:16`);
  `start()` on appear and `sceneBecameActive()` on foreground (:15,:17-19).
- Authorization is only *refreshed* in those paths
  (`PCAApplication.swift:177,190` -> `ChildAuthorizationCenter.swift:88-94`);
  the request button appears only when `!permitsEnforcement`
  (`ContentView.swift:33-38` -> `PCAApplication.swift:202-204` ->
  `ChildEnrollmentCoordinator.requestChildAuthorization()` :652-653).
- `beginEnrollmentIfPossible()` gate order (`PCAApplication.swift:319-358`):
  1. authorization guard (:320-325) — the pending link is **not consumed**
     while unauthorized (:325);
  2. **proof-key guard** (:326-331);
  3. attempt creation (:333-336): `attemptId` = dash-stripped UUID (32 chars),
     `attemptRecoveryToken` = two concatenated UUIDs;
  4. Keychain persist of the attempt (:339);
  5. bootstrap HTTP call (:346).

## 2. Bootstrap and recovery

- `PCAEnrollmentBootstrapClient.bootstrap`:
  `POST {base}/v1/enrollment/bootstrap` (`PCADeviceAPI.swift:53-58`) with
  `rawInvitationToken, platform:"IOS", signingPublicKey, encryptionPublicKey,
  bootstrapAttemptId, attemptRecoveryToken` (:13-31); response
  `deviceId,status,childProfileId?,ageUxTier,initialPolicyProfile` (:37-43).
- Recovery `resumeEnrollmentIfPossible()` (:365-390) ->
  `POST v1/enrollment/bootstrap/recover` `{bootstrapAttemptId,
  attemptRecoveryToken}` (`PCADeviceAPI.swift:61-65`) when a Keychain attempt
  exists and no deviceId.
- Device identity: the **backend-assigned** `deviceId` is stored via
  `UserDefaultsPCADeviceIdentityStore` — UserDefaults, not Keychain
  (`PCAApplication.swift:60-76`; saved :348/:376). Keychain holds the session
  + enrollment attempt (`PCAKeychain/PCADeviceSessionStore.swift:40-95`).

## 3. Profile confirmation, session, sync

- Child-profile confirmation: `ContentView` shows
  `PCAChildEnrollmentProfileView` when `pendingDisclosure != nil`
  (`ContentView.swift:30-34`); `confirmPendingProfile()`
  (`PCAApplication.swift:222-241`) -> `confirmChildProfile()`
  (`ChildEnrollmentCoordinator.swift:423-440`; store :309-334) -> clear the
  Keychain attempt -> `establishSessionIfNeeded()` + `synchronizeRuntime()`.
- Session (`PCAApplication.swift:394-419`):
  `POST v1/runtime-sync/devices/{deviceId}/challenge` ->
  `{challengeId,nonce,expiresAt}` then `POST …/session` `{challengeId,
  signature}` -> `{sessionToken,expiresAt}` (`PCADeviceAPI.swift:78-82,:135-146`);
  session persisted in Keychain (`PCADeviceSessionStore.swift:52-58`).
- Runtime sync (`PCAApplication.swift:425-455`): `GET /v1/runtime-sync/inbound`
  (Bearer) and `reportProtectionStatus`
  (`PCADeviceRuntimeSyncClient.swift:42-79`). Note: the `acknowledge` endpoint
  is defined but **never called** from app code (grep `.acknowledge(` ->
  definition only, `:49`).

## 4. Link parser rules (`ChildEnrollmentCoordinator.swift:218-266`)

- URLs with a fragment are rejected (:227).
- Custom scheme: `pca` + host `enroll`, **empty path**, query item `token`
  (:231-241).
- Universal link: scheme `https` + host `enroll.pca.app`, **no query**,
  exactly one path segment (:244-252).
- Token must be exactly **43 chars** of `[A-Za-z0-9_-]` (:222,:258-264) —
  matches the backend's `randomBytes(32).toString('base64url')`.
- Failed parse leaves no pending link (`PCAEnrollmentLinkRouter.receive`
  :272-278).

## 5. THE REACHABILITY VERDICT — a real user cannot enroll today

Three independent blockers, each proven:

1. **`pca://` cannot launch the app**: no `CFBundleURLTypes` registration
   anywhere (report 06 §4). The custom-scheme branch is unreachable in
   practice.
2. **The universal link cannot work**: host `enroll.pca.app` is an unowned
   placeholder and there is no AASA file in the repo (report 06 §3; external
   gate `ANDROID_APP_LINK_ASSETLINKS_HOSTING` has an iOS sibling in effect).
3. **Even with a delivered link, enrollment is structurally blocked**: the
   `PendingPCADeviceProofProvider` returns **empty** signing/encryption keys
   (`PCADeviceAPI.swift:114-119`), so the proof guard fires at
   `PCAApplication.swift:326-331` (`enrollmentBlockedBySecurityGate`) and
   bootstrap is never sent; session establishment is blocked by the same
   guard at :401 while `sign()` throws `cryptoActivationPending` (:121).

This is the documented fail-closed posture pending the external crypto
review, but the first two blockers are **entry-path defects independent of
the crypto gate** and must be fixed before any real-device enrollment can be
tested on iOS.

## 6. Other enrollment-side facts

- `FamilyKeyMaterialStore` is composed (`PCAApplication.swift:517`) but its
  only writer `persistKeyMaterial` (`ChildEnrollmentCoordinator.swift:634-645`)
  has **no production caller** (grep: definition + one test) -> DSK/DEK are
  never persisted on iOS either.
- Attempt identifiers are UUID-derived (not the 24/32-byte forms Android
  generates) — accepted by the same backend fields, no mismatch found.
