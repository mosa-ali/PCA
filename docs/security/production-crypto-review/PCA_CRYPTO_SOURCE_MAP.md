# PCA Crypto Source Map

Literal, file-by-file mapping of every protocol step in the PCA E2EE/Family Envelope/Family Trust Set/Recovery/Tamper stack to its exact source file(s), class/function name(s), covering test file(s), and current implementation status, as read directly from source at commit `e9075baa3a6005e1d953024df2b871b4ff38c63b`.

**Status legend**
- **IMPLEMENTED** — real, working, tested logic; no pending crypto decision blocks it.
- **STUB-FAIL-CLOSED** — a concrete class exists and is wired into production, but always rejects (`return false`/`null`) pending crypto suite selection. This is a deliberate security posture, not a bug.
- **NOT_IMPLEMENTED** — only an interface/type exists; no concrete implementation of any kind (including no fail-closed stub) exists anywhere in the reviewed tree.
- **PARTIAL** — the orchestration/business logic around a crypto seam is implemented and tested, but the seam itself (injected dependency) is NOT_IMPLEMENTED, so the whole path is functionally inert end-to-end.

---

## 1. Enrollment

| | |
|---|---|
| Source | `backend/src/enrollment/EnrollmentCoordinator.ts`, `EnrollmentRepository.ts`, `MySqlEnrollmentCoordinatorRepository.ts`, `types.ts`; `backend/src/device/publicKey.ts` |
| Class/function | `EnrollmentCoordinator.enrollDevice(input: EnrollDeviceInput)`; `isPlausiblePublicKey` (device/publicKey.ts) |
| Tests | `backend/test/enrollment/coordinator.test.mjs` |
| Status | **IMPLEMENTED** |
| Notes | Validates invitation token shape, platform, DSK (`signingPublicKey`)/DEK (`encryptionPublicKey`) shape via `isPlausiblePublicKey` (base64url charset + 16–256 decoded bytes — a byte-length/charset sanity check, **not** cryptographic curve validation), and rejects `KEYS_NOT_DISTINCT` if DSK and DEK are byte-identical. Resulting device is always `PAIRING_PENDING`. `MySqlEnrollmentCoordinatorRepository` performs invitation redemption + device/DSK/DEK row creation as one atomic transaction (invitation row locked `FOR UPDATE`). No crypto-algorithm dependency — pure shape validation and atomic persistence. |

## 2. Pairing

| | |
|---|---|
| Source | `backend/src/pairing/PairingService.ts`, `fingerprint.ts`, `types.ts` |
| Class/function | `PairingService.getPairingRequest`/`confirmPairing`; `computeKeyFingerprint(publicKey)` |
| Tests | `backend/test/pairing/fingerprint.test.mjs`, `backend/test/pairing/service.test.mjs` |
| Status | **IMPLEMENTED** |
| Notes | `computeKeyFingerprint` is SHA-256 over the public key bytes (standard hash, not a signature scheme — unaffected by the pending suite decision). Confirmation is service-side bookkeeping only, explicitly never family E2EE trust authority (doc 09 Section 3.2) — that stays entirely device-side. State machine `PAIRING_PENDING -> PAIRED` only, idempotent. |

## 3. FTS issuance (ordinary path)

