# PCA Production Crypto Review Package

**Agent lane:** PCA-CRYPTO-REVIEW-PACK-1 (Agent 22)
**Base commit reviewed:** `e9075baa3a6005e1d953024df2b871b4ff38c63b`
("PCA-RUNTIME-1: Coordinator narrow glue -- Schedule<->Android production wiring, WELL-3 closure")
**Scope of this document:** documentation and evidence only. No production code was written, modified, or approved as part of producing this package. `RejectingDeviceSignatureVerifier` / `RejectingEnvelopeSignatureVerifier` (backend) and `RejectingEnvelopeSignatureVerifier` (Android) are unchanged in source at the reviewed commit and remain the production default.

**Central fact governing every section below:**

```
PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW
```

This literal marker (and its earlier-lane synonym `CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW`, doc 09 Section 3.1/3.6, decision **PCA-DEC-020**) appears at every point in the source where a concrete cryptographic algorithm, KDF, or AEAD/KEM construction would need to be selected. No such selection has been made anywhere in the reviewed commit. Every one of those seams is implemented as an *interface* with a *fail-closed* default (`return false` / `return null`), never a working implementation and never an insecure fallback. See `PCA_CRYPTO_SOURCE_MAP.md` for the exhaustive file-by-file inventory and exact quotes.

---

## 1. What this package is (and is not)

This is a **documentation and evidence package** for a human security reviewer who will decide whether, and how, to select and implement the concrete crypto suite (signature algorithm, AEAD/KEM construction, KDF) that the architecture has been deliberately built to accept, without inventing that decision unilaterally. It is not:

- A crypto suite proposal or recommendation.
- A code change of any kind.
- An approval of anything.
- A claim that the system is secure today. It is explicitly **not** secure-in-production today, because the signature verifiers that gate every meaningful acceptance decision (device authentication, family envelope acceptance, family trust set epoch acceptance) unconditionally reject everything. See Section 6.

## 2. Family Trust Set (FTS) architecture, as modeled in source

Source: `backend/src/familytrustset/` (`types.ts`, `canonicalize.ts`, `parse.ts`, `policy.ts`, `FamilyTrustSetEngine.ts`, `FamilyTrustSetRecoveryEngine.ts`, `FamilyTrustSetStore.ts`, `InMemoryFamilyTrustSetStore.ts`, `RecoveryTransactionLedger.ts`, `FdekRotationContract.ts`, `TrustSetSignatureVerifier.ts`).

The FTS is modeled per doc 09 Section 3.2 as **"a signed, versioned family object, not a server ACL"** — device-local state each device independently verifies against its own locally-held copy (PCA-SEC-017), never resolved from a server as ambient truth.

