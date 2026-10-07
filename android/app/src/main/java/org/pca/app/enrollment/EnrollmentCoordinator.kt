package org.pca.app.enrollment

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.pca.app.firstdevice.FirstDeviceCeremonySeed
import org.pca.app.firstdevice.FirstDeviceRootReadResult
import org.pca.app.firstdevice.FirstDeviceRootRecord
import org.pca.app.firstdevice.FirstDeviceRootState
import org.pca.app.firstdevice.FirstDeviceRootStore
import org.pca.app.security.CryptoSuiteNotApprovedException
import org.pca.app.security.DeviceKeyPairDeletion
import org.pca.app.security.DeviceKeyPairGenerator
import org.pca.app.security.GeneratedKeyPair
import org.pca.app.security.SecureKeyUnavailableException
import org.pca.app.storage.CorruptLocalFamilyStateException
import org.pca.app.storage.FamilyStateStore
import org.pca.app.storage.LocalFamilyState
import org.pca.app.storage.PendingEnrollmentAttempt
import org.pca.app.storage.PendingEnrollmentAttemptStatus
import org.pca.app.storage.PendingEnrollmentAttemptStore

/**
 * Drives the child-device enrollment flow end to end: parses an invitation deep link (via the
 * pre-existing [EnrollmentLinkParser], reused as-is), prepares this device's key pairs (gated by
 * [DeviceKeyPairGenerator]'s crypto-suite approval), calls [DeviceBootstrapApiClient], and
 * persists the server-issued identity via [FamilyStateStore]. Never sends or infers familyId,
 * role, or any authority claim -- the request body this coordinator builds mirrors
 * bootstrapRoutes.ts's verified shape exactly (rawInvitationToken/platform/signingPublicKey/
 * encryptionPublicKey/bootstrapAttemptId/attemptRecoveryToken only).
 *
 * The raw invitation token is held ONLY in [rawInvitationToken], an in-memory field, for the
 * duration of one active attempt. It is never written to [FamilyStateStore],
 * [PendingEnrollmentAttemptStore], or any other persistent store, never logged, and is cleared on
 * success and on every DEFINITIVE (non-ambiguous) failure. It is deliberately NOT cleared on
 * [EnrollmentState.BootstrapResultUnknown] -- see that state's own doc; this does not mean the
 * coordinator will reuse it automatically (it never does), only that [retryBootstrap] has the
 * option without asking the user to re-scan/re-paste, as long as this process has not restarted.
 *
 * PCA-ENROLLMENT-RUNTIME-2 (BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP closure): before ANY network
 * call, [beginBootstrap] durably persists a narrow [PendingEnrollmentAttempt] via
 * [pendingAttemptStore] -- attemptId, attemptRecoveryToken, server base URL, DSK/DEK public keys
 * + [org.pca.app.security.SecureKeyStore] aliases, and lifecycle status. This survives process
 * death, app restart, and device reboot. [restoreInitialState] checks it on construction:
 * - No local family state AND a pending attempt exists -> [EnrollmentState.RecoveryPending]:
 *   the raw token is gone, but [recoverAttempt] can still resolve the outcome using only the
 *   durably-held attemptId + attemptRecoveryToken.
 * - Local family state already exists -> that remains authoritative (unchanged behavior); a
 *   pending-attempt record left over from that same successful attempt is simply stale (already
 *   cleared by [persistSuccess]'s caller in the ordinary case).
 *
 * Bootstrap authority remains ONLY "possession of the valid one-time invitation token" --
 * attemptId and attemptRecoveryToken are never authority to redeem anything; they only let a
 * retry of the SAME already-authorized attempt be recognized as such (server-side) and let this
 * client recover its own prior outcome (nothing else's) without the raw token.
 */
