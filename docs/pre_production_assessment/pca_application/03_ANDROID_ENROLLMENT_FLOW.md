# 03 — Android enrollment flow (source-complete, cryptographically gated)

Evidence: `[READ]` `android/**` at `9496fb19`. All `path:line` from the
Android source; backend shapes cross-checked against `backend/src/http/routes`.

## 1. Entry and link parsing

- Entry point: `EnrollmentActivity` (`EnrollmentActivity.kt:26` reads
  `graph.enrollmentCoordinator`; `:28` submits `intent.dataString`;
  `onNewIntent` re-submits :62-66). Launchable directly (manifest comment
  :144-149) and via two intent filters (report 02 §2).
- Accepted URI shapes (`EnrollmentLinkParser.kt`):
  1. `pca://enroll?token=<token>` — query pair named exactly `token`,
     non-empty; host compare is exact (`:52-72`);
  2. `https://enroll.pca.app/<last non-empty path segment>` (`:74-80`).
- Config: `EXPECTED_SCHEME "pca"` / `EXPECTED_HOST "enroll"`
  (`EnrollmentDeepLinkConfig.kt:17-18`); `APP_LINK_HOST` =
  `enroll.pca.app` (`:45,:47`) — **documented as an unowned placeholder**
  (`:30-38`), see report 12 gate `ANDROID_APP_LINK_ASSETLINKS_HOSTING`.
- `serverBaseUrl` derived from the link (`EnrollmentLinkParser.kt:73,79`) is
  **metadata only** — it is carried in state
  (`EnrollmentCoordinator.kt:101,123,165,293,296`) but never used for I/O;
  HTTP always uses the configured base URL (report 02 §1).

## 2. States (`EnrollmentState.kt`)

`NotEnrolled`, `InvitationReady` (:19), `ProfileConfirmation`,
`PreparingKeys`, `Bootstrapping`, `PairingPending`, `FailedRetryable`,
`FailedInvitationInvalid`, `CryptoReviewRequired`, `Revoked` (:54),
`BootstrapResultUnknown`, `RecoveryPending` (:87).

## 3. Bootstrap HTTP (contract verified both sides)

`HttpDeviceBootstrapApiClient`:

- `POST /v1/enrollment/bootstrap` with JSON
  `rawInvitationToken, platform, signingPublicKey, encryptionPublicKey,
  bootstrapAttemptId, attemptRecoveryToken` (`:135-142`);
  201 -> parse; 404 -> `InvitationUnavailable`; 400 -> `InvalidRequest`;
  other -> `UnexpectedServerError` (`:144-149`). 15 s timeouts, 8 KB bounded
  response body.
- `POST /v1/enrollment/bootstrap/recover` with
  `bootstrapAttemptId, attemptRecoveryToken`; 200 -> parse (`:159-175`).
- HTTPS enforced except `localhost/127.0.0.1/10.0.2.2` with explicit
  `allowInsecureHttp=true` (`:34-36`).
- Backend: `bootstrapRoutes.ts:52-105` (201 + `toBootstrapResultDto`) and
  `:113-158`; response DTO `deviceId,status,childProfileId,ageUxTier,
  initialPolicyProfile` (`dto.ts:96-118`), registered `buildServer.ts:495`.
  Client parses exactly those fields (`HttpDeviceBootstrapApiClient.kt:212-234`).

## 4. THE GATE — production key generation always throws

- The **only** production generator is `NotApprovedDeviceKeyPairGenerator`,
  whose `generateSigningKeyPair()` and `generateEncryptionKeyPair()` both
  `throw CryptoSuiteNotApprovedException` (`DeviceKeyPairGenerator.kt:60-70`;
  independently spot-checked this session).
- The coordinator catches it and moves to `CryptoReviewRequired` **before any
  network call and with no persistence**
  (`EnrollmentCoordinator.kt:143-151`; state doc `EnrollmentState.kt:48`).
- Net effect: **Android enrollment cannot complete in production today.** This
  is the deliberate fail-closed posture pending the external cryptography
  review (same family as the parent-web genesis gate); it is not a regression,
  but it means zero end-to-end enrollment evidence exists.

## 5. Local persistence & recovery

- `attemptId` (24 B / 32-char base64url) and `attemptRecoveryToken`
  (32 B / 43-char) generated client-side (`AttemptIdentifiers.kt:22-33`).
