# PCA Device Policy Application Proof V1 — Wave 02A-R1 Contract

DATE = 2026-10-16
BASE_SHA = `535bdfe43062fb2bd5408f5f1e7c519faabeb30d`
BASE_CI = `38662794818` — SUCCESS, 27/27
STATUS = `CONTRACT CLOSED; 5/5 APPROVED; WAVE 02B MIGRATION AUTHORIZATION PENDING`
SCOPE = Contract and source qualification only. No production implementation, migration, database mutation, Azure action, Platform activation, or Wave 02B work.

## 1. Decision and boundary

This document records the implementable technical contract and independent specialist reviews. The unqualified byte-identical replay guarantee requires indefinite minimal tombstone retention; the owner accepted that disclosed privacy consequence on 2026-10-16. All five reviewers approved this contract with zero blockers and majors. The contract is ready for Wave 02B, but migration 0066 creation and Wave 02B implementation remain separately owner-gated. This decision document itself authorizes no source implementation or migration.

Use dual receipts:

1. Family `POLICY_RECEIPT` remains Family E2EE, family-facing, and unreadable to PCA service. It may contain detailed family status. PCA must not decrypt, inspect, project, or use its plaintext for lifecycle decisions.
2. `PCA_DEVICE_POLICY_APPLICATION_PROOF_V1` is a separate, minimal service-visible assertion signed by the current device DSK. It contains no policy plaintext. The backend checks it against the current accepted Trust Set and uses only `APPLIED` to qualify for activation.

The proof is a device assertion, not independent evidence of physical-device health or guaranteed future OS behavior. The server still enforces every current-state predicate transactionally.

## 2. Exact application result semantics

`APPLIED` means all of the following succeeded on the device: exact encrypted envelope signature/cryptographic acceptance; family, device, Trust Set epoch and key epoch checks; payload decryption; policy schema and constraint validation; durable policy persistence; and successful installation of required platform enforcement. A future-effective policy may be `APPLIED` only after durable persistence and durable registration with the production scheduler/runtime for the correct effective time. A transient queue, inbox, or in-memory schedule is insufficient.

`DEGRADED` means the envelope and policy were accepted and may be durably persisted, but one or more required enforcement capabilities are unavailable, incomplete, or could not be confirmed. Missing required OS permission/capability is `DEGRADED`, never `APPLIED`. `REJECTED` means cryptographic, scope, epoch, decryption, schema, or constraint validation failed; it is not accepted as applied policy. Neither result activates a device. Download, receipt, ACK, inbox custody, decryption, parse, or transient enqueue alone never qualifies as `APPLIED`.

The client reports only the enum. It does not send a human-readable rejection reason. The service accepts a signed non-`APPLIED` result only as a terminal challenge result and leaves the device PAIRED.

## 3. Envelope bytes and digest

Use the existing backend `canonicalizeEnvelope(envelope)` from `backend/src/familyenvelope/canonicalize.ts`, which produces the fixed-order UTF-8, byte-length-prefixed canonical signed-field transcript used by `FamilyEnvelopeVerifier`. Digest input is exactly the UTF-8 bytes of that returned string. There is no JSON re-encoding, reconstructed policy object, prefix, extra envelope serializer, or appended signature in the digest. The canonical envelope signature is separately verified with the PCA-DEC-020-qualified envelope verifier before accepting a target or proof; the current verifier boundary is fail-closed and production eligibility is not claimed here. The proof digest therefore identifies the exact canonical encrypted signed fields and ciphertext; the message ID and independently verified signature identify the authenticated envelope instance.

`policyEnvelopeSha256 = SHA-256(UTF8(canonicalizeEnvelope(envelope)))`. Internally it is exactly 32 raw bytes. Its wire/display form is canonical unpadded base64url (43 characters); lowercase hexadecimal is used only in documentation. Reject padding, non-base64url characters, non-32-byte decode, or noncanonical re-encoding. Maximum canonical signed-field bytes: 98,304 (96 KiB). The envelope's encrypted payload remains bounded by the current 65,536-byte limit. Bootstrap returns the canonical bytes as unpadded base64url; its bounded response body is 136 KiB to accommodate base64 expansion and envelope signature. Android and iOS must implement the same byte function and pass the vectors below before producing proofs.

This contract intentionally uses the current canonical signed-field representation, not a hash of arbitrary wire JSON. The backend resolves the message ID to the current target, checks `POLICY_UPDATE`, family and recipient scope, verifies the envelope signature and Trust Set authority with the PCA-DEC-020-qualified verifier, recomputes this digest, then compares it with challenge and proof.

## 4. Canonical proof transcript

There is no separate `protocolVersion` field: V1 is fixed by the domain. `deviceKeyId` is not client-selected or repeated in the transcript: the authenticated bootstrap capability identifies the current DSK, and the verifier resolves that ID through the accepted Trust Set. `challengeExpiresAt` remains signed because it is an exact server challenge value.

The exact ordered transcript fields are:

1. ASCII `PCA_DEVICE_POLICY_APPLICATION_PROOF_V1`
2. `familyId`
3. `deviceId`
4. `policyEnvelopeMessageId`
5. `policyEnvelopeSha256` (canonical unpadded base64url ASCII, exactly 43 bytes)
6. `trustSetEpoch`
7. `keyEpoch`
8. `applicationResult`
9. `challengeId`
10. `challengeNonce` (canonical unpadded base64url ASCII, exactly 43 bytes)
11. `challengeExpiresAt`

