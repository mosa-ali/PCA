# 04 — Android device identity & device proof

Evidence: `[READ]` `android/**` at `9496fb19`.

## 1. What produces device identity

- `PersistentDeviceIdentityProvider` reads
  `FamilyStateStore.currentState()?.deviceId`
  (`DeviceIdentityProvider.kt:45-50`) — no fabricated IDs; the id is the one
  the backend returned at bootstrap (`deviceId` in the bootstrap DTO).
- The id is persisted inside `LocalFamilyState` via the encrypted
  `pca_runtime_state` store (`PcaAppGraph.kt:1040-1048`).

## 2. Keystore and key material — the honest picture

- There is **no EC/RSA/StrongBox code anywhere** (grep
  `StrongBox|setIsStrongBoxBacked|setUserAuthenticationRequired` -> zero).
- `SecureKeyStore` is an opaque-blob interface (`SecureKeyStore.kt:16-21`).
  `EncryptedBlobSecureKeyStore` (AES256-SIV/GCM via EncryptedSharedPreferences,
  `EncryptedBlobSecureKeyStore.kt:13-40`) and `InMemorySecureKeyStore`
  (`:25-32`) are **never constructed in production** (grep: the class name
  appears only in its own file and one doc reference
  `EncryptedSharedPreferencesVault.kt:10`). The graph constructs **no**
  `SecureKeyStore` at all.
- Consequence of report 03 §4: because the only production generator throws,
  **no private key material is ever generated or stored today**. The
  `signingPublicKey`/`encryptionPublicKey` bootstrap fields are therefore
  unfillable in production until the crypto gate clears.

## 3. Device-proof pipeline (scaffolded, inert)

- `DeviceAuthChallengeClient` is **dead code**: grep
  `DeviceAuthChallengeClient|DeviceChallengeSigner|requestChallenge|submitSignedChallenge`
  across `android/**` returns only its declaration file
  (`DeviceAuthChallengeClient.kt:8,14-16,37`) — no implementation, no call
  site, not referenced by `PcaAppGraph`.
- `DeviceKeyMetadataEntity` (`persistence/entity/DeviceKeyMetadataEntity.kt:7-17`,
  PK `publicKeyId`, no private keys) and its DAO are registered in the
  database (`PcaLocalDatabase.kt:81,:105`) but the DAO has **no caller** in
  `src/main`.
- Public keys + aliases for a pending enrollment live only in the pending
  attempt record (report 03 §5).

## 4. Implications

1. **Device proof-of-possession does not exist on Android in production.**
   The runtime-sync `challenge`/`session` flow requires a DSK signature over
   the server nonce (`DeviceSessionManager.kt:22-40`) — itself gated on the
   same crypto approval; until then no Bearer device session can be minted.
2. When the external crypto review clears, remaining wiring work is
   non-trivial and should be tracked as an implementation slice:
   (a) instantiate a real `SecureKeyStore` in `PcaAppGraph`; (b) implement the
   challenge client; (c) produce `signingPublicKey`/`encryptionPublicKey` at
   bootstrap; (d) wire `DeviceKeyMetadataDao`; (e) compose the sync
   orchestrator (report 05 §3).
3. Nothing observed here fabricates identity, downgrades crypto, or stores
   private keys in plaintext — the inertness is fail-closed, not unsafe.