- Durable `PendingEnrollmentAttempt` written **before** the request
  (`EnrollmentCoordinator.kt:175`); it **does not store the raw invitation
  token** (`PendingEnrollmentAttemptStore.kt:20-31`), is encoded field-wise
  (`PersistentPendingEnrollmentAttemptStore.kt:34-50`, key
  `pending_enrollment_attempt_v1`) into encrypted prefs
  (`EncryptedSharedPreferencesStateStore`, `PcaAppGraph.kt:1040-1048`).
- Recovery `recoverAttempt()` (`:265-303`): NotFound/InvalidRequest -> clear +
  `FailedInvitationInvalid`; Ambiguous/Unknown -> stay `RecoveryPending`;
  success -> `ProfileConfirmation`. `retryBootstrap()` (`:192-201`) re-sends
  the same tuple while the raw token is still in memory.
- Restart: `restoreInitialState()` (`:84-102`) — persisted outcome ->
  `Revoked`/`PairingPending`; else pending attempt -> `RecoveryPending`;
  else `NotEnrolled`.

## 6. Success path and known gaps

- `confirmProfile()` (`:313-331`) writes a Room audit row
  (`enrollment_lifecycle_audits`, `:34-49`) then a single
  `FamilyStateStore.save` mapping server status -> `PairingState` (`:350-397`),
  landing in `PairingPending(deviceId)`.
- **`familyId` is written as `""`** — explicitly documented `KNOWN_GAP`
  (`EnrollmentCoordinator.kt:355,:378-390`).
- **No de-enrollment path**: the only writer of `FamilyStateStore` is
  `persistSuccess` (:376); grep for
  `de-?enroll|unenroll|leaveFamily|REMOVE_DEVICE|wipeAll|factoryReset` finds
  no removal flow; `Revoked` is only reachable if the store already says
  REVOKED (:87) — nothing writes it.
- No production implementation exists for `EnrollmentApiClient`
  (`EnrollmentApiClient.kt:11-19`) or `PairingApiClient`
  (`PairingApiClient.kt:22-25`) — both are interface-only.

## 7. Assessment

Flow mechanics (link parsing, persistence, recovery, contract shape) are
well-built and defensively designed. The blocking issues are: (a) the crypto
gate (by design, external), (b) the enrollment-link host is an unowned
placeholder (external AssetLinks gate; the custom scheme is a usable interim
on Android), and (c) the success path cannot yet produce a usable device
identity for sync (report 04).

## 8. FINAL CROSS-ASSESSMENT UPDATE — API + PARENT/PLATFORM (2026-09-26)

Appended after the completed API assessment (`docs/pre_production_assessment/api/`)
and the Parent+Platform final assessment (`docs/pre_production_assessment/pca_parent_platform/`).
Documentation-only: no finding in this report was rewritten.

- ORIGINAL_FINDING = enrollment-link host `enroll.pca.app` is an unowned placeholder;
  Android accepts `pca://enroll?token=` and `https://enroll.pca.app/<token>` (§1), and
  the serverBaseUrl carried from the link is metadata only (HTTP uses the configured base).
- NEW_EVIDENCE = Parent Web's **production** bundle generates
  `http://localhost:4000/enroll/<token>` links/QRs (PP-F01;
  `pca_parent_platform` report 04 §2, live-bundle extraction). Neither Android shape
  can match that link: it is not the `pca://` scheme, and its host is not
  `APP_LINK_HOST`. So the link-based enrollment path cannot work in production even
  before the App-Link host is provisioned.
- SOURCE_ASSESSMENT = `pca_parent_platform`: report 04 §2 (PP-F01 evidence chain),
  register PP-F01, risk R-PP-02; mobile register MOB-025 (new).
- REVISED_DEPENDENCY = Android enrollment is a **MULTI_LAYER** dependency:
  Parent Web (link base + missing production guard) · Android (App-Link/deep-link host
  contract) · API/security gate (§4 crypto gate, MOB-001) · deployment/domain
  configuration (owned host + assetlinks, MOB-004). The fallback-code path and the
  custom scheme remain the interim mechanisms; neither is device-proven.
- VERDICT_CHANGED = **NO** — this report's flow assessment stands; item (b) in §7 is
  now explicit and cross-referenced.