Each field is encoded as a netstring: ASCII decimal UTF-8 byte length with no leading zeros (except `0`), `:`, then UTF-8 field bytes. Concatenate fields with no delimiter or trailing bytes. Every transcript field is text; digest and nonce are first encoded as canonical unpadded base64url strings (43 ASCII bytes each), so the complete transcript is valid UTF-8 and can use the current backend string-based PCA verifier without byte coercion. Base64url permits only `A-Z a-z 0-9 _ -`, has no padding, and must round-trip canonically to exactly 32 bytes. All text is strict UTF-8; identifiers are canonical lowercase UUID text for family/device/challenge IDs. `policyEnvelopeMessageId` is the existing opaque message ID, 1–128 UTF-16 code units and at most 512 UTF-8 bytes, matching the existing backend length bound; lone surrogates are rejected. Epochs are canonical unsigned decimal: Trust Set epoch 1–2,147,483,647; key epoch 1–2,147,483,647, matching the accepted Trust Set/floor minimum. Result is exactly `APPLIED`, `DEGRADED`, or `REJECTED`. Nonce is exactly 32 bytes. Expiry is UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, exactly 24 ASCII bytes, derived from server time. No field is nullable. Reject duplicate/extra/missing fields, malformed UTF-8, alternate numeric or timestamp spellings, invalid IDs, wrong lengths, and trailing bytes. Maximum transcript size is 2,048 bytes.

Sign the UTF-8 transcript bytes directly using ECDSA P-256 with SHA-256 applied exactly once by the signing/verifying primitive (message-signing mode). Callers pass the transcript string/UTF-8 bytes, never a precomputed digest. This matches the existing backend string verifier, which converts the string to UTF-8 and applies SHA-256 once, and native message-signing APIs. The separately computed SHA-256 of transcript UTF-8 bytes is stored as `canonical_transcript_sha256`; it is not passed to the signer. Signature encoding is exactly 64-byte IEEE-P1363 `r || s`, low-S canonical form, transported as canonical unpadded base64url (86 characters). Reject invalid/out-of-range scalars, high-S, malformed length/encoding, and noncanonical base64url. The verifier resolves the key ID from the authenticated current DSK and current accepted Trust Set; the key ID is stored server-side with the proof record. Because the proof body omits `deviceKeyId`, verify the signature against each current accepted DSK for the signed family/device and require exactly one matching key; zero or multiple matches reject. Store the uniquely resolved key ID in the proof ledger.

## 5. DSK authority and platform order

Only the current authorized device DSK signs the application proof: Android Keystore P-256 DSK or iOS Secure Enclave P-256 DSK, using the existing PCA P-256/SHA-256/low-S P1363 conventions. Parent password/TOTP, browser assurance, App Attest, Android attestation certificate, DEK, and backend keys are not substitutes. A key that is revoked, stale, wrong-family, wrong-device, or not the accepted current DSK fails closed. PCA-DEC-020 production eligibility and physical-device acceptance remain independent gates; this contract does not claim those gates passed.

Android production requirement: wire the policy dispatcher/applier into the production inbound boundary (currently the inbound handler in `runtime/graph/PcaAppGraph.kt` fails closed with “Unverified ciphertext dispatch is unavailable”; `PersistentCiphertextInbox` is custody only). Carry immutable verified envelope/Trust Set context through: verify and scope/epoch checks → decrypt/schema validation → durable policy persistence/readback → enforcement adapter or durable future scheduler → result → proof signing. `VerifiedInboundCommandConsumer` / `InboundCommandApplier.apply` may be reused as seams, not treated as proof or as production wiring. `PolicyReceiptEntity` and `PolicyReceiptRepository` remain local receipt records, not the service proof. Bind the injected signer to the current DSK alias/key ID after identity and Trust Set custody checks; the low-level caller-supplied alias signer alone does not establish authority.

iOS production requirement: the actual policy path must carry immutable verified envelope and epoch provenance, then execute decrypt/verify → decode → `PolicyApplicationGate` → durable persistence → platform enforcement or durable future registration → result → DSK proof. The production integration point is `PCAApplication.applyVerifiedPolicy` in `ios/PCA/Application/PCAApplication.swift` (currently a post-crypto entry with no inbound envelope provenance); call the gate before persistence and preserve evidence through the apply result. Enforcement is `PCADeviceActivityPolicyRuntime.applyVerifiedPolicy` in `ios/PCA/DeviceActivity/PCADeviceActivityPolicyRuntime.swift`. Map runtime `.scheduledOnly` to proof `APPLIED` only when its returned evidence means durable production scheduler registration for the exact effective time has succeeded and the policy is durably persisted; otherwise map it to `DEGRADED`. `PolicyApplicationGate` is currently test-only/unwired, so no iOS `APPLIED` proof may be emitted before this production chain exists and succeeds.

## 6. PAIRED activation bootstrap and challenge

Do not relax ACTIVE-only session, relay, history, or runtime routes. A dedicated bootstrap/activation-target capability may be issued only after verified current-DSK proof-of-possession, and is scoped to one family, one device, one current target generation, one proof challenge, and one envelope fetch. It permits fetching only that device's current pending activation-target encrypted `POLICY_UPDATE` envelope and its proof challenge. The subsequent proof POST is self-authenticating through the signed transcript and is not an ordinary session request. Neither capability grants general session, relay access, history, other-device reads, Parent actions, or ACTIVE capability.