A `FamilyTrustSetEpoch` (`familytrustset/types.ts`) carries: `familyId`, `trustSetEpoch`, `keyEpoch`, an array of `FamilyTrustSetEntry` (one per family device), `issuedAt`, `supersedesEpoch` (lineage/audit metadata only, not required for exact N→N+1 chaining), and a `signature` over the whole epoch (see `canonicalize.ts`'s netstring-style, length-prefixed canonical byte encoding — the same anti-ambiguity construction used for Family Envelopes).

Each `FamilyTrustSetEntry` carries: `deviceId`, `role` (`OWNER | ADMINISTRATOR | VIEWER | CHILD` — doc 02 Section 3's four roles), `dskKeyId`/`dskPublicKey`, `dekKeyId`/`dekPublicKey`, and `status` (`ACTIVE | ROTATION_PENDING | DEVICE_OFFLINE | REVOKED | EPOCH_STALE | RECOVERY_REQUIRED`).

**Acceptance logic implemented** (`FamilyTrustSetEngine.acceptEpoch`, fully implemented, pure/testable, IMPLEMENTED status):
1. **PCA-FR-002A**: exactly one `ACTIVE` `OWNER` entry, always — zero or multiple is unconditionally rejected regardless of signature validity.
2. Every entry's DSK and DEK must be distinct key material (own-entry check), and no `deviceId`/key-id/public-key may be reused across two different entries in the same epoch (`findDuplicateIdentity`) — including cross-role reuse (an entry's DSK must never equal another entry's DEK or vice versa).
3. `keyEpoch` must never decrease relative to the store's current epoch; equal is allowed (metadata-only change need not rotate FDEK material).
4. `trustSetEpoch` must be strictly greater than the store's current epoch — not required to be exactly N+1 (a device that missed several rotations may adopt the latest epoch directly; a documented limitation is that this only verifies correctly if the OWNER role did not change across the skipped gap — see the code comment for the exact boundary).
5. Signature must come from the **authorized signer**: the previous stored epoch's `ACTIVE OWNER` DSK, or — only at genesis (no epoch stored yet) — the candidate's own claimed OWNER DSK (trust-on-first-use, doc 09 Section 3.3).

A **separate, structurally distinct** function, `FamilyTrustSetRecoveryEngine.acceptRecoveryEpoch`, implements the doc 09 Section 10 / doc 21 Section 5 recovery-authorized path: the only function that lets a new epoch's own claimed OWNER self-certify against an *already-established* family, and only when the caller supplies an `OpenedRecoveryEnvelope` bound to a one-time `recoveryTransactionId`. It performs 10+ independently-checked rejection conditions (see `PCA_CRYPTO_SOURCE_MAP.md` and the red-team test inventory in `PCA_CRYPTO_TEST_EVIDENCE.md`), is red-team tested (`backend/test/familytrustset/recoveryRedTeam.test.mjs`, 11/11 passing), and — because it is a separate function with a different required parameter, not a branch — a caller cannot reach recovery-grade authorization by accident through the ordinary `acceptEpoch` call; the compiler rejects it.

**What is NOT implemented in the FTS layer:** the actual signature math behind `TrustSetSignatureVerifier.verify()` — interface only, no concrete implementation anywhere in `backend/src`, gated behind `CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW` (PCA-DEC-020). No production wiring (not even a fail-closed `Rejecting*` stub) exists for this verifier anywhere in `main.ts` — unlike the device-auth/envelope path (Section 6), the FTS/recovery flow currently has **no runtime entry point wired at all**.

## 3. Device signing keys / DEK / FDEK / family key hierarchy, as modeled

Per doc 09 Section 3.1 (summarized by the architecture-docs research pass and cross-verified against `backend/src/device/types.ts`, `deviceauth/*`, `familytrustset/types.ts`):

| Key material | Role | Where modeled in source |
|---|---|---|
| **Recovery Secret (RS)** | High-entropy, offline, generated once at family creation, held only by the Family Owner. Feeds a KDF to produce a Recovery Wrapping Key (RWK); explicitly does **not** derive an FDEK. | `backend/src/recovery/RecoveryKdf.ts` (interface only) |
| **DSK (Device Signing Key pair)** | Per-device asymmetric signing pair. Signs trust-set epochs, family envelopes, receipts, recovery authorization. Never used for key agreement/wrapping. | `device/types.ts` (`DeviceKeyPurpose = 'DSK' \| 'DEK'`), `familytrustset/types.ts`, `familyenvelope/EnvelopeSignatureVerifier.ts` |
| **DEK (Device Key-agreement/Encryption Key pair)** | Per-device recipient encryption/KEM pair. Receives wrapped FDEK material. Never used to sign. | Same files as above |
| **FDEK (Family Data Encryption Key)** | Symmetric content key, identified by `keyEpoch`. Encrypts family activity/policy payloads. PCA infrastructure never holds a decryptable copy. | `familytrustset/FdekRotationContract.ts` (target-selection logic only — the actual wrap/encrypt step is unimplemented, crypto-gated) |
| **RWK (Recovery Wrapping Key)** | Ephemeral, exists only during a recovery transaction. | `recovery/RecoveryKdf.ts`, `recovery/RecoveryEnvelopeCipher.ts` (both interface-only) |
| **Message/session keys** | Ephemeral, per-envelope/session. | Not modeled as a distinct type anywhere in source yet — forward-secrecy construction is PCA-DEC-020's open decision (ratchet vs. simpler per-envelope AEAD keyed from current FDEK). |

**DSK/DEK role separation is architectural and enforced structurally today, independent of algorithm selection**: `FamilyTrustSetEntry.dskPublicKey !== dekPublicKey` is checked (`isDistinctKeyPair`), `DeviceSignatureVerifier`/`TrustSetSignatureVerifier`/`EnvelopeSignatureVerifier` all document "a DEK must never be accepted here," and `EnrollmentCoordinator` rejects `KEYS_NOT_DISTINCT` if a submitted DSK and DEK are byte-identical. This is real, tested, enforced logic — it just has no concrete cryptography behind either key's actual signing/encryption operation yet.

**What is NOT implemented:** the FDEK's actual generation/wrap/unwrap, the RS→RWK KDF, the recovery envelope's AEAD/KEM construction, and any concrete signature algorithm for DSK. `backend/package.json` has **no cryptography dependency at all** (only `fastify` and `mysql2` in `dependencies`; `typescript`/`@types/node` in `devDependencies`) — confirming no algorithm/library decision has been made even implicitly via a dependency choice.

## 4. Family Envelope structure, as modeled

Source: `backend/src/familyenvelope/` (`types.ts`, `canonicalize.ts`, `parse.ts`, `policy.ts`, `protocolCompatibility.ts`, `FamilyEnvelopeVerifier.ts`, `ReplayLedger.ts`/`InMemoryReplayLedger.ts`, `DataVersionLedger.ts`/`InMemoryDataVersionLedger.ts`, `MessageIdempotencyLedger.ts`/`InMemoryMessageIdempotencyLedger.ts`, `ReceiverPipeline.ts`, `EnvelopeSignatureVerifier.ts`).

`FamilyEnvelope` (per doc 22 Section 3's wire contract) carries: `protocolMajor`/`protocolMinor`, `messageId`, `familyId`, `senderDeviceId`, `recipient` (discriminated union: `DEVICE` xor `GROUP`, never both/neither — enforced both at the type level and, separately, structurally in `parse.ts` for untrusted wire input), `senderKeyId`, `messageType` (one of 15: `POLICY_UPDATE`, `POLICY_RECEIPT`, `STATUS_SNAPSHOT`, `ACTIVITY_SUMMARY`, `LOCATION_RESPONSE`, `CHILD_REQUEST`, `PARENT_DECISION`, `TAMPER_ALERT`, `RETENTION_DELETION_INSTRUCTION`, `RETENTION_RECEIPT`, `FTS_UPDATE`, `KEY_ROTATION`, `DEVICE_REVOKE`, `RECOVERY_TRANSACTION`, `SIGNED_ROLLBACK`), `trustSetEpoch`, `keyEpoch`, `sequenceOrNonce`, `issuedAt`/`expiresAt`, `semanticVersion` (dotted-integer, numeric-not-lexicographic comparison), `correlationId` (optional), `payload` (opaque `Buffer`, never decrypted/inspected by this module), and `signature` over the **entire preceding field set** (via `canonicalizeEnvelope`'s netstring length-prefixed encoding, so no field — however encoded — can be stripped or altered without invalidating the signature).

`FamilyEnvelopeVerifier.evaluateEnvelope` implements, fully and independently for each check (doc 09 PCA-SEC-022's "every check is independent" discipline; cheap checks run before expensive signature verification, but every path that doesn't return early still reaches the signature check):
1. Protocol-major compatibility.
2. Message-id idempotency short-circuit (byte-identical redelivery → stable accept; a changed envelope reusing a stolen messageId → `MESSAGE_ID_CONFLICT`, never a bypass).
3. Expiry.
4. Trust-set-epoch floor (anti-downgrade).
5. Key-epoch floor (anti-downgrade).
6. Anti-replay (per-sender-key sequence/nonce ledger, bounded 4096 entries/sender).
7. Semantic-version strict-increase, but **only for `POLICY_UPDATE`** (and exempted, floor-resetting, for `SIGNED_ROLLBACK`, its own message type — "a rollback is a message type, not a relaxed monotonicity check," doc 22 Section 6).
8. Signature verification via the injected `EnvelopeSignatureVerifier`.

Ledger state is advanced **only on full acceptance** — a rejected envelope for any reason never moves any ledger forward (documented explicitly to protect legitimate retransmission).

**What this module deliberately does not implement** (see `ReceiverPipeline.ts`'s documented interface-only stages): FTS/sender-key resolution, sender-role authorization, payload decrypt/authenticate (needs the pending AEAD/KEM), payload schema/authorization. These are fixed as typed interfaces (`SenderKeyResolver`, `SenderRoleAuthorizer`, `PayloadDecryptor`, `PayloadSchemaAuthorizer`) a future caller composes against — the shape is authorized now; the crypto behind `PayloadDecryptor` is not.

## 5. Recovery Secret / Recovery Envelope architecture

Per doc 09 Section 3.4/Section 10 and doc 21 Section 5 (verified against source in `backend/src/recovery/`, `backend/src/recoverytransaction/`, `backend/src/familytrustset/FamilyTrustSetRecoveryEngine.ts`):

- **PCA-SEC-018**: the Recovery Secret (RS) MUST be presented offline at family creation with explicit acknowledgement that losing both the RS and all active parent devices makes recovery **permanently impossible**. PCA infrastructure never receives the RS, an escrow share, or any recoverable derivative — no support-agent bypass exists (doc 08 PCA-FR-144).
- The recovery envelope's documented contents (doc 09 Section 3.4, exact): "an authenticated-encrypted object containing only: `familyId`, envelope format/KDF suite IDs, salt, recovery-envelope ID, creation/key/trust-set epochs, encrypted FDEK(s) and the minimum signed FTS material needed to start recovery." Associated data binds `familyId`, envelope ID, epochs, and suite IDs. It contains no activity plaintext; PCA may retain an opaque copy for delivery/availability, but it is not PCA-decryptable.
- **Candidate construction only, not yet decided** (PCA-DEC-020/PCA-DEC-021, doc 09 Section 15): "RFC 9180 HPKE for device envelopes plus a reviewed password/recovery-key KDF and AEAD for the RS-protected envelope." This is explicitly a recommendation pending specialist cryptographic approval, platform-library review, and test vectors — not a finished decision.
- Source-level: `recovery/RecoveryKdf.ts` (`RecoveryKdf.derive(recoverySecret, salt, suite)`) and `recovery/RecoveryEnvelopeCipher.ts` (`RecoveryEnvelopeCipher.open(rwk, ciphertext, associatedData) -> OpenedRecoveryEnvelope | null`) are both **interface-only, no concrete implementation anywhere**, each with its own `CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW` doc-comment citation.
- `recovery/RecoveryEnvelopeOpener.openStoredRecoveryEnvelope` orchestrates retrieval → KDF-derive → cipher-open, fully implemented as *orchestration*, but functionally inert without concrete KDF/cipher implementations to inject.
- The **recovery transaction** flow (doc 09 Section 10 / doc 21 Section 5): replacement parent generates fresh DSK/DEK → fetches the opaque recovery envelope → derives RWK locally from RS → opens it → constructs FTS epoch N+1 (new owner, all prior devices explicitly carried forward with an explicit status, at least one newly `REVOKED`) → fresh FDEK at `keyEpoch` N+1, wrapped only to remaining/new active DEKs → a one-time `recoveryTransactionId`, claimed atomically (never check-then-write) via `RecoveryTransactionLedger.claimTransaction`, accepted once. `RecoveryTransactionCoordinator` (in `backend/src/recoverytransaction/`) provides idempotent-resumability bookkeeping around this (a crash-safe "first attempt's proposal is authoritative" semantics) — fully implemented, no crypto dependency of its own, but functionally inert because it ultimately calls `acceptRecoveryEpoch`, which needs the unimplemented `TrustSetSignatureVerifier`/`RecoveryEnvelopeCipher`.
- 11 red-team attack scenarios against `acceptRecoveryEpoch` are implemented and passing (replay, partial-transaction, stale-epoch reuse on both axes, lost-key resurrection, second-owner creation, server/relay spoofing, cross-family recovery, malformed proof, clock manipulation) — see `PCA_CRYPTO_TEST_EVIDENCE.md`.

**Unrecoverable case, explicit in doc 08 PCA-FR-144**: recovery-code loss with no active parent device → `RECOVERY_REQUIRED` but genuinely unrecoverable; no bypass exists by design.

## 6. Fail-closed production wiring (the single most important fact for this review)

`backend/src/runtime-sync/RejectingCryptoVerifiers.ts` (full file, verified read):

```ts
export class RejectingDeviceSignatureVerifier implements DeviceSignatureVerifier {
  async verify(_publicKey: string, _message: string, _signature: string): Promise<boolean> {
    return false;
  }
}

export class RejectingEnvelopeSignatureVerifier implements EnvelopeSignatureVerifier {
  async verify(_publicKey: string, _canonicalBytes: string, _signature: string): Promise<boolean> {
    return false;
  }
}
```

Its doc comment states plainly: **"PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW... These two verifiers are the PRODUCTION default this lane wires into main.ts until that review happens: every verification attempt fails closed (returns false), never open. This means device-session issuance and inbound envelope acceptance are both, correctly, completely non-functional in production today -- that is the honest state, not a bug to work around. DO NOT replace these with a verifier that returns true, a signature-format check without real cryptography, or any other shortcut."**

`backend/src/main.ts` (verified read, lines 39-84) wires exactly these two classes into the real HTTP server: `DeviceAuthService` receives `new RejectingDeviceSignatureVerifier()`; `SyncCoordinator` receives `new RejectingEnvelopeSignatureVerifier()`. `main.ts` also wires an inert placeholder `resolveEnvelopeContext` returning `senderPublicKey: ''`, with a comment explicitly noting this value is inert because the signature check that would use it always fails first.

The Android counterpart (`android/.../runtime/sync/envelope/EnvelopeSignatureVerifier.kt`) ships an identical `RejectingEnvelopeSignatureVerifier` that always returns `false`, with a comment cross-referencing the backend file by name and stating the same "do not replace with a shortcut" instruction.

**No equivalent fail-closed stub exists for `TrustSetSignatureVerifier` (FTS), `RecoveryKdf`, or `RecoveryEnvelopeCipher` anywhere in `main.ts` or elsewhere in `backend/src`.** These three interfaces have zero production wiring of any kind — not even a rejecting stub — only a test-only double (`testOnlyTrustSetSignatureVerifier.mjs`) used by the red-team test suite. This means the FTS-epoch-acceptance and recovery-transaction-finalize code paths have no exercisable entry point in the running server today, by omission, distinct from the device-auth/envelope path which is reachable but always rejects.

## 7. Android Keystore usage

`android/app/src/main/java/org/pca/app/persistence/crypto/AndroidKeystoreLocalRecordCipher.kt` is a real, **production, IMPLEMENTED** use of Android Keystore: `KeyStore.getInstance("AndroidKeyStore")`, AES-256/GCM/NoPadding, `KeyGenParameterSpec` with `PURPOSE_ENCRYPT|PURPOSE_DECRYPT`, `BLOCK_MODE_GCM`, `ENCRYPTION_PADDING_NONE`, `setRandomizedEncryptionRequired(true)`, non-exportable key alias `pca_local_record_cipher_key_v1`.

This is explicitly documented as **out of scope for the `PRODUCTION_CRYPTO_SUITE` gate**: its own doc comment states it is "application-level field encryption backed by Android Keystore key material -- deliberately NOT a claim on PRODUCTION_CRYPTO_SUITE (doc 09 Section 3's family E2EE key hierarchy remains CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW). [It] only protects this device's own local Room database file against extraction... it makes no multi-party/E2EE claim." In other words: local-at-rest field encryption on Android is a settled, implemented, lower-stakes decision, entirely separate from — and does not substitute for — the family E2EE envelope/trust-set signature suite, which remains unimplemented. No Android Keystore usage exists anywhere in the `runtime/sync/envelope/` package itself; the sync/envelope layer performs zero cryptographic operations of its own and defers entirely to the fail-closed verifier.

No Tink or BouncyCastle dependency exists anywhere in the Android Gradle build files.

## 8. Browser WebCrypto usage and trusted-endpoint model

`parent-web/src/security/secureStorage.ts` (verified read, full file) is an explicit **dev-only, in-memory stub**: its own comment states "Production needs a real secure-enclave/keystore-backed approach... e.g. a non-extractable WebCrypto CryptoKey held only in memory / IndexedDB with `extractable: false`. This module is a dev-only in-memory stub that is intentionally NOT persisted across reloads." No production WebCrypto usage exists in `parent-web/` at the reviewed commit; no literal "WebCrypto" or `crypto.subtle` reference exists anywhere else in `parent-web/src`.

Doc 40 (`docs/architecture/40_OFFLINE_FIRST_RUNTIME_SYNC.md`) describes a "browser-neutral parent SDK" as one of three runtime processes sharing the same `PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW` gate, but does not name WebCrypto specifically or give it its own implementation-status marker distinct from the shared gate.

**Browser trusted-endpoint model**: no `trusted-endpoint`-named file or module was found anywhere in this worktree at the reviewed commit (`e9075ba...`). Per the task brief's instruction, this package does not depend on Agent 21's (separate, not-visible-here) work to describe that model; it instead documents, above, the actual interface/port-level state at this commit: a dev-stub `SecureStorage` interface in `parent-web/src/security/secureStorage.ts` and the shared `PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW` gate that any real browser-side signing/encryption implementation would need to satisfy. If Agent 21's work has landed on a different branch/lane not present in this worktree, this package cannot verify or describe its content, and this section should not be read as a statement about that separate work one way or the other.

## 9. iOS Keychain / CryptoKit status

**NOT YET IMPLEMENTED — confirmed absent from source and from documentation.** No `Keychain` or `CryptoKit` reference of any kind was found in the iOS source tree (`ios/` — an "inert SwiftUI launch shell" per the git history at an earlier commit; not part of this reviewed commit's scope beyond confirming absence) or anywhere in `docs/architecture/*.md`. A targeted search of the full architecture doc set for the literal string "CryptoKit" returned zero matches. Doc 07 (iOS Architecture) references "doc 09 for key-hierarchy/rotation design behind Section 12's Keychain placement" only as a forward pointer, with no iOS-specific algorithm-suite or CryptoKit-usage statement. Doc 09/04's platform-limitations table gives iOS Secure Enclave (like Android Keystore) a `VERIFIED_WITH_LIMITATION` label (hardware backing varies by device tier), but this describes intended future platform-secure-storage usage, not an implemented or even design-committed CryptoKit integration. **Conclusion for the reviewer: treat all iOS-side E2EE/Family Envelope crypto as unstarted future work, with no source, no design commitment beyond the same generic cross-platform key-hierarchy language applied to Android, and no CryptoKit decision of any kind on record.**

## 10. Summary table: implementation status by architectural component

| Component | Status | Evidence |
|---|---|---|
| Family Envelope structure/parse/canonicalize | IMPLEMENTED | `familyenvelope/types.ts`, `parse.ts`, `canonicalize.ts` — fully tested |
| Family Envelope acceptance pipeline (replay/expiry/epoch/version) | IMPLEMENTED | `FamilyEnvelopeVerifier.evaluateEnvelope` — fully tested |
| Family Envelope signature verification (algorithm) | STUB-FAIL-CLOSED | `EnvelopeSignatureVerifier` interface; `RejectingEnvelopeSignatureVerifier` wired in `main.ts` |
| Family Trust Set structure/parse/canonicalize/acceptance state machine | IMPLEMENTED | `familytrustset/*` — fully tested |
| Family Trust Set signature verification (algorithm) | NOT_IMPLEMENTED, no production wiring at all | `TrustSetSignatureVerifier` interface only |
| Recovery-transaction lifecycle bookkeeping | IMPLEMENTED | `recoverytransaction/*` — fully tested, no crypto dependency itself |
| Recovery-authorized FTS acceptance (`acceptRecoveryEpoch`) | IMPLEMENTED, red-team tested; functionally inert without crypto deps | `FamilyTrustSetRecoveryEngine.ts` — 11/11 red-team tests pass against a test-only verifier double |
| Recovery Secret → RWK KDF | NOT_IMPLEMENTED | `RecoveryKdf.ts` interface only |
| Recovery envelope AEAD/KEM open | NOT_IMPLEMENTED | `RecoveryEnvelopeCipher.ts` interface only |
| Device auth challenge/response protocol | IMPLEMENTED | `deviceauth/DeviceAuthService.ts` — fully tested |
| Device auth signature verification (algorithm) | STUB-FAIL-CLOSED | `DeviceSignatureVerifier` interface; `RejectingDeviceSignatureVerifier` wired in `main.ts` |
| Tamper detection / state engine / clock rollback | IMPLEMENTED, no crypto dependency | `tamper/*` — fully tested |
| Release integrity digest comparison | IMPLEMENTED for digest-set comparison; platform-signature half out of scope, crypto-gated | `ReleaseIntegrityEvaluator.ts` |
| Android envelope wire codec | IMPLEMENTED | `EnvelopeWireCodec.kt` — fully tested |
| Android envelope signature verification (algorithm) | STUB-FAIL-CLOSED | `RejectingEnvelopeSignatureVerifier.kt` |
| Android Keystore (local-at-rest field encryption) | IMPLEMENTED, out-of-scope for E2EE gate | `AndroidKeystoreLocalRecordCipher.kt` |
| Browser WebCrypto / trusted key storage | NOT_IMPLEMENTED, dev stub only | `parent-web/src/security/secureStorage.ts` |
| iOS Keychain / CryptoKit | NOT_IMPLEMENTED, no source, no design commitment | absent from source and docs |

See `PCA_CRYPTO_SOURCE_MAP.md` for the complete, file-by-file, test-cited mapping this table summarizes.