class EnrollmentCoordinator(
    private val linkParser: EnrollmentLinkParser,
    private val apiClient: DeviceBootstrapApiClient,
    private val keyPairGenerator: DeviceKeyPairGenerator,
    private val familyStateStore: FamilyStateStore,
    private val pendingAttemptStore: PendingEnrollmentAttemptStore,
    private val platform: String = "ANDROID",
    /**
     * PCA-FR-140 Android parity: where every [PairingState] transition this
     * coordinator commits (see [persistSuccess]) is recorded before the
     * commit -- actor/from/to/reason/timestamp, mirroring iOS's
     * `EnrollmentLifecycleMachine`. Defaults to a private in-memory sink so
     * every coordinator instance is self-auditing even if the composition
     * root has not yet been updated to inject a durable one.
     */
    private val lifecycleAuditSink: EnrollmentLifecycleAuditSink = InMemoryEnrollmentLifecycleAuditSink(),
    /**
     * WAVE 6C: durable sink for the first-device trust-root ceremony seed.
     * Injected by production composition (PcaAppGraph); nullable only so
     * enrollment-focused tests can omit it. A null sink means the ceremony
     * cannot run later (its attempt credential was never captured) -- it is
     * a fail-closed omission, never a security downgrade: the ceremony has
     * no path that fabricates credentials.
     */
    private val firstDeviceRootStore: FirstDeviceRootStore? = null,
) {
    private val _state = MutableStateFlow(restoreInitialState())
    val state: StateFlow<EnrollmentState> = _state.asStateFlow()

    /**
     * PCA-FR-140/141: this device's own DSK/DEK fingerprints, computed locally
     * ([computeKeyFingerprint]) immediately after [beginBootstrap] generates the key pairs --
     * before either public key is ever sent over the network. A separate StateFlow from
     * [state] on purpose: it is a SAS-style display concern orthogonal to the enrollment
     * lifecycle itself (it stays populated through PairingPending, where the parent-visible
     * fingerprint-comparison UI matters most, and is cleared back to null on
     * [submitInvitationLink] for a fresh attempt/device).
     */
    private val _keyFingerprints = MutableStateFlow<DeviceKeyFingerprints?>(null)
    val keyFingerprints: StateFlow<DeviceKeyFingerprints?> = _keyFingerprints.asStateFlow()

    private var rawInvitationToken: String? = null
    private data class ProfileConfirmation(val result: DeviceBootstrapResult, val attempt: PendingEnrollmentAttempt)
    private var pendingProfileConfirmation: ProfileConfirmation? = null
    private val operationMutex = Mutex()

    /** Concurrent callers are rejected rather than queued against a later attempt. */
    private suspend fun runOperation(action: suspend () -> Unit) {
        if (!operationMutex.tryLock()) return
        try { currentCoroutineContext().ensureActive(); action() } catch (cancelled: CancellationException) {
            pendingProfileConfirmation = null
            pendingAttemptStore.current()?.let { _state.value = EnrollmentState.RecoveryPending(it.serverBaseUrl) }
            throw cancelled
        } finally { operationMutex.unlock() }
    }

    private fun matchesAttempt(attempt: PendingEnrollmentAttempt): Boolean {
        if (pendingAttemptStore.current() == attempt) return true
        _keyFingerprints.value = null
        pendingProfileConfirmation = null
        rawInvitationToken = null
        _state.value = restoreInitialState()
        return false
    }

    private fun restoreInitialState(): EnrollmentState {
        val persisted = try {
            familyStateStore.currentState()
        } catch (_: CorruptLocalFamilyStateException) {
            // Do not inspect/recover a pending attempt against an unreadable identity record.
            return EnrollmentState.LocalStateCorrupt
        }
        if (persisted != null) {
            return if (persisted.pairingState == PairingState.REVOKED) {
                EnrollmentState.Revoked
            } else {
                // Deliberately never PAIRED/ACTIVE here regardless of the persisted PairingState --
                // this coordinator's own model only distinguishes "not enrolled," "revoked," and
                // "enrolled" (PairingPending). A future status-refresh feature that reads the real,
                // authenticated pairing status is the only thing allowed to expose PAIRED/ACTIVE.
                EnrollmentState.PairingPending(persisted.deviceId)
            }
        }
        val pending = pendingAttemptStore.current() ?: return EnrollmentState.NotEnrolled
        // A durably-persisted attempt survived a process/app restart (or device reboot) with no
        // confirmed local success yet -- the raw invitation token is gone (never persisted), so
        // only recoverAttempt() (not retryBootstrap()) can resolve this from here.
        return EnrollmentState.RecoveryPending(pending.serverBaseUrl)
    }

    /**
     * Parses [uri] via [linkParser] and, if valid, stores its opaque token in memory and moves to
     * [EnrollmentState.InvitationReady]. Any parse failure (wrong scheme/host, missing token) is
     * reported as [EnrollmentState.FailedInvitationInvalid] -- the same generic outcome as a
     * server-side 404, so this client never becomes a token/link validity oracle either.
     * An active operation, pending confirmation, or durable unresolved attempt preserves its
     * current state and credentials instead of accepting a replacement invitation.
     */
    fun submitInvitationLink(uri: String) {
        if (!operationMutex.tryLock()) return
        try {
            if (blockIfLocalStateCorrupt()) return
            if (pendingProfileConfirmation != null || pendingAttemptStore.current() != null) return
            val parsed = linkParser.parse(uri)
            if (parsed == null) {
                rawInvitationToken = null
                _state.value = EnrollmentState.FailedInvitationInvalid
                return
            }
            rawInvitationToken = parsed.rawInvitationToken
            pendingProfileConfirmation = null
            // A fresh attempt (including the add-another-device path) must never show a stale
            // fingerprint from a PRIOR device's key pair while this one is still being prepared.
            _keyFingerprints.value = null
            _state.value = EnrollmentState.InvitationReady(parsed.serverBaseUrl)
        } finally { operationMutex.unlock() }
    }

    /**
     * Runs key preparation + bootstrap from [EnrollmentState.InvitationReady]. Calls during an
     * active operation or with a durable unresolved attempt preserve the existing state and
     * credentials. Otherwise an invalid caller state reports [EnrollmentState.FailedInvitationInvalid].
     * Generates a NEW attemptId/attemptRecoveryToken and a NEW
     * DSK/DEK key pair -- this is the only place either is minted; every retry
     * ([retryBootstrap], [recoverAttempt]) reuses what this call persists.
     */
    suspend fun beginBootstrap() = runOperation { beginBootstrapLocked() }

    private suspend fun beginBootstrapLocked() {
        if (blockIfLocalStateCorrupt()) return
        if (pendingAttemptStore.current() != null) return
        val token = rawInvitationToken
        val readyState = _state.value as? EnrollmentState.InvitationReady
        if (token == null || readyState == null) {
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        }

        _state.value = EnrollmentState.PreparingKeys
        // Wave 6C: the attempt id is minted BEFORE key generation -- it scopes
        // both key aliases and is baked into the DSK's hardware attestation
        // challenge, so it must exist first (previously it was minted after).
        val attemptId = AttemptIdentifiers.newAttemptId()
        val attemptRecoveryToken = AttemptIdentifiers.newAttemptRecoveryToken()
        // Reclaim key material orphaned by any crashed prior attempt before
        // minting this attempt's keys (create-once namespace). Stage-B fix
        // (Agents 1/5/7): the keep set MUST also include the first-device
        // trust root's attempt -- a committed (or in-flight) root's DSK/DEK
        // are LIVE key material, and sweeping them would irreversibly
        // destroy the device's only family-root signing key. A corrupt or
        // unavailable root read is not proof that the slot is empty; skip
        // the destructive sweep until its owner attempt can be identified.
        val keepAttemptIds = mutableSetOf(attemptId)
        pendingAttemptStore.current()?.let { keepAttemptIds.add(it.attemptId) }
        val rootRead = firstDeviceRootStore?.readState()
        val rootStateReadable = rootRead !is FirstDeviceRootReadResult.Unreadable
        if (rootRead is FirstDeviceRootReadResult.Present) {
            keepAttemptIds.add(rootRead.record.seed.attemptId)
        }
        if (rootStateReadable) {
            (keyPairGenerator as? DeviceKeyPairDeletion)?.deleteOrphanedAttemptKeys(keepAttemptIds)
        }
        val signingKey: GeneratedKeyPair
        val encryptionKey: GeneratedKeyPair
        try {
            signingKey = keyPairGenerator.generateSigningKeyPair(attemptId)
            encryptionKey = keyPairGenerator.generateEncryptionKeyPair(attemptId)
        } catch (e: CryptoSuiteNotApprovedException) {
            // Never proceeds to the network call from here -- no apiClient.bootstrap() call
            // exists on this path, and nothing is persisted to pendingAttemptStore either.
            _state.value = EnrollmentState.CryptoReviewRequired
            return
        } catch (e: SecureKeyUnavailableException) {
            // Wave 6C: the platform could not provide a hardware-backed key.
            // No software-only key may enter the trust-root path; nothing is
            // persisted and no network call happens.
            _state.value = EnrollmentState.SecureKeyUnavailable
            return
        }

        // PCA-FR-140/141: computed from the public keys ALREADY generated above, before either is
        // sent anywhere -- purely a local, deterministic function of key material this device
        // already holds. Never derived from (or dependent on) a network response.
        _keyFingerprints.value = DeviceKeyFingerprints(
            signingKeyFingerprint = computeKeyFingerprint(signingKey.publicKeyBase64),
            encryptionKeyFingerprint = computeKeyFingerprint(encryptionKey.publicKeyBase64),
        )

        val pending = PendingEnrollmentAttempt(
            attemptId = attemptId,
            attemptRecoveryToken = attemptRecoveryToken,
            serverBaseUrl = readyState.serverBaseUrl,
            platform = platform,
            signingPublicKeyBase64 = signingKey.publicKeyBase64,
            signingPrivateKeyAlias = signingKey.privateKeyAlias,
            encryptionPublicKeyBase64 = encryptionKey.publicKeyBase64,
            encryptionPrivateKeyAlias = encryptionKey.privateKeyAlias,
            status = PendingEnrollmentAttemptStatus.BOOTSTRAPPING,
        )
        // Durably persisted BEFORE the network call -- section 4 of the mission brief: this must
        // survive process death/app restart/device reboot/network loss/response loss.
        pendingAttemptStore.save(pending)

        sendBootstrapRequest(token, pending)
    }

    /**
     * Re-sends the SAME already-prepared bootstrap request (same attemptId, same DSK/DEK) after
     * an ambiguous or definitively-retryable outcome, while [rawInvitationToken] is still held in
     * memory (same process, no restart since the original attempt). Relies entirely on the
     * server's idempotent replay of (attemptId, token, DSK, DEK) -- see
     * MySqlEnrollmentCoordinatorRepository -- so this is always safe to call again even if the
     * previous attempt actually succeeded server-side; it never mints new keys.
     *
     * Callable only from [EnrollmentState.BootstrapResultUnknown] or [EnrollmentState.FailedRetryable]
     * with a still-durably-persisted pending attempt; otherwise a no-op reporting
     * [EnrollmentState.FailedInvitationInvalid] (a caller-sequencing bug, not a network outcome).
     */
    suspend fun retryBootstrap() = runOperation { retryBootstrapLocked() }

    private suspend fun retryBootstrapLocked() {
        if (blockIfLocalStateCorrupt()) return
        val token = rawInvitationToken
        val pending = pendingAttemptStore.current()
        val validState = _state.value is EnrollmentState.BootstrapResultUnknown || _state.value is EnrollmentState.FailedRetryable
        if (token == null || pending == null || !validState) {
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        }
        sendBootstrapRequest(token, pending)
    }

    private suspend fun sendBootstrapRequest(token: String, pending: PendingEnrollmentAttempt) {
        _state.value = EnrollmentState.Bootstrapping
        val result = try {
            apiClient.bootstrap(
                rawInvitationToken = token,
                platform = pending.platform,
                signingPublicKeyBase64 = pending.signingPublicKeyBase64,
                encryptionPublicKeyBase64 = pending.encryptionPublicKeyBase64,
                bootstrapAttemptId = pending.attemptId,
                attemptRecoveryToken = pending.attemptRecoveryToken,
            )
        } catch (e: BootstrapError.InvitationUnavailable) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            // Definitive: this invitation (or attempt id) is unusable. Section 12: abandon the
            // pending attempt -- its key material is unused and safe to stop tracking. A fresh
            // invitation from the parent is required.
            rawInvitationToken = null
            abandonPendingAttempt(pending)
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        } catch (e: BootstrapError.InvalidRequest) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            // Our own request shape was malformed (should not happen from a correct client) --
            // retrying with the same malformed shape cannot help.
            rawInvitationToken = null
            abandonPendingAttempt(pending)
            _state.value = EnrollmentState.FailedRetryable
            return
        } catch (e: BootstrapError.UnexpectedServerError) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            // Ordinary transient failure -- token AND pending-attempt state are both preserved so
            // a later retryBootstrap() can safely try again.
            _state.value = EnrollmentState.FailedRetryable
            return
        } catch (e: BootstrapError.AmbiguousOutcome) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            // BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP -- see EnrollmentState.BootstrapResultUnknown.
            // Deliberately does NOT clear rawInvitationToken or pendingAttemptStore, and does NOT
            // retry automatically.
            _state.value = EnrollmentState.BootstrapResultUnknown
            return
        }

        currentCoroutineContext().ensureActive()
        if (!matchesAttempt(pending)) return
        if (result.status != PairingState.PAIRING_PENDING.name) {
            // The server contract permits bootstrap to establish only
            // PAIRING_PENDING. A different status means the response cannot
            // safely be committed; keep the token and durable attempt so an
            // explicit retry/recovery can resolve the server-side outcome.
            _state.value = EnrollmentState.BootstrapResultUnknown
            return
        }

        rawInvitationToken = null
        pendingProfileConfirmation = ProfileConfirmation(result, pending)
        _state.value = EnrollmentState.ProfileConfirmation(
            deviceId = result.deviceId,
            ageUxTier = result.ageUxTier,
            initialPolicyProfile = result.initialPolicyProfile,
        )
    }

    /**
     * Recovers the outcome of a previously-sent bootstrap attempt using ONLY the durably-held
     * attemptId + attemptRecoveryToken -- never the raw invitation token, which this process may
     * no longer hold (restart after an ambiguous response). Callable from
     * [EnrollmentState.RecoveryPending] or [EnrollmentState.BootstrapResultUnknown] with a
     * pending attempt still on record; otherwise a no-op reporting
     * [EnrollmentState.FailedInvitationInvalid].
     *
     * Section 20 (offline handling): a transient failure here ([RecoveryError.AmbiguousOutcome]/
     * [RecoveryError.UnexpectedServerError]) preserves [pendingAttemptStore] and returns to
     * [EnrollmentState.RecoveryPending] honestly -- it never claims success or failure, and never
     * auto-retries in a loop; the caller (UI / connectivity-change handler) decides when to call
     * this again, giving a bounded, explicit resume rather than a retry storm.
     */
    suspend fun recoverAttempt() = runOperation { recoverAttemptLocked() }

    private suspend fun recoverAttemptLocked() {
        if (blockIfLocalStateCorrupt()) return
        val pending = pendingAttemptStore.current()
        val validState = _state.value is EnrollmentState.RecoveryPending || _state.value is EnrollmentState.BootstrapResultUnknown
        if (pending == null || !validState) {
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        }

        val result = try {
            apiClient.recoverAttempt(
                bootstrapAttemptId = pending.attemptId,
                attemptRecoveryToken = pending.attemptRecoveryToken,
            )
        } catch (e: RecoveryError.NotFound) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            // DEFINITIVE: the server actually answered -- no completed attempt exists under this
            // (attemptId, attemptRecoveryToken) pair. Section 12: abandon; this attempt's key
            // material is unused and safe to stop tracking. The one-time invitation token itself
            // is unrecoverable by design (never persisted) -- a fresh invitation is required.
            abandonPendingAttempt(pending)
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        } catch (e: RecoveryError.InvalidRequest) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            // Our own persisted attempt state is malformed (should not normally happen) --
            // retrying the same malformed request cannot help.
            abandonPendingAttempt(pending)
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        } catch (e: RecoveryError.AmbiguousOutcome) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            _state.value = EnrollmentState.RecoveryPending(pending.serverBaseUrl)
            return
        } catch (e: RecoveryError.UnexpectedServerError) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            _state.value = EnrollmentState.RecoveryPending(pending.serverBaseUrl)
            return
        }

        currentCoroutineContext().ensureActive()
        if (!matchesAttempt(pending)) return
        if (result.status != PairingState.PAIRING_PENDING.name) {
            // The recovery endpoint returns the original bootstrap result,
            // whose only valid status is PAIRING_PENDING. Preserve the
            // durable recovery capability if the response violates that
            // contract.
            _state.value = EnrollmentState.RecoveryPending(pending.serverBaseUrl)
            return
        }

        pendingProfileConfirmation = ProfileConfirmation(result, pending)
        _state.value = EnrollmentState.ProfileConfirmation(
            deviceId = result.deviceId,
            ageUxTier = result.ageUxTier,
            initialPolicyProfile = result.initialPolicyProfile,
        )
    }

    /**
     * Wave 6C: abandons the pending attempt AND deletes its key material
     * (delete-before-clear). The keys were never used in any accepted server
     * state -- the whole attempt is definitively dead -- so removing them
     * shrinks the local secret surface without any recovery implication.
     * Never called on a merely-ambiguous outcome; never called after a
     * successful [persistSuccess] (whose keys back the ceremony).
     */
    private fun abandonPendingAttempt(pending: PendingEnrollmentAttempt) {
        if (!matchesAttempt(pending)) return
        val deleter = keyPairGenerator as? DeviceKeyPairDeletion
        deleter?.deleteKeyPair(pending.signingPrivateKeyAlias)
        deleter?.deleteKeyPair(pending.encryptionPrivateKeyAlias)
        pendingAttemptStore.clear()
    }

    /**
     * Commits the server-authorized enrollment result only after the child has seen and confirmed
     * the age/mode context. The child cannot provide a weaker replacement profile because this
     * method accepts no profile input; it confirms the exact values returned by the invitation.
     */
    fun confirmProfile() {
        if (!operationMutex.tryLock()) return
        try {
            if (blockIfLocalStateCorrupt()) return
            val confirmation = pendingProfileConfirmation
            if (confirmation == null || _state.value !is EnrollmentState.ProfileConfirmation) {
                _state.value = EnrollmentState.FailedInvitationInvalid
                return
            }
            val result = confirmation.result
            if (!matchesAttempt(confirmation.attempt)) return
            // PCA-FR-140: fail-closed -- if the lifecycle auditor rejects this transition (see
            // EnrollmentLifecycleAuditor.isAllowed), local state is NEVER committed and this
            // coordinator reports the same generic failure it uses for any other caller-sequencing
            // problem, mirroring iOS's EnrollmentLifecycleMachine (invalid transitions never mutate
            // state or append a record).
            if (!persistSuccess(result, confirmation.attempt)) {
                if (_state.value is EnrollmentState.LocalStateCorrupt) return
                // The server accepted the bootstrap, but a required local seed
                // durability step failed. Preserve an actionable state so the
                // same attempt can be explicitly recovered; do not classify it
                // as an invalid invitation and strand its recovery credentials.
                val pending = pendingAttemptStore.current()
                _state.value = pending?.let { EnrollmentState.RecoveryPending(it.serverBaseUrl) }
                    ?: EnrollmentState.FailedInvitationInvalid
                return
            }
            pendingAttemptStore.clear()
            pendingProfileConfirmation = null
            _state.value = EnrollmentState.PairingPending(result.deviceId)
        } finally { operationMutex.unlock() }
    }

    /**
     * Atomic local-commit boundary: a single [FamilyStateStore.save] call, executed only after
     * the server has confirmed success (201/200, parsed body) and only after
     * [keyPairGenerator]'s calls in [beginBootstrap] have already durably stored this device's
     * key material (both key-pair generation calls, and therefore their
     * [SecureKeyStore][org.pca.app.security.SecureKeyStore] writes, complete before this method
     * is ever reached, whether reached via a fresh bootstrap, a same-process retry, or a
     * post-restart recovery). A persisted [LocalFamilyState] can therefore never reference key
     * material that was not actually stored, nor can key material be stored without this call
     * eventually reflecting the device as enrolled -- there is exactly one write here, not
     * several that could partially apply.
     *
     * PCA-FR-140: before that one write, [lifecycleAuditSink] receives an
     * [EnrollmentLifecycleAuditRecord] (actor/from/to/reason/timestamp) for this device's own
     * [PairingState] transition -- see [EnrollmentLifecycleAuditor]. Returns false (and performs
     * NO save) if the auditor's fail-closed guard rejects the transition.
     */
    private fun persistSuccess(result: DeviceBootstrapResult, pending: PendingEnrollmentAttempt): Boolean {
        if (!matchesAttempt(pending)) return false
        if (result.status != PairingState.PAIRING_PENDING.name) return false
        val serverPairingState = PairingState.PAIRING_PENDING
        val previousPairingState = try {
            familyStateStore.currentState()?.pairingState
        } catch (_: CorruptLocalFamilyStateException) {
            _state.value = EnrollmentState.LocalStateCorrupt
            return false
        }
        // Seed persistence is part of the enrollment commit boundary. Capture
        // it before committing LocalFamilyState or its lifecycle audit so a
        // durable-write failure leaves the persisted attempt available for
        // idempotent recovery rather than reporting a partial enrollment.
        if (!captureFirstDeviceCeremonySeed(result, pending)) return false
        val auditor = EnrollmentLifecycleAuditor(
            // KNOWN_GAP (same one documented on LocalFamilyState.familyId below): the bootstrap
            // response is {deviceId, status} only -- the server deliberately never discloses
            // familyId to the device at this step. Recorded as an honest `null` ("not yet
            // known"), never as "", which EnrollmentLifecycleAuditor's own init block now
            // rejects fail-closed as indistinguishable from a real-but-empty id. A future
            // authenticated identity/"whoami" surface is the correct place to learn a real
            // value and backfill this audit trail / LocalFamilyState -- not this coordinator.
            familyId = null,
            deviceId = result.deviceId,
            auditSink = lifecycleAuditSink,
        )
        try {
            auditor.recordTransition(
                from = previousPairingState,
                to = serverPairingState,
                actorId = "device:${result.deviceId}",
                reason = "server-authorized bootstrap/pairing result committed",
            )
        } catch (e: EnrollmentLifecycleTransitionError) {
            return false
        }
        familyStateStore.save(
            LocalFamilyState(
                // KNOWN_GAP: the bootstrap response is {deviceId, status} only
                // (backend/src/http/dto.ts toBootstrapResultDto) -- the server deliberately never
                // discloses familyId to the device at this step (family membership stays
                // server-side authority per the EnrollmentCoordinator backend contract).
                // LocalFamilyState.familyId (org.pca.app.storage) is a non-nullable String, so this
                // "" is left as an explicit, never-fabricated placeholder -- NOT because "" is
                // treated as valid, but because no genuinely-unknown real family id exists to put
                // here instead, and widening that field to nullable is a storage-layer type change
                // out of this file's scope. The one in-scope, actually-audited record of this same
                // fact is the lifecycleAuditSink entry just above, whose familyId is honestly `null`
                // (EnrollmentLifecycleAuditor rejects "" fail-closed -- see its own doc comment).
                // The one confirmed consumer of this field,
                // org.pca.app.feature.webprotection.identity.RealWebProtectionIdentityContextProvider,
                // already treats a blank familyId as WebProtectionIdentity.TrustedFamilyContextUnavailable
                // rather than as real family authority. A future authenticated identity/"whoami"
                // surface is the correct place to obtain and backfill a real value here.
                familyId = "",
                deviceId = result.deviceId,
                pairingState = serverPairingState,
                trustSetEpoch = 0,
                keyEpoch = 0,
                childProfileId = result.childProfileId,
                ageUxTier = result.ageUxTier,
                initialPolicyProfile = result.initialPolicyProfile,
            ),
        )
        // confirmProfile clears the durable pending attempt only after this
        // local commit succeeds; the seed was already captured above.
        return true
    }

    /** Keep all public enrollment actions blocked if persisted identity data becomes unreadable. */
    private fun blockIfLocalStateCorrupt(): Boolean = try {
        familyStateStore.currentState()
        false
    } catch (_: CorruptLocalFamilyStateException) {
        rawInvitationToken = null
        pendingProfileConfirmation = null
        _state.value = EnrollmentState.LocalStateCorrupt
        true
    }

    /**
     * WAVE 6C: writes the durable ceremony seed from the durable pending
     * attempt + the server-issued bootstrap result. No-op when the sink was
     * not wired (fail-closed: the ceremony then simply cannot run) or when
     * a durable root record already exists in any non-terminal state
     * (AWAITING_APPROVAL/APPROVED/SUBMITTING/UNKNOWN: the ORIGINAL
     * ceremony's recovery material must survive a re-enrollment; ROOT_COMMITTED:
     * a re-enrollment must never erase the record of an accepted root).
     * Only a definitively terminal-dead record (EXPIRED/REJECTED) may be
     * replaced by a new enrollment's seed (Stage-B fix, Agent 5 MINOR-2).
     */
    private fun captureFirstDeviceCeremonySeed(result: DeviceBootstrapResult, pending: PendingEnrollmentAttempt): Boolean {
        if (!matchesAttempt(pending)) return false
        val rootStore = firstDeviceRootStore ?: return true
        if (result.signingKeyId.isBlank() || result.encryptionKeyId.isBlank()) return false
        return rootStore.captureSeed(
            FirstDeviceRootRecord(
                seed = FirstDeviceCeremonySeed(
                    attemptId = pending.attemptId,
                    attemptRecoveryToken = pending.attemptRecoveryToken,
                    serverBaseUrl = pending.serverBaseUrl,
                    deviceId = result.deviceId,
                    signingKeyId = result.signingKeyId,
                    encryptionKeyId = result.encryptionKeyId,
                    dskPublicKeyBase64 = pending.signingPublicKeyBase64,
                    dekPublicKeyBase64 = pending.encryptionPublicKeyBase64,
                    dskAlias = pending.signingPrivateKeyAlias,
                    dekAlias = pending.encryptionPrivateKeyAlias,
                ),
            ),
            replaceableTerminalStates = setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED),
        )
    }
}