Do not require or mint an ordinary ACTIVE `DeviceSession`. Bootstrap is a separate two-step DSK proof-of-possession exchange. First, a public challenge endpoint accepts claimed family/device identifiers and returns a generic response that does not disclose whether the device, family, state, key, or target exists; apply limits of 5 failed proofs per device per 10 minutes and 30 per source IP per 10 minutes, with the same generic denial shape. It may reuse `DeviceAuthService` challenge signing/consumption primitives, but must not call `completeChallenge` or the ACTIVE-only role/session resolver. After valid DSK proof, a PAIRED-specific read-only resolver must lock/read `family_epoch_floors`, read the accepted Trust Set head and DSK entry, verify device-family binding, exact PAIRED state, nonrevocation, and current DSK authorization. It mints a fresh application challenge (UUID ID, 32 random CSPRNG bytes, expected target message ID/digest, current Trust Set/key epochs, DB UTC now + 60 seconds) and a capability bound to purpose `POLICY_ACTIVATION_BOOTSTRAP`, family, device, current target generation, and that challenge ID. The proof-of-possession response returns the challenge values, including the raw nonce as canonical unpadded base64url, plus the capability as 32 random CSPRNG bytes in canonical unpadded base64url; capability expiry is no later than 60 seconds. The server persists only SHA-256 hashes of nonce and capability plus their expiries on the target row. The client retains the nonce. Fetch atomically consumes the capability and returns only the exact canonical envelope bytes, separately verified envelope signature, and challenge ID/target binding; it does not need to reproduce the nonce. If proof-of-possession or fetch response is lost, or the server restarts before fetch, the device repeats DSK proof-of-possession to obtain a fresh capability and challenge; the service replaces and invalidates the inaccessible old nonce/challenge. Only one unconsumed application challenge is current. Target replacement invalidates both capability and challenge. Challenge expiry and all comparisons use database/server time. If fetch succeeded but local verification/application exceeds the 60-second proof-challenge lifetime, submission of the expired challenge rejects without consumption. The device keeps its durable application record keyed by the exact target message ID and envelope digest and does not repeat a non-idempotent enforcement action. It repeats PAIRED DSK proof-of-possession for a fresh capability/challenge, fetches the same current target, recomputes and compares the digest/epochs, then signs a fresh proof only if persisted application evidence still matches and required enforcement remains installed or durably scheduled. If the target changed, evidence is missing/invalid, or enforcement cannot be confirmed, it performs the normal idempotent apply path or reports DEGRADED/REJECTED; no proof for the old challenge can activate.

The challenge is family/device scoped, single purpose, short lived, single consumption. The proof signs all challenge values present in the transcript. On an unconsumed challenge, invalid proof attempts do not consume it; rate limits apply. A valid `APPLIED`, `DEGRADED`, or `REJECTED` proof consumes it atomically with terminal ledger recording. Define `canonicalRequestBytes = UTF8(transcriptString) || signature64`; the fixed 64-byte signature follows the fixed 11-field, self-delimiting transcript. `exact_request_sha256 = SHA-256(canonicalRequestBytes)`. HTTP/JSON formatting is not part of proof identity. After successful consumption, an exact retry (same canonical request bytes and fingerprint) returns the same stable accepted outcome, including after challenge expiry. A different request for that challenge is a conflicting replay and rejects. This retry promise has no time limit and therefore requires indefinite retention of the minimal consumed-proof tombstone described in sections 7 and 10. A finite retention period changes the protocol guarantee and requires an explicit amendment before implementation.

## 7. Minimum durable backend model — proposed migration 0066

Two additive tables are required. No migration file is created in this wave.

**`device_policy_activation_targets`** — one current row per device, primary key `device_id`; columns: `family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`, `device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`, `target_generation BIGINT UNSIGNED NOT NULL`, `policy_message_id VARCHAR(128) NULL`, `policy_envelope_sha256 BINARY(32) NULL`, `canonical_envelope_bytes MEDIUMBLOB NULL` with `OCTET_LENGTH <= 98304`, `envelope_signature BINARY(64) NULL`, `trust_set_epoch INT UNSIGNED NULL`, `key_epoch INT UNSIGNED NULL`, `semantic_version VARCHAR(32) NULL`, `target_state ENUM('PENDING','ACTIVATED') NOT NULL`, `bootstrap_capability_hash BINARY(32) NULL`, `bootstrap_capability_expires_at DATETIME(3) NULL`, `bootstrap_capability_consumed_at DATETIME(3) NULL`, `challenge_id BINARY(16) NULL`, `challenge_nonce_hash BINARY(32) NULL`, `challenge_issued_at DATETIME(3) NULL`, `challenge_expires_at DATETIME(3) NULL`, `challenge_consumed_at DATETIME(3) NULL`, `created_at DATETIME(3) NOT NULL`, `updated_at DATETIME(3) NOT NULL`, all times UTC. A `PENDING` row requires target identifiers, digest, exact canonical bytes, signature and epochs to be non-NULL; `ACTIVATED` requires ciphertext/signature and live challenge/capability material cleared to NULL. On target replacement, overwrite the old target and invalidate capability/challenge in the same transaction; do not archive old ciphertext. On successful activation, clear canonical ciphertext bytes, envelope signature, nonce hash, challenge and capability fields in the activation transaction. The server verifies persisted canonical bytes equal the shared canonicalizer output and stored digest matches. Only opaque current-target metadata remains.

**`device_policy_application_proofs`** — primary key `challenge_id BINARY(16)`; columns: `family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`, `device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`, `target_generation BIGINT UNSIGNED NOT NULL`, `policy_message_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`, `policy_envelope_sha256 BINARY(32) NOT NULL`, `trust_set_epoch INT UNSIGNED NOT NULL`, `key_epoch INT UNSIGNED NOT NULL`, `application_result ENUM('APPLIED','DEGRADED','REJECTED') NOT NULL`, `device_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL` (matches `device_public_keys.key_id`), `challenge_expires_at DATETIME(3) NOT NULL`, `challenge_consumed_at DATETIME(3) NOT NULL`, `canonical_transcript_sha256 BINARY(32) NOT NULL`, `exact_request_sha256 BINARY(32) NOT NULL` (`SHA-256(UTF8(transcriptString) || signature64)`), `received_at DATETIME(3) NOT NULL`, `committed_at DATETIME(3) NOT NULL`, and `activation_outcome ENUM('ACTIVATED','RECORDED_NOT_ACTIVATED') NOT NULL`. No policy plaintext, challenge nonce, transcript, or raw signature is retained after terminal commit; the digest/outcome is the minimal idempotency/audit tombstone and is retained indefinitely to satisfy exact-retry semantics. Challenge nonce is stored only as SHA-256 on the current target row while live; expiry and consume time are copied into the immutable proof row before current challenge fields are cleared.