| | |
|---|---|
| Source | `backend/src/familytrustset/FamilyTrustSetEngine.ts`, `canonicalize.ts`, `parse.ts`, `policy.ts`, `TrustSetSignatureVerifier.ts`, `FamilyTrustSetStore.ts`/`InMemoryFamilyTrustSetStore.ts` |
| Class/function | `acceptEpoch(epoch, store, verifier)`; `canonicalizeTrustSetEpoch`; `parseFamilyTrustSetEpoch`; `activeOwnerCount`/`findActiveOwner`/`findDuplicateIdentity` |
| Tests | `backend/test/familytrustset/canonicalize.test.mjs`, `parse.test.mjs`, `engine.test.mjs` |
| Status | State-machine logic **IMPLEMENTED**; signature algorithm behind `TrustSetSignatureVerifier` **NOT_IMPLEMENTED** |
| Notes | Full acceptance criteria: exactly-one-active-owner (PCA-FR-002A), DSK/DEK distinctness (own-entry + cross-entry), keyEpoch non-decrease, trustSetEpoch strict increase (not required to be exactly +1 — documented limitation: multi-epoch jumps only verify correctly if OWNER role didn't change across the gap), signature from previous epoch's stored ACTIVE OWNER DSK (or genesis trust-on-first-use). `TrustSetSignatureVerifier.verify()` has **no concrete implementation anywhere in `backend/src`**, and — unlike device-auth/envelope — **no fail-closed stub is wired into `main.ts` either**; this path has zero production entry point today. |

## 4. FTS issuance (recovery-authorized path)

| | |
|---|---|
| Source | `backend/src/familytrustset/FamilyTrustSetRecoveryEngine.ts`, `RecoveryTransactionLedger.ts` |
| Class/function | `acceptRecoveryEpoch(epoch, opened, store, verifier, ledger)` |
| Tests | `backend/test/familytrustset/recoveryEngine.test.mjs` (19 tests), `backend/test/familytrustset/recoveryRedTeam.test.mjs` (11 tests) |
| Status | Decision logic **IMPLEMENTED**, red-team tested; **PARTIAL** end-to-end (depends on `TrustSetSignatureVerifier` + `RecoveryEnvelopeCipher`, both NOT_IMPLEMENTED) |
| Notes | Structurally separate function from `acceptEpoch` (different required parameter, `OpenedRecoveryEnvelope`) — a caller cannot reach recovery-grade authorization through the ordinary call by accident; the compiler rejects it. 14 distinct rejection reasons enforced in order, including `NEW_OWNER_KEYS_NOT_DISTINCT_FROM_PRIOR` (checked deliberately before the generic duplicate-identity check, so key-resurrection gets its own precise reason), `PRIOR_DEVICE_SILENTLY_DROPPED` (every pre-recovery device must be explicitly carried forward), `NO_PRIOR_DEVICE_REVOKED` (recovery authority cannot be used when nothing is actually being recovered from), one-time `recoveryTransactionId` claim (claimed last among pre-checks, before store write — no burn-on-attempt), and a final optimistic-concurrency re-check (`CONCURRENT_EPOCH_CHANGED`) against split-brain from two racing recovery attempts. |

## 5. Envelope send (construction/canonicalization)

| | |
|---|---|
| Source | `backend/src/familyenvelope/canonicalize.ts`, `types.ts` |
| Class/function | `canonicalizeEnvelope(envelope)` |
| Tests | `backend/test/familyenvelope/canonicalize.test.mjs` |
| Status | **IMPLEMENTED** |
| Notes | Netstring-style length-prefixed encoding of every signable field in a fixed order (excludes only `signature` itself, enforced by explicit field whitelist, not object spread/iteration — the code comment explicitly warns against ever rewriting this to iterate the input's own keys). Signing/producing the actual `signature` value is not this module's job (no signer interface exists on the send side in this backend tree — signing happens device-side). |

## 6. Envelope verify (full acceptance pipeline)

| | |
|---|---|
| Source | `backend/src/familyenvelope/FamilyEnvelopeVerifier.ts`, `EnvelopeSignatureVerifier.ts`, `protocolCompatibility.ts`, `policy.ts` |
| Class/function | `evaluateEnvelope(envelope, context, verifier, replayLedger, versionLedger, messageIdempotencyLedger, options)` |
| Tests | `backend/test/familyenvelope/verifier.test.mjs` (29 tests), `protocolCompatibility.test.mjs`, `policy.test.mjs` |
| Status | Pipeline logic **IMPLEMENTED**; signature algorithm **STUB-FAIL-CLOSED** in production |
| Notes | 8 independently-checked stages (Section 6 of the review package). Ledger state advances only on full acceptance. `dryRun` option added for PCA-11's out-of-order-hold screening without side effects. Production `verifier` argument is `RejectingEnvelopeSignatureVerifier` (wired in `main.ts`), so step 8 (signature) always fails in production today — every other step is real and exercised by tests using a test-only verifier double. |

## 7. Replay protection

| | |
|---|---|
| Source | `backend/src/familyenvelope/ReplayLedger.ts`, `InMemoryReplayLedger.ts` |
| Class/function | `ReplayLedger.hasProcessed`/`recordProcessed`; `InMemoryReplayLedger` |
| Tests | `backend/test/familyenvelope/replayLedger.test.mjs` |
| Status | **IMPLEMENTED** (real, usable default — not a test-only stand-in per its own doc comment) |
| Notes | Per-sender-key set of processed `sequenceOrNonce` values, bounded at 4096 entries/sender (`REPLAY_LEDGER_CAPACITY_PER_SENDER`), oldest-insertion-order eviction. Only records on full acceptance — a rejected envelope for any reason never poisons this ledger (protects legitimate retransmission). This is ordinary bookkeeping with no algorithm-selection dependency, so it is production-usable today; the gate is entirely on step 8 of the pipeline (signature), not this ledger. |

## 8. Trust epoch (advancement/floor enforcement)

| | |
|---|---|
| Source | `backend/src/familytrustset/FamilyTrustSetEngine.ts` (`trustSetEpoch` checks), `backend/src/familyenvelope/FamilyEnvelopeVerifier.ts` (`STALE_TRUST_SET_EPOCH` check) |
| Class/function | `acceptEpoch`'s `epoch.trustSetEpoch <= currentEpoch.trustSetEpoch` check; `evaluateEnvelope`'s `envelope.trustSetEpoch < context.minimumAcceptedTrustSetEpoch` check |
| Tests | `backend/test/familytrustset/engine.test.mjs`, `backend/test/familyenvelope/verifier.test.mjs` |
| Status | **IMPLEMENTED** |
| Notes | Two independent floor checks in two different modules, both anti-downgrade-only (never move the accepted floor backward, except via the dedicated `SIGNED_ROLLBACK`/recovery paths, which are their own distinct acceptance routes, not relaxed monotonicity). |

## 9. Key epoch (advancement/floor enforcement)

| | |
|---|---|
| Source | Same files as Trust Epoch above, plus `backend/src/familytrustset/FdekRotationContract.ts` |
| Class/function | `acceptEpoch`'s `epoch.keyEpoch < currentEpoch.keyEpoch` check (non-decrease, equal allowed); `acceptRecoveryEpoch`'s `epoch.keyEpoch <= currentEpoch.keyEpoch` check (strict increase, unconditionally, per PCA-SEC-019); `evaluateEnvelope`'s `STALE_KEY_EPOCH` check; `deviceKeysToWrapFdekFor(epoch)` |
| Tests | `backend/test/familytrustset/engine.test.mjs`, `recoveryEngine.test.mjs`, `FdekRotationContract.test.mjs`, `backend/test/familyenvelope/verifier.test.mjs` |
| Status | Floor/target-selection logic **IMPLEMENTED**; actual FDEK wrap/encrypt operation **NOT_IMPLEMENTED** |
| Notes | `deviceKeysToWrapFdekFor` is a pure function returning exactly which DEKs (all `ACTIVE`-status entries, nothing else) must receive a new wrapped FDEK after a rotation — it performs no wrapping/encryption itself, deferring to the pending AEAD/KEM construction. |

## 10. Rotation

| | |
|---|---|
| Source | `backend/src/familytrustset/FdekRotationContract.ts`; conceptually, `FamilyTrustSetEngine.acceptEpoch`'s equal-keyEpoch-allowed path (metadata-only rotation) |
| Class/function | `deviceKeysToWrapFdekFor(epoch): FdekWrapTarget[]` |
| Tests | `backend/test/familytrustset/FdekRotationContract.test.mjs` (5 tests) |
| Status | PARTIAL — target selection **IMPLEMENTED**; the wrap/encrypt step it feeds is **NOT_IMPLEMENTED** |
| Notes | PCA-SEC-019: "every revocation MUST trigger an FDEK rotation to every remaining trusted device." Excludes `REVOKED`, `DEVICE_OFFLINE`, `EPOCH_STALE`, `ROTATION_PENDING`, `RECOVERY_REQUIRED` entries — only `ACTIVE` entries receive the new key; non-active-but-not-revoked devices converge on reconnect via a fresh call against whatever epoch they land on (doc 09 Section 3.5: "no atomicity claim"). |

## 11. Revocation

| | |
|---|---|
| Source | `backend/src/device/DeviceDirectoryService.ts`, `DeviceRepository.ts`, `MySqlDeviceRepository.ts`; conceptually `familytrustset` entry `status: 'REVOKED'` |
| Class/function | `DeviceDirectoryService.revokeKey`/`revokeDevice`; `DeviceRepository.revokeDeviceAndKeysAtomically` |
| Tests | `backend/test/device/service.test.mjs` |
| Status | **IMPLEMENTED** (device-directory bookkeeping); FTS-side revocation propagation is via the ordinary/recovery epoch acceptance paths above |
| Notes | `revokeDevice` cascades key revocation atomically at the repository layer. Revocation at the device-directory level is service control-plane bookkeeping; the family-trust-authoritative revocation is the FTS epoch itself (an entry's `status` becoming `REVOKED` in a newly-accepted epoch), which is a separate, device-verified event per PCA-SEC-017 — the server-side device directory is never itself the source of trust authority. |

## 12. Recovery

| | |
|---|---|
| Source | `backend/src/recovery/` (`types.ts`, `policy.ts`, `RecoveryRepository.ts`, `MySqlRecoveryRepository.ts`, `RecoveryService.ts`, `RecoveryKdf.ts`, `RecoveryEnvelopeCipher.ts`, `RecoveryEnvelopeOpener.ts`); `backend/src/recoverytransaction/` (`types.ts`, `RecoveryTransactionStore.ts`, `RecoveryTransactionCoordinator.ts`); `backend/src/familytrustset/FamilyTrustSetRecoveryEngine.ts`, `RecoveryTransactionLedger.ts` |
| Class/function | `RecoveryService` (opaque envelope CRUD); `RecoveryKdf.derive`; `RecoveryEnvelopeCipher.open`; `openStoredRecoveryEnvelope`; `RecoveryTransactionCoordinator.beginOrResume`/`finalize`; `acceptRecoveryEpoch` (see item 4) |
| Tests | `backend/test/recovery/policy.test.mjs` (2), `service.test.mjs` (17), `RecoveryEnvelopeOpener.test.mjs` (6); `backend/test/recoverytransaction/RecoveryTransactionCoordinator.test.mjs` (10); `backend/test/familytrustset/recoveryEngine.test.mjs` + `recoveryRedTeam.test.mjs` (see item 4) |
| Status | Storage/orchestration/lifecycle **IMPLEMENTED**; KDF and AEAD/KEM cipher **NOT_IMPLEMENTED** — end-to-end flow is **PARTIAL** |
| Notes | `RecoveryRepository`/`MySqlRecoveryRepository`/`RecoveryService` store and retrieve the opaque recovery-envelope blob with optimistic-concurrency version checks; fully implemented, no crypto of its own (server never decrypts). `RecoveryKdf.ts` and `RecoveryEnvelopeCipher.ts` are interface-only with explicit `CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW` citations (PCA-DEC-020/021) and **no concrete implementation anywhere in the codebase, including no fail-closed stub**. `RecoveryTransactionStore`/`RecoveryTransactionCoordinator` provide crash-safe idempotent resumability bookkeeping (fully implemented, in-memory only — no MySQL-backed implementation found), independent of the crypto gap. `RecoveryTransactionLedger` (one-time `recoveryTransactionId` claim, atomic, in-memory reference — durable impl noted as needing `INSERT ... ON CONFLICT DO NOTHING`-equivalent atomicity) is also fully implemented and crypto-independent. |

## 13. Browser enrollment

| | |
|---|---|
| Source | `parent-web/src/security/secureStorage.ts` |
| Class/function | `SecureStorage` interface; `InMemorySecureStorage` (dev singleton `secureStorage`) |
| Tests | None found for this module specifically at the reviewed commit |
| Status | **NOT_IMPLEMENTED** (dev-only in-memory stub, explicitly not production-usable) |
| Notes | Own comment: "Production needs a real secure-enclave/keystore-backed approach... This module is a dev-only in-memory stub that is intentionally NOT persisted across reloads, so it can never accidentally leak into a real persistent store." No browser-side envelope signing/verification code was found anywhere in `parent-web/src` at this commit. |

## 14. Offline queue

| | |
|---|---|
| Source | `backend/src/runtime-sync/policy.ts`, `backoff.ts`, `priority.ts`, `OutboundRelayService.ts`; Android `SyncOutboxRepository` (PCA-12, referenced but not independently re-verified in this pass — outside the requested backend/Android envelope directories) |
| Class/function | `computeBackoff(retryCount, nowEpochMillis, randomFraction?)`; `sortByPriority`; `OutboundRelayService.submitBatch` |
| Tests | `backend/test/runtime-sync/backoff.test.mjs`, `priority.test.mjs`, `OutboundRelayService.test.mjs` (file names as referenced in `package.json`'s test script; not independently re-run file-by-file in this pass beyond the full-suite run) |
| Status | **IMPLEMENTED**, no crypto dependency |
| Notes | `MAX_OUTBOUND_BATCH_SIZE = 25`, `MAX_RETRY_COUNT = 8`, bounded exponential backoff with full jitter `min(cap, base * 2^retryCount) * (0.5 + 0.5*rand())`, capped at `BACKOFF_CAP_MS = 300000`. Priority tiers: trust/security > policy > child/parent decision > receipt > critical state > activity summary, ties broken by enqueue order — this governs batch-slot ordering only, grants no additional authority (every item still independently verified). Cross-family IDOR closure: `recipientDeviceId` must resolve to a real device in the *same* family as the verified session before an envelope is queued. |

## 15. Reconnect

| | |
|---|---|
| Source | `backend/src/runtime-sync/InboundReconnectService.ts`, `DeviceSessionService.ts`, `DeviceSessionRepository.ts`, `StatusService.ts` |
| Class/function | `InboundReconnectService.reconnectDrainForRecipient`; `DeviceSessionService.issueChallengeSafely`/`completeChallenge`/`validateSession`/`revokeSession`; `DeviceSyncStatusTracker.computeState` |
| Tests | `backend/test/runtime-sync/InboundReconnectService.test.mjs`, `DeviceSessionService.test.mjs`, `flapping.test.mjs` |
| Status | Protocol logic **IMPLEMENTED**; functionally inert in production pending signature-verifier implementation (composes `DeviceAuthService`, which uses `RejectingDeviceSignatureVerifier`) |
| Notes | `reconnectDrainForRecipient` composes `RelayService.listQueuedForRecipient` → `envelopeWireCodec.parseEnvelopeFromRelayCiphertext` → `SyncCoordinator.reconnectDrain` (deterministic `(issuedAt, messageId)` ordering + dependency-hold + full security pipeline) → `RelayService.acknowledgeEnvelope` → `familysync/receipts.ts`. Bounded by `MAX_INBOUND_LIST_SIZE = 100`; unparseable envelopes stay QUEUED, not discarded. `DeviceSessionRepository` is explicitly **in-memory-only**, no MySQL-backed implementation (unlike `auth`/`deviceauth`/`device`/`enrollment`, which all have MySQL repositories) — sessions do not survive backend restart and cannot scale across multiple backend instances; a documented, deliberate scope limitation. |

## 16. Envelope wire codec (backend and Android)

| | |
|---|---|
| Source | `backend/src/runtime-sync/envelopeWireCodec.ts`; `android/app/src/main/java/org/pca/app/runtime/sync/envelope/EnvelopeWireCodec.kt` |
| Class/function | `envelopeToRelayCiphertext`/`envelopeFromRelayCiphertext` (both runtimes) |
| Tests | `backend/test/runtime-sync/envelopeWireCodec.test.mjs` (6 tests); Android `EnvelopeWireCodecTest.kt` (7 test methods) |
| Status | **IMPLEMENTED** on both runtimes, no crypto dependency |
| Notes | Pure JSON (de)serialization between the typed `FamilyEnvelope` and the relay's opaque `Buffer`/`ByteArray`. Never inspects/transforms `payload` (stays opaque ciphertext throughout). Android's ISO-8601 formatting is verified byte-for-byte compatible with JS `Date#toISOString()` (fixed pattern `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`, UTC-only, always 3 fractional digits) — both sides round-trip-check that a parsed timestamp string, once reformatted, is identical to the input, rejecting anything not already canonical. Both return `null` for structurally malformed input rather than throwing (matching `parseFamilyEnvelope`'s "no probing oracle" posture). |

## 17. Device authentication (challenge/response)

| | |
|---|---|
| Source | `backend/src/deviceauth/DeviceAuthService.ts`, `DeviceChallengeRepository.ts`/`MySqlDeviceChallengeRepository.ts`, `DeviceSignatureVerifier.ts`, `nonce.ts`, `policy.ts`, `types.ts` |
| Class/function | `DeviceAuthService.issueChallenge`/`verifyChallenge`; `generateChallengeNonce`; `DeviceChallengeRepository.consumeAtomically` |
| Tests | `backend/test/deviceauth/nonce.test.mjs` (2), `service.test.mjs` (12) |
| Status | Protocol logic **IMPLEMENTED**; signature algorithm **STUB-FAIL-CLOSED** in production |
| Notes | `generateChallengeNonce` uses `node:crypto.randomBytes(32)` (CSPRNG, "never Math.random() or a hand-rolled generator") base64url-encoded. Challenge TTL fixed at 60s, never client-negotiable. `consumeAtomically` (MySQL: single atomic `UPDATE ... WHERE consumed_at IS NULL AND expires_at > ?` guarded by InnoDB row locking) closes the concurrent-replay race even for a genuinely valid, replayed signature — verified by test "verifyChallenge REPLAY-PROOF under genuine concurrency: N simultaneous verifications of the identical valid signature -- exactly one succeeds." Calls injected `DeviceSignatureVerifier.verify(dsk.publicKey, nonce, signature)` — production wiring is `RejectingDeviceSignatureVerifier`, so every real verification currently returns `false`. **Documented open gap independent of the crypto suite**: `DeviceRepository.findDeviceUnscoped`'s doc comment flags that `issueChallenge`'s use of it is not signature-gated (proof of possession happens later, at `verifyChallenge`) — "the FIRST HTTP-wiring slice that exposes challenge issuance MUST NOT let an arbitrary caller supply an arbitrary deviceId to it" (cross-family device-existence/revocation-status enumeration oracle risk). `runtime-sync/DeviceSessionService.issueChallengeSafely` appears to begin closing this by synthesizing an indistinguishable fake challenge for NOT_FOUND/REVOKED, but the underlying repository-layer gap is still labeled unresolved in its own doc comment. |

## 18. Device signature verification (algorithm interface)

| | |
|---|---|
| Source | `backend/src/deviceauth/DeviceSignatureVerifier.ts`; `backend/src/runtime-sync/RejectingCryptoVerifiers.ts` (`RejectingDeviceSignatureVerifier`); Android has no direct equivalent — Android's device-auth signing is not modeled in the `runtime/sync/envelope/` package reviewed here |
| Class/function | `DeviceSignatureVerifier.verify(publicKey, message, signature)` |
| Tests | Exercised indirectly via `backend/test/deviceauth/service.test.mjs` using a test-only verifier double |
| Status | **STUB-FAIL-CLOSED** in production (`RejectingDeviceSignatureVerifier`, wired in `main.ts`) |
| Notes | Doc comment (verbatim): "NO concrete signature algorithm is selected or implemented anywhere behind this interface. Production suite selection (e.g. Ed25519 vs. ECDSA-P256, encoding, domain-separation prefix) is explicitly gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW (doc 09 Section 3.1, PCA-DEC-020) and must not be decided by this codebase unilaterally." `publicKey` must always be the device's DSK, never a DEK. |

## 19. Envelope signature verification (algorithm interface)

| | |
|---|---|
| Source | `backend/src/familyenvelope/EnvelopeSignatureVerifier.ts`; `backend/src/runtime-sync/RejectingCryptoVerifiers.ts` (`RejectingEnvelopeSignatureVerifier`); `android/.../runtime/sync/envelope/EnvelopeSignatureVerifier.kt` (`RejectingEnvelopeSignatureVerifier`) |
| Class/function | `EnvelopeSignatureVerifier.verify(publicKey, canonicalBytes, signature)` (both runtimes, identical shape) |
| Tests | Backend: exercised indirectly via `backend/test/familyenvelope/verifier.test.mjs` using a test-only verifier double. Android: `EnvelopeSignatureVerifierTest.kt`, 1 test method — "RejectingEnvelopeSignatureVerifier fails closed for every input, never returns true" |
| Status | **STUB-FAIL-CLOSED** on both runtimes, both wired into their respective production entry points |
| Notes | Interface is deliberately identical on both runtimes (Kotlin doc comment: "Mirrors backend/src/familyenvelope/EnvelopeSignatureVerifier.ts's interface exactly, doc 40 Section 7"). `publicKey` is always the sender's registered DSK — a DEK must never be accepted. |

## 20. Trust set signature verification (algorithm interface)

| | |
|---|---|
| Source | `backend/src/familytrustset/TrustSetSignatureVerifier.ts` |
| Class/function | `TrustSetSignatureVerifier.verify(publicKey, canonicalBytes, signature)` |
| Tests | Exercised indirectly via `backend/test/familytrustset/engine.test.mjs`, `recoveryEngine.test.mjs`, `recoveryRedTeam.test.mjs` using a test-only verifier double (`testOnlyTrustSetSignatureVerifier.mjs`) |
| Status | **NOT_IMPLEMENTED — no production wiring of any kind, not even a fail-closed stub** |
| Notes | This is the one signature seam in the reviewed tree with no `Rejecting*` class wired into `main.ts` at all. Its own doc comment cites the identical gating rationale as the other two verifiers (CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW, PCA-DEC-020), and `publicKey` is always a DSK. The absence of even a fail-closed production wiring means the FTS-epoch-acceptance code path (both `acceptEpoch` and `acceptRecoveryEpoch`) has zero exercisable entry point in the running server today. |

## 21. Recovery KDF and recovery envelope cipher (algorithm interfaces)

| | |
|---|---|
| Source | `backend/src/recovery/RecoveryKdf.ts`, `RecoveryEnvelopeCipher.ts` |
| Class/function | `RecoveryKdf.derive(recoverySecret, salt, suite)`; `RecoveryEnvelopeCipher.open(rwk, ciphertext, associatedData)` |
| Tests | Exercised indirectly via `backend/test/recovery/RecoveryEnvelopeOpener.test.mjs` using test doubles |
| Status | **NOT_IMPLEMENTED** — interface only, no concrete implementation or stub of any kind |
| Notes | Doc comment for `RecoveryKdf.ts` (verbatim): "NO concrete KDF (Argon2id, scrypt, PBKDF2, HKDF, ...) is selected or implemented anywhere behind this interface... gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW (doc 09 Section 3.1/3.6, PCA-DEC-021)." Doc comment for `RecoveryEnvelopeCipher.ts` (verbatim): "NO concrete AEAD/KEM construction (doc 09 Section 3.4's candidate pattern is RFC 9180 HPKE for device envelopes plus a reviewed password/recovery-key KDF and AEAD for the RS-protected envelope) is selected or implemented anywhere behind this interface... gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW (doc 09 Section 3.1/3.6, PCA-DEC-020/PCA-DEC-021)." `OpenedRecoveryEnvelope` is a type "intentionally producible only via a successful `RecoveryEnvelopeCipher.open` call" — a caller must not hand-construct one from unverified input. |

## 22. Tamper detection / state engine

| | |
|---|---|
| Source | `backend/src/tamper/types.ts`, `policy.ts`, `TamperEventLedger.ts`, `TamperStateEngine.ts`, `TrustedTimeHighWaterMark.ts`, `ReleaseIntegrityEvaluator.ts` |
| Class/function | `computeConvergenceState`, `computeOverallState`, `detectTamperCondition`, `computeOpenConditions`; `evaluateDeviceClock`/`advanceHighWaterMark`; `evaluateReleaseIntegrity` |
| Tests | `backend/test/tamper/TamperStateEngine.test.mjs` (23), `TrustedTimeHighWaterMark.test.mjs` (7), `ReleaseIntegrityEvaluator.test.mjs` (6) |
| Status | **IMPLEMENTED**, no crypto dependency (except `ReleaseIntegrityEvaluator`, PARTIAL — see below) |
| Notes | `STATE_PRECEDENCE` (most-severe-first: `REVOKED, RECOVERY_REQUIRED, SUSPECTED_TAMPER, DEVICE_OFFLINE, EPOCH_STALE, DEGRADED, HEALTHY`) and a `CONDITION_POLICY` map from 14 `TamperCondition` values to `{state, severity}`, made exhaustive via TypeScript `Record` exhaustiveness (doc 21 Section 3's table, "made machine-checked"). `TamperEventLedger` is append-only (doc 21 Section 1: "MUST NOT delete data automatically"), idempotent by `eventId` (mirrors `MessageIdempotencyLedger`'s pattern). `TrustedTimeHighWaterMark.advanceHighWaterMark` is monotonic by construction — its own doc comment notes this mechanism did not previously exist anywhere in the codebase (confirmed by search) prior to this lane. `ReleaseIntegrityEvaluator.evaluateReleaseIntegrity` (digest-set comparison) is fully implemented, but its own doc comment states it does NOT verify the platform code-signing signature itself — that half is "owned by the platform layer (doc 06/07) and, where cryptographic, gated the same as everything else behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW," making this component **PARTIAL** overall. |
