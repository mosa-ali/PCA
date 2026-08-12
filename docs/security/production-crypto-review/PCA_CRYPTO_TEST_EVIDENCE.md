# PCA Crypto Test Evidence

All numbers on this page were produced by actually running the test suites in this worktree (`D:\PCA\pca-app\.claude\worktrees\agent-ae7c3c9a89e7118ae`), at commit `e9075baa3a6005e1d953024df2b871b4ff38c63b`, not inferred from file listings.

## 1. Environment setup

`backend/node_modules` was not present at checkout. `npm install` was run in `backend/` (66 packages installed; 1 high-severity advisory reported by `npm audit`, not investigated further as out of scope for this documentation-only lane — flagged for the reviewer's awareness, not a crypto-suite concern). No source files were modified.

## 2. Full backend suite (`cd backend && npm test`)

Command run verbatim: `npm test` (runs `tsc` build, then `node test/schema-privacy.test.mjs`, `node test/server.test.mjs`, then `node --test` across the entire `test/` tree — full command list in `backend/package.json`'s `"test"` script, covering ~100 test files across every backend domain, not only crypto-adjacent ones).

**Result: all tests passed.**

```
# tests 928
# suites 0
# pass 928
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 8423.795
```

(This total is from the `node --test` portion, which is the bulk of the suite; the two standalone scripts, `schema-privacy.test.mjs` and `server.test.mjs`, also passed, run separately before the `node --test` batch, with their own internal pass/fail reporting confirmed clean in the captured output.)

## 3. Crypto-relevant subset, run together

The following 23 test files (every crypto/security-adjacent file among the modules in scope for this review: familyenvelope, familytrustset, tamper, recoverytransaction, deviceauth, runtime-sync envelope codec, and recovery) were run together via `node --test <files...>`:

```
# tests 243
# pass 243
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 862.3333
```

## 4. Per-file breakdown (each file also run individually to confirm isolated pass/fail, not just aggregate)

| Test file | Module under test | Tests | Pass | Fail |
|---|---|---|---|---|
| `backend/test/familyenvelope/canonicalize.test.mjs` | `familyenvelope/canonicalize.ts` | 5 | 5 | 0 |
| `backend/test/familyenvelope/parse.test.mjs` | `familyenvelope/parse.ts` | 21 | 21 | 0 |
| `backend/test/familyenvelope/replayLedger.test.mjs` | `familyenvelope/ReplayLedger.ts` / `InMemoryReplayLedger.ts` | 6 | 6 | 0 |
| `backend/test/familyenvelope/dataVersionLedger.test.mjs` | `familyenvelope/DataVersionLedger.ts` / `InMemoryDataVersionLedger.ts` | 4 | 4 | 0 |
| `backend/test/familyenvelope/messageIdempotencyLedger.test.mjs` | `familyenvelope/MessageIdempotencyLedger.ts` / `InMemoryMessageIdempotencyLedger.ts` | 5 | 5 | 0 |
| `backend/test/familyenvelope/protocolCompatibility.test.mjs` | `familyenvelope/protocolCompatibility.ts` | 3 | 3 | 0 |
| `backend/test/familyenvelope/policy.test.mjs` | `familyenvelope/policy.ts` | 4 | 4 | 0 |
| `backend/test/familyenvelope/verifier.test.mjs` | `familyenvelope/FamilyEnvelopeVerifier.ts` (full acceptance pipeline) | 29 | 29 | 0 |
| `backend/test/familytrustset/canonicalize.test.mjs` | `familytrustset/canonicalize.ts` | 4 | 4 | 0 |
| `backend/test/familytrustset/parse.test.mjs` | `familytrustset/parse.ts` | 10 | 10 | 0 |
| `backend/test/familytrustset/engine.test.mjs` | `familytrustset/FamilyTrustSetEngine.ts` (`acceptEpoch`) | 26 | 26 | 0 |
| `backend/test/familytrustset/recoveryEngine.test.mjs` | `familytrustset/FamilyTrustSetRecoveryEngine.ts` (`acceptRecoveryEpoch`) | 19 | 19 | 0 |
| `backend/test/familytrustset/recoveryRedTeam.test.mjs` | `acceptRecoveryEpoch` under 11 named red-team attack scenarios | 11 | 11 | 0 |
| `backend/test/familytrustset/FdekRotationContract.test.mjs` | `familytrustset/FdekRotationContract.ts` | 5 | 5 | 0 |
| `backend/test/tamper/TamperStateEngine.test.mjs` | `tamper/TamperStateEngine.ts` | 23 | 23 | 0 |
| `backend/test/tamper/TrustedTimeHighWaterMark.test.mjs` | `tamper/TrustedTimeHighWaterMark.ts` | 7 | 7 | 0 |
| `backend/test/tamper/ReleaseIntegrityEvaluator.test.mjs` | `tamper/ReleaseIntegrityEvaluator.ts` | 6 | 6 | 0 |
| `backend/test/recoverytransaction/RecoveryTransactionCoordinator.test.mjs` | `recoverytransaction/RecoveryTransactionCoordinator.ts` | 10 | 10 | 0 |
| `backend/test/deviceauth/nonce.test.mjs` | `deviceauth/nonce.ts` | 2 | 2 | 0 |
| `backend/test/deviceauth/service.test.mjs` | `deviceauth/DeviceAuthService.ts` | 12 | 12 | 0 |
| `backend/test/runtime-sync/envelopeWireCodec.test.mjs` | `runtime-sync/envelopeWireCodec.ts` | 6 | 6 | 0 |
| `backend/test/recovery/policy.test.mjs` | `recovery/policy.ts` | 2 | 2 | 0 |
| `backend/test/recovery/service.test.mjs` | `recovery/RecoveryService.ts` | 17 | 17 | 0 |
| `backend/test/recovery/RecoveryEnvelopeOpener.test.mjs` | `recovery/RecoveryEnvelopeOpener.ts` | 6 | 6 | 0 |
| **Total** | | **243** | **243** | **0** |

The individual-file total (243) matches the combined-run total (243) exactly, confirming no cross-file interference/ordering dependency in the reported counts.

## 5. What these tests do and do not prove

**They prove**: every implemented state machine, ledger, parser, canonicalizer, and orchestration function behaves correctly against its own documented specification, including adversarial/red-team scenarios, using test-only signature-verifier doubles (e.g. `testOnlyTrustSetSignatureVerifier.mjs`) that simulate a *working* signature check so the surrounding logic can be exercised.

**They do not prove**: that the real (not-yet-selected) cryptographic algorithm is implemented correctly, is free of side-channel leakage, uses constant-time comparison, or resists any cryptanalytic attack — because no real algorithm implementation exists in this codebase to test. Every test exercising a "valid signature" path does so against a test-only stand-in, not real cryptography. This is the correct and expected state given `PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW`, and should not be mistaken for cryptographic validation.

## 6. Android test evidence

Android tests were not executed in this pass (this worktree's toolchain focus was the backend `npm test` run per the task's explicit verification instruction; a Gradle/JVM toolchain run was not performed). Based on direct reading of the test source files (not execution):

- `android/app/src/test/java/org/pca/app/runtime/sync/EnvelopeSignatureVerifierTest.kt` — 1 test method: "RejectingEnvelopeSignatureVerifier fails closed for every input, never returns true" (asserts `verify()` returns `false` for both a populated arbitrary input and an all-empty-string input).
- `android/app/src/test/java/org/pca/app/runtime/sync/EnvelopeWireCodecTest.kt` — 7 test methods covering DEVICE/GROUP recipient round-trip, correlationId round-trip, binary payload fidelity (including `0x00`/`0xff` boundary bytes), cross-runtime ISO-8601 format compatibility with JavaScript's `toISOString()`, and null-not-throw handling for malformed/structurally-invalid JSON.
- `android/app/src/test/java/org/pca/app/persistence/crypto/LocalRecordCipherTest.kt` — tests `InMemoryLocalRecordCipher` (the JVM test-only AES/GCM double, not the production `AndroidKeystoreLocalRecordCipher`): round-trip correctness, IV randomization (same plaintext produces different ciphertext each call), tamper detection (`AEADBadTagException` on tampered ciphertext), and null-safe optional-field wrapping.

**Reviewer note**: these counts and descriptions are from direct source reading by a research pass in this same session, not from an executed Gradle test run. If the reviewer requires executed Android test evidence with pass/fail counts, that must be run separately (`./gradlew test` or equivalent) — it was not performed as part of this documentation package.

## 7. Explicit non-claim

This test evidence, however clean (928/928, 243/243 passing), is **not evidence that the crypto suite is ready for production**. It is evidence that the surrounding protocol machinery is well-built and ready to *receive* a reviewed cryptographic implementation. The reviewer's decision is squarely about the cryptography that these tests deliberately do not — and cannot yet — exercise.