Keys and constraints: FK `family_id` to `families(family_id)` and FK `device_id` to `devices(device_id)` on both tables. Store family IDs as `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin` to match `families`; store device IDs as `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin` to match `devices`. The current `devices.family_id` is `VARCHAR(128) utf8mb4_bin`, so MySQL cannot enforce a compatible composite family/device FK without a separate schema change. Do not claim such an FK. Enforce the pair in every transaction by locking the device row and requiring exact canonical family-ID equality before reading/updating target or proof rows; every query is family-and-device scoped. Proof FK `(device_id,target_generation)` to a unique target generation key is not suitable when target rows are overwritten; therefore retain `target_generation` and target identifiers in the proof row as immutable audit data, with separate family/device FKs. `target_generation > 0`, digest lengths fixed, and epoch/result/state/time checks are enforced by MySQL constraints plus repository validation. `challenge_expires_at > challenge_issued_at` when challenge fields are non-NULL. Index target by `(family_id,device_id,target_state)` (device PK remains lookup); proof by `(family_id,device_id,committed_at)` and `(family_id,device_id,policy_message_id,policy_envelope_sha256)`. Unique keys are target PK `device_id`, unique `(family_id,device_id)` on target, proof PK `challenge_id`, and unique `(device_id,target_generation,challenge_id)` (redundant defense in depth). One successful activation per target is enforced by the locked target's `PENDING → ACTIVATED` transition and guarded device status update, not by a nullable unique trick.

Runtime grants: activation runtime may SELECT/INSERT/UPDATE current target rows, but cannot delete; proof runtime may SELECT/INSERT and cannot UPDATE/DELETE, and no retention job may delete consumed-proof tombstones while the unbounded retry promise is in force; device runtime may perform the existing narrowly guarded PAIRED→ACTIVE update; migration runner alone has DDL rights. Grant changes belong in the existing runtime grant plan. No destructive/backfill operation is required. `MIGRATION_0066_REQUIRED=YES`; `DATA_MIGRATION_REQUIRED=NO`; `EXPECTED_DATA_LOSS=0`.

## 8. Atomic transaction and race outcomes

Use a consistent transaction/lock order: the existing `family_epoch_floors` row `FOR UPDATE` (serialization anchor used by Trust Set append/floor writers) → family/device row → DSK membership/key status → target row → challenge/proof row. Read the accepted `family_trust_set_epochs` head and DSK membership after acquiring the floor lock, with locking/current reads; fail closed if the floor/head is absent or inconsistent. Trust Set and revocation writers must serialize on the same floor/device/key rows. Revalidate current state after acquiring locks; do not rely on pre-transaction verification alone.

For `APPLIED`, recheck at commit: device still `status = PAIRED` and `revoked_at IS NULL`; its `family_id` exactly equals the signed family ID; family row exists and `families.deleted_at IS NULL`; Trust Set floor/head exists and is internally valid; proof epochs remain acceptable under the current head/floor; DSK remains the currently authorized, nonrevoked DSK in that accepted Trust Set; target generation/message ID/digest is still current; challenge is current, unconsumed, and unexpired; envelope signature and proof signature are valid; the family/device pair matches; result is exactly APPLIED. In one transaction insert immutable proof/tombstone (this row is the required audit state), copy challenge expiry and consume time into it, consume the still-unconsumed application challenge, require the matching scoped bootstrap capability was already consumed exactly once by envelope fetch, mark target ACTIVATED, clear ciphertext/signature and nonce/capability material, guarded-update device PAIRED→ACTIVE, and commit. Do not consume the fetch capability a second time. No separate audit table or post-commit write is required. Every guarded update must affect exactly one row; any predicate or write failure rolls back all writes and leaves no ACTIVE transition. For valid non-APPLIED result, atomically record proof and consume the challenge, clear the live challenge nonce hash and already-fetch-consumed one-use capability fields, and leave the target PENDING with its encrypted envelope available for a later fresh challenge; do not activate or clear the pending target ciphertext.

| Race/event | Required outcome |
|---|---|
| Two different valid APPLIED proofs race for one target | Target row serializes; first complete transaction may activate. Second observes activated/non-PAIRED state, rejects as stale/already completed, and cannot overwrite proof or create another transition. |
| Exact duplicate after commit | Before PAIRED/expiry predicates, look up the terminal proof by challenge ID and compare family/device scope plus exact-request SHA-256; on equality return the fixed prior accepted response, with no writes or second audit transition. The proof's commit-time validation is the authority for this no-op response. |
| Conflicting duplicate challenge | Different fingerprint for consumed challenge returns conflict/reject; no state change. |
| DSK revoked during verification | If revocation serializes before proof commit, current DSK recheck fails and rolls back; no ACTIVE. If proof commits first, a later revocation is a later state transition and leaves the device REVOKED. |
| Device revoked during verification | If device revocation serializes before proof commit, locked status/revoked_at recheck fails; no ACTIVE. If proof commits first, later revocation leaves device REVOKED. |
| Trust Set head/floor changes | Lock/read the current head after the floor serialization lock. Continue only if the signed proof epochs and DSK remain accepted under that current head and floor; otherwise reject and leave PAIRED. |
| Target replaced | New generation invalidates old challenge/capability; proof for old generation rejects; no ACTIVE. |
| Challenge expires | Unconsumed request rejects using DB time; no consume, no ACTIVE. Exact already-consumed retry follows duplicate rule. |
| Server commits, response is lost | Client retries the identical canonical request bytes (`transcriptBytes || signature64`); tombstone returns the original stable outcome without another activation. |
| Process restarts | Durable target/challenge/terminal proof state decides outcome; no in-memory authority is needed. |
| Stale proof arrives after ACTIVE | Exact prior accepted proof is idempotent; any different proof is rejected as stale/already active; no new transition. |

## 9. Privacy field review

| Field | Why service needs it | Privacy cost | Can remove? | Decision |
|---|---|---|---|---|
| domain V1 | Prevent cross-protocol signature reuse | Reveals protocol purpose | No | Fixed in transcript |
| familyId | Bind authority and prevent cross-family replay | Links activity to family | No | Required, UUID only |
| deviceId | Bind target and lifecycle transition | Links activity to device | No | Required, UUID only |
| policyEnvelopeMessageId | Resolve exact current target | Correlates opaque delivery | No | Required |
| envelope SHA-256 | Bind proof to exact encrypted signed fields | Stable correlation fingerprint; no plaintext recovery | No | Required, raw 32 bytes |
| Trust Set epoch | Reject stale/revoked authority | Reveals key-state version | No | Required |
| key epoch | Reject stale policy key scope | Reveals key-state version | No | Required |
| applicationResult | Activation predicate and failure state | Reveals coarse outcome | No | Required enum only |
| challengeId | Single-use/idempotency lookup | Correlation handle | No | Required, random UUID |
| challenge nonce | Prevent forgery/replay; signed challenge binding | Random one-time value | No | Required in transcript, hash at rest |
| challenge expiry | Bind short-lived challenge and limit replay window | Reveals approximate timing | No | Required in transcript/server row |
| deviceKeyId | Server resolves authenticated DSK | Reveals key identifier | Yes in signed body | Server derives from current accepted Trust Set and stores only in ledger |
| protocolVersion | Select protocol | Duplicates V1 domain | Yes | Omitted; domain is versioned |
| DSK signature | Verify device authority | Links proof to device key | No | Required on submission; cleared after durable terminal fingerprint if policy accepts |
| receive/commit timestamps | Server audit and challenge ordering | Reveals event timing | No | Server-generated, minimum precision DATETIME(3) |
| minimal consumed-proof tombstone and retention | Preserve exact-retry idempotency and distinguish conflicting replay | Indefinite device/policy correlation through opaque IDs, digest, enum outcome, and time | Not while the unbounded retry promise stands | Retain only the proof-ledger fields listed in section 7 indefinitely; no plaintext, nonce, transcript, or raw signature |

`SERVICE_CANNOT_READ_POLICY=YES`. `SERVICE_CANNOT_READ_FAMILY_RECEIPT=YES`. No plaintext, rule details, Safe Zone coordinates, activity, URLs/domains, deletion reason, family message contents, or human-readable rejection reason are stored in this proof path.

## 10. Retention consequence and owner privacy acceptance

The owner's unqualified requirement that a byte-identical replay after successful consumption return the same accepted outcome, including response-lost retry after challenge expiry, has no retry horizon. The only compatible durable contract is to retain the minimal consumed-proof tombstone indefinitely. A finite TTL followed by an expired/unknown response would weaken that requirement; it is not an equivalent implementation option. If a finite horizon is desired, the owner must first amend the protocol requirement and define post-horizon behavior, then obtain fresh review.

Indefinite retention is limited to the proof-ledger row needed for idempotency and lifecycle audit: challenge ID, family/device scope, target identifiers/digest/epochs, coarse result/outcome, resolved DSK key ID, transcript/request digests, and server timestamps. Raw nonce, signature, transcript, encrypted envelope, and policy plaintext are not retained in that ledger after terminal commit. **OWNER PRIVACY ACCEPTANCE = ACCEPTED (2026-10-16):** the owner accepted the stated indefinite retention and correlation cost. This does not authorize migration 0066 or Wave 02B implementation.

## 11. Golden vectors

Vectors below use synthetic ciphertext and a synthetic test DSK only. No production or user key is represented. Canonical envelope fields are: protocol major/minor `1`,`0`; message ID `11111111-1111-4111-8111-111111111111`; family `22222222-2222-4222-8222-222222222222`; sender device `33333333-3333-4333-8333-333333333333`; DEVICE recipient `44444444-4444-4444-8444-444444444444`; sender key ID `55555555-5555-4555-8555-555555555555`; message type `POLICY_UPDATE`; sequence `1`; issued `2026-10-15T00:55:00.000Z`; expires `2026-10-15T01:55:00.000Z`; Trust Set epoch `7`; key epoch `9`; semantic version `1.2.3`; correlation absent; ciphertext bytes `00112233445566778899aabbccddeeff` (canonical payload field is standard padded base64 `ABEiM0RVZneImaq7zN3u/w==`).

Canonical envelope bytes, base64url: `MToxMTowMzY6MTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExMzY6MjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyMzY6MzMzMzMzMzMtMzMzMy00MzMzLTgzMzMtMzMzMzMzMzMzMzMzNjpERVZJQ0UzNjo0NDQ0NDQ0NC00NDQ0LTQ0NDQtODQ0NC00NDQ0NDQ0NDQ0NDQzNjo1NTU1NTU1NS01NTU1LTQ1NTUtODU1NS01NTU1NTU1NTU1NTUxMzpQT0xJQ1lfVVBEQVRFMToxMjQ6MjAyNi0xMC0xNVQwMDo1NTowMC4wMDBaMjQ6MjAyNi0xMC0xNVQwMTo1NTowMC4wMDBaMTo3MTo5NToxLjIuMzE6MDA6MjQ6QUJFaU0wUlZabmVJbWFxN3pOM3Uvdz09`

Envelope SHA-256 hex: `329e9df118ec724611c9d7cef8c1d976e99adafcb2ad38ec005d180251dc0ee7`; base64url: `Mp6d8RjsckYRydfO-MHZduma2vyyrTjsAF0YAlHcDuc`. Challenge ID `66666666-6666-4666-8666-666666666666`; nonce base64url `oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8`; expiry `2026-10-15T00:56:00.000Z`. Synthetic DSK SEC1 public key base64url: `BEo3oAxgCztM8rd02sbHbuD_vdgAnjsGov_ou4xgVbZhoxiVVghyV_ugsENG3RI_K85pHV-wLnNB2FETA83c_lM`.

The valid transcript below is exact UTF-8 netstring bytes, base64url encoded. Mutation vectors are defined by changing exactly the named field of this valid transcript, then re-encoding all netstrings; their signatures are valid under the synthetic DSK public key. They are therefore useful for separate crypto and authorization checks.

| Vector | Transcript mutation | Signature base64url | Expected |
|---|---|---|---|
| Valid APPLIED | None; transcript UTF-8 bytes base64url: `Mzg6UENBX0RFVklDRV9QT0xJQ1lfQVBQTElDQVRJT05fUFJPT0ZfVjEzNjoyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIzNjo0NDQ0NDQ0NC00NDQ0LTQ0NDQtODQ0NC00NDQ0NDQ0NDQ0NDQzNjoxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTE0MzpNcDZkOFJqc2NrWVJ5ZGZPLU1IWmR1bWEydnl5clRqc0FGMFlBbEhjRHVjMTo3MTo5NzpBUFBMSUVEMzY6NjY2NjY2NjYtNjY2Ni00NjY2LTg2NjYtNjY2NjY2NjY2NjY2NDM6b0tHaW82U2xwcWVvcWFxcnJLMnVyN0N4c3JPMHRiYTN1TG02dTd5OXZyODI0OjIwMjYtMTAtMTVUMDA6NTY6MDAuMDAwWg` | `qOnaqSm9irglYluuawYON6vfK8kTt75IaYXslvmTXHsIitr620VP4ZsvKSlZBHwRtWKuGP7HW3wDhT2O7ShJiw` | Accept; one transaction may activate |
| Changed envelope digest | decode `policyEnvelopeSha256`, XOR raw digest byte 0 with `01`, then canonical-base64url encode | `ayzIHEtWcR8DHkSjDiVW2m34grzVSjpyf6OxsIJyzNcIxu0O18bTKHvSqrHr7vIb9pGSqTeQY40ybTsy1zfwbg` | Signature valid; reject target-digest mismatch |
| Wrong family | Set `familyId=77777777-7777-4777-8777-777777777777` | `Ul1Q9Fir_OeKzz7QdsaRyOun_CPL5GTXEo-ol4z3BpQaSr3rLy7hAB3OMNHvvJSWIZAnI5_HS9LI2bUdDHgZYQ` | Reject scope mismatch |
| Wrong device | Set `deviceId=88888888-8888-4888-8888-888888888888` | `SzzDfVRmah2fqk8wfkNLkgAkNUlGJh4NCOuE6tSOigsPfDOrq4wauUE0vKMjRMilNUNE09wujSA6DeogomAYpg` | Reject scope mismatch |
| Stale Trust Set epoch | Set `trustSetEpoch=6` | `ALqti29osmyfyDx83hgjB32NHo5PbnPidRAacEkF4uodiePmD8fhl0jq1wealk0PAADiGUxndBT_ChcWdOIPzQ` | Reject stale epoch |
| Conflicting replay | Keep the same challenge; set `applicationResult=DEGRADED` | `eAifNb6hl_Vnqcfm_tvmGwy_EMYpqoHy3jG-V91YlYQ5ZhXhomJ6Ep89HgvYZGWO5kMYhhwi969iY5WO6xKatA` | Valid signature, but reject after same challenge was consumed by the different valid request |

## 12. Migration qualification and exit status

`MIGRATION_0066_REQUIRED=YES`; proposed design is additive and data-loss-free, but not owner-authorized and not created. No live or disposable database was touched. No implementation tests were run; vector bytes and signatures were generated as synthetic fixtures, not cross-platform execution evidence.

| Requirement | Frozen candidate |
|---|---|
| Transcript / envelope digest / DSK suite | Defined in sections 3–5 |
| APPLIED semantics | Defined in section 2, including durable future scheduling |
| PAIRED bootstrap / challenge | Defined in section 6 |
| Durable state / transaction / races | Defined in sections 7–8 |
| Privacy | Service cannot read policy or family receipt; indefinite minimal tombstone retention accepted by owner 2026-10-16 |
| iOS / Android production integration | Exact current insertion seams and Wave 02B acceptance order defined in section 5 |
| Cross-platform vector execution | Static vector fixtures supplied; backend/Android/iOS consumption still required in Wave 02B |
| Final five-lane approval | Pending final independent review of this revision |
| Owner authorization for migration 0066 | Required later; not granted here |

Current known source state: family receipt remains opaque; backend `canonicalizeEnvelope` is the sole present canonical signed-field encoder; Android and iOS do not yet implement/wire this production proof path; iOS `PolicyApplicationGate` is not wired in production; PAIRED cannot use normal ACTIVE-only relay/session receive paths. These are implementation gates for Wave 02B, not permission to weaken the fail-closed state.

## 13. Final five-lane review record

Reviewers must independently read this exact document revision and fill every category below. The retention wording changed from an owner-selected duration to the indefinite minimum required by the unqualified retry guarantee; earlier conditional or HOLD votes do not count as approval of this revision.

| Agent | Transcript | APPLIED semantics | DSK | Bootstrap | Challenge | Privacy | Schema | Transaction | Platform integration | Blockers | Majors | Minors | Decision |
|---|---|---|---|---|---|---|---|---|---|---:|---:|---:|---|
| Agent 0 — coordinator/security | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE; owner accepted indefinite retention | APPROVE proposed; retention fixed | APPROVE | APPROVE contract; implementation outstanding | 0 | 0 | 0 | APPROVE |
| Agent 1 — Android | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE; owner accepted indefinite retention | APPROVE proposed; retention fixed | APPROVE | APPROVE contract; implementation outstanding | 0 | 0 | 0 | APPROVE |
| Agent 2 — iOS | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE; owner accepted indefinite retention | APPROVE proposed; retention fixed | APPROVE | APPROVE contract; implementation outstanding | 0 | 0 | 0 | APPROVE |
| Agent 3 — backend | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE; owner accepted indefinite retention | APPROVE proposed; retention fixed | APPROVE | APPROVE contract; implementation outstanding | 0 | 0 | 0 | APPROVE |
| Agent 4 — cross-platform/privacy | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE; owner accepted indefinite retention | APPROVE proposed; retention fixed | APPROVE | Specified; implementation outstanding | 0 | 0 | 0 | APPROVE |

The owner privacy acceptance is recorded in section 10. All five reviewers independently approved this exact contract revision. Implementation and migration authorization remain separate gates.

`BLOCKERS = 0`
`MAJORS = 0`
`UNANIMOUS_APPROVAL = YES`
`READY_FOR_WAVE_02B = YES, contract ready; migration and implementation still require separate owner authorization`

## 14. Wave 02A-R1 contract closure

BASE_SHA = `535bdfe43062fb2bd5408f5f1e7c519faabeb30d`
PROOF_TRANSCRIPT_FROZEN = YES
APPLIED_SEMANTICS_FROZEN = YES
ENVELOPE_DIGEST_FROZEN = YES
DSK_SIGNATURE_FROZEN = YES, production eligibility remains separately gated
PAIRED_BOOTSTRAP_PATH_FROZEN = YES
SERVER_CHALLENGE_FROZEN = YES
IOS_PRODUCTION_INTEGRATION_FROZEN = YES, implementation outstanding
ANDROID_PRODUCTION_INTEGRATION_FROZEN = YES, implementation outstanding
PRIVACY_ACCEPTED = YES, owner accepted indefinite minimal tombstone retention on 2026-10-16
SCHEMA_FROZEN = YES, additive proposal only; creation remains owner-gated
MIGRATION_0066_REQUIRED = YES
TRANSACTION_CONTRACT_FROZEN = YES
GOLDEN_VECTORS = PASS as static fixtures; cross-platform execution pending
AGENT_0 = APPROVE (0 blockers, 0 majors, 0 minors)
AGENT_1 = APPROVE (0 blockers, 0 majors, 0 minors)
AGENT_2 = APPROVE (0 blockers, 0 majors, 0 minors)
AGENT_3 = APPROVE (0 blockers, 0 majors, 0 minors)
AGENT_4 = APPROVE (0 blockers, 0 majors, 0 minors)
BLOCKERS = 0
MAJORS = 0
MINORS = 0
UNANIMOUS_APPROVAL = YES
OWNER_AUTHORIZATION_REQUIRED_FOR_0066 = YES
READY_FOR_WAVE_02B = YES, contract ready; migration and implementation still require separate owner authorization

Stop after contract resolution. Do not implement Wave 02B or start Wave 03.

## Owner amendment and Wave 02B implementation checkpoint — 2026-10-16

The owner subsequently amended the retention contract and authorized Wave 02B. This amendment supersedes the indefinite-retention statements above wherever they conflict:

- Proof replay/conflict tombstones are retained for **14 days**. An exact byte-identical retry is idempotent only within that window; conflicting retries reject. After expiry, an old proof is not reusable. The durable lifecycle/audit fact remains separate from the pruned tombstone.
- Migration 0066 and implementation are owner-authorized only for repository code, task-owned disposable MySQL, and local development MySQL. Retained UAT remains conditional on preflight and zero-loss verification. Live `pca_pro`, Azure, and production remain prohibited and were not touched.
- The production envelope crypto suite is explicitly **not approved**. `NotReadyDecryptor` and `NOT_READY_CRYPTO_REVIEW` remain fail-closed. No mobile `APPLIED` proof or server `ACTIVE` transition may be produced until the approved production verify/decrypt and enforcement chain succeeds. Do not introduce substitute crypto in this wave.

Wave 02B source work is present in the shared checkout, but this is **not a completion certificate**. The migration, backend ledger/routes, shared vector, and mobile proof plumbing have been drafted. Backend TypeScript build and focused protocol/route tests passed. The disposable MySQL endpoint refused connection before database creation (`ECONNREFUSED 127.0.0.1:33061`), so migration, grants, transaction, rollback, and race tests remain unverified; no retained or live database was touched. Android focused Gradle compilation remains unresolved; iOS XCTest could not run in this Windows environment. Repository-wide backend tests could not spawn child test workers (`spawn EPERM`), and the direct runtime grant test reports the expected canonical schema snapshot gap for the not-yet-applied migration. No commit, push, exact-head CI, or remote equality is claimed.

`WAVE_02B_COMPLETE = NO`
`PRODUCTION_RECEIVER_CRYPTO = NOT_APPROVED; FAIL_CLOSED`
`NEXT_DEPENDENCY = Separate bounded crypto-security wave to qualify/implement the production envelope suite`
`WAVE_03 = NOT STARTED`














## Wave 02B validation update — 2026-10-16

The owner authorized repository migration 0066, task-owned disposable MySQL, and local development DB within the stated boundaries. Migration 0066 is additive and contains no seed/backfill; the owned disposable MySQL 8.4.11 runner applied all 64 migrations and passed 7/7 proof transaction/race tests, then dropped its random schema. Canonical schema/bootstrap artifacts report 98 tables. No retained local/UAT, live pca_pro, Azure, or production database was touched.

Backend implementation includes the activation target, PAIRED DSK bootstrap challenge/capability, proof ledger, canonical transcript/digest, signature verification, 14-day tombstone/pruning, exact retry/conflict logic, and atomic PAIRED-to-ACTIVE transaction. main.ts composes receiverCryptoReady=false as a literal; production has no setting/request override. Backend build passed; full backend suite passed 3517/3517; focused proof/schema/grant checks 68/68; runtime-grant policy 20/20; bootstrap artifact drift check passed. Final independent review: BLOCKERS=1, MAJORS=0, MINORS=0.

The remaining blocker is the intentionally unapproved production E2EE receiver suite. Android production has no accepted paired-device DSK custody binding or sender-signature verifier; it retains an unavailable signer and does not wire activation to the graph. iOS production keeps policyEnvelopeProcessor=nil; its application gate returns DEGRADED before persistence, enforcement, or proof. Therefore no mobile APPLIED proof or backend ACTIVE transition is possible. Do not use substitute crypto or enable the readiness gate.

Android current-source Gradle validation is outstanding due critically low workspace disk; iOS XCTest and physical-device evidence are unavailable on this Windows host. Shared vectors pass backend consumption, but Android/iOS execution is not claimed. Source remains uncommitted at base SHA 535bdfe43062fb2bd5408f5f1e7c519faabeb30d; exact-head 27/27 CI and LOCAL=ORIGIN=SERVER are not established. Schedule Policy and Safe Zone production receiving behavior are not claimed; FamilyAudit and Web Rules remain separate work. WAVE_02B_COMPLETE=NO. WAVE_03=NOT_STARTED. Recommend bounded Wave 02C for production envelope crypto qualification and integration.

## Final Wave 02B checkpoint — 2026-10-16 (supersedes earlier publication/DB notes)

FINAL_SHA = 0140b133aa5c47ed1cf044e015fafab76a1c0ad4. Push to `origin/pca-dev` was accepted; local and cached origin report 0 ahead / 0 behind. A follow-up `git ls-remote` and GitHub Actions query could not connect through the workstation proxy, so fresh server-head confirmation and exact-head 27/27 CI remain unverified.

Migration 0066 passed disposable MySQL 8.4.11 replay (all 64 migrations) and 7/7 proof DB tests; the random schema was removed. Backend build, full suite (3517/3517), focused suite (68/68), runtime grant policy (20/20), and 98-table bootstrap drift check passed. No retained local/UAT, live pca_pro, Azure, or production DB was touched. Backend production composition hardwires receiver crypto readiness to false.

Android and iOS remain fail-closed at the unavailable approved production receiver crypto gate. No APPLIED proof or ACTIVE transition is possible. Android current-source build, iOS XCTest, physical-device evidence, and cross-platform mobile vector execution remain outstanding. Independent final review: 1 blocker (approved production envelope verification/decryption/enforcement path), 0 majors, 0 minors. Wave 02B is incomplete; Wave 03 is not started. Recommend a separate bounded Wave 02C for production E2EE receiver crypto qualification.

### Exact-head CI follow-up — 2026-10-16

Quality Gates run 38850083156 completed FAILURE on 0140b133 (24/27 jobs passed). Failures: Repository quality rejected the newly added `shared/` vector directory; Android had two ineffective negative-test fixtures; full MySQL schema privacy rejected the exact owner-approved opaque lifecycle metadata and DSK key ID names. Focused local corrections now allow `shared/`, narrowly document those exact privacy exceptions, and make the UUID/high-S tests exercise invalid values. Repository checks pass locally. These corrections are not staged or published because D: has 208 KB free and Git cannot write `.git/index.lock`; no rerun is claimed.

## Final Wave 02B source validation — 2026-10-16

SOURCE_HEAD = `9a6111c5c9dc8a1f7ca31eb1c043d64e95c75164`
EXACT_HEAD_CI = `38851950745`, SUCCESS, 27/27. Android, iOS, backend build/unit, full disposable MySQL certification, real-backend E2E, browser suites, security, repository quality, contracts, and release-control jobs all succeeded. This run supersedes failed predecessor runs `38850083156` and `38850915464`; the latter test-fixture and privacy-allowlist corrections are committed.
GIT = Fresh direct lookup at this source checkpoint confirmed LOCAL = ORIGIN = SERVER and ahead/behind = 0/0. The following documentation-only synchronization changes the head and requires its own exact-head CI.
WAVE_STATUS = Wave 02B remains incomplete because the approved production E2EE envelope verification/decryption/enforcement suite is unavailable. `APPLIED` and server `ACTIVE` remain fail-closed. No live, Azure, production, or retained UAT database was touched. No physical-device evidence or local Windows Android test pass is claimed. Wave 03 has not started. Parent TODO-12/14/15 and external owner/deployment acceptance gates remain open; Platform remains `HOLD_PARENT_DEPENDENCY`.

## Owner supersession — Wave 02B authorization, 2026-10-16

The Wave 02B owner authorization supersedes the earlier 02A-R1 acceptance of indefinite proof-tombstone retention. The implementation retention contract is exactly 14 days; exact byte-identical retry is idempotent only during that window, and expired proofs cannot be reused. Other frozen proof-contract terms remain in force. Production E2EE receiver crypto is still explicitly unapproved, so APPLIED and ACTIVE stay fail-closed.
