package org.pca.app.enrollment

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
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
import org.pca.app.storage.EnrollmentPersistenceException
import org.pca.app.storage.FamilyStateStore
import org.pca.app.storage.LocalFamilyState
import org.pca.app.storage.PendingEnrollmentAttempt
import org.pca.app.storage.PendingEnrollmentAttemptStatus
import org.pca.app.storage.PendingEnrollmentAttemptStore

enum class InvitationSubmissionResult {
    PROCESSED,
    REOPEN_AFTER_CONFIRMATION,
    CURRENT_INVITATION_ALREADY_IN_USE,
    CURRENT_INVITATION_UNVERIFIED,
    REJECTED_UNRESOLVED,
    ALREADY_WAITING,
}

class InvitationSubmissionPermit internal constructor(private val releaseAction: () -> Unit) {
    private val released = AtomicBoolean(false)

    fun release() {
        if (released.compareAndSet(false, true)) releaseAction()
    }
}

data class InvitationSubmissionAdmission(
    val permit: InvitationSubmissionPermit,
    val waitsForCurrentOperation: Boolean,
)

/**
 * Drives the child-device enrollment flow end to end: parses an invitation deep link (via the
 * pre-existing [EnrollmentLinkParser], reused as-is), prepares this device's key pairs (gated by
 * [DeviceKeyPairGenerator]'s crypto-suite approval), calls [DeviceBootstrapApiClient], and
 * persists the server-issued identity via [FamilyStateStore]. Never sends or infers familyId,
 * role, or any authority claim -- the request body this coordinator builds mirrors
 * bootstrapRoutes.ts's verified shape exactly (rawInvitationToken/platform/signingPublicKey/
 * encryptionPublicKey/bootstrapAttemptId/attemptRecoveryToken only).
 *
 * The raw invitation token is held only in memory: in [rawInvitationToken] after coordinator
 * acceptance and briefly in the application-scoped Activity submission task while it waits for
 * this coordinator's operation lock. It is never written to [FamilyStateStore],
 * [PendingEnrollmentAttemptStore], or any other persistent store, and is never logged. At most
 * one Activity link waits in memory; process death can discard that transient URI, in which case
 * the user can reopen the invitation. The pending record stores only its SHA-256 digest so a user
 * can rescan the original link after restart and explicitly retry the same request. An unresolved
 * attempt never accepts a different link or retries automatically. Exact-invitation replay is
 * disabled while [EnrollmentState.RecoveryPending.custodyConflict] is true; that state remains
 * recovery-only until local root custody can be reconciled.
 *
 * PCA-ENROLLMENT-RUNTIME-2 (BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP closure): before ANY network
 * call, [beginBootstrap] durably persists a narrow [PendingEnrollmentAttempt] via
 * [pendingAttemptStore] -- attemptId, attemptRecoveryToken, server base URL, DSK/DEK public keys
 * + [org.pca.app.security.SecureKeyStore] aliases, and lifecycle status. This survives process
 * death, app restart, and device reboot. [restoreInitialState] checks it on construction:
 * - No local family state AND a pending attempt exists -> [EnrollmentState.RecoveryPending]:
 *   [recoverAttempt] can resolve its outcome using attemptId + attemptRecoveryToken; a same-link
 *   rescan can additionally restore the raw token for an explicit exact retry unless local root
 *   custody is in conflict, in which case recovery remains the only allowed action.
 * - Local family state already exists -> identity remains authoritative; a retained pending
 *   record alongside PAIRING_PENDING keeps recovery actionable until cleanup is confirmed.
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
    /** Attempt whose invitation is held in memory for an explicit same-attempt replay. */
    private var bootstrapRetryAttempt: PendingEnrollmentAttempt? = null
    private data class ProfileConfirmation(val result: DeviceBootstrapResult, val attempt: PendingEnrollmentAttempt)
    private var pendingProfileConfirmation: ProfileConfirmation? = null
    private val operationMutex = Mutex()
    /** One Activity link is admitted synchronously before its coroutine is created. */
    private val invitationSubmissionMutex = Mutex()

    /** Concurrent callers are rejected rather than queued against a later attempt. */
    private suspend fun runOperation(action: suspend () -> Unit) {
        if (_state.value is EnrollmentState.LocalPersistenceUnavailable) return
        if (!operationMutex.tryLock()) return
        try { currentCoroutineContext().ensureActive(); action() } catch (cancelled: CancellationException) {
            pendingProfileConfirmation = null
            try {
                pendingAttemptStore.current()?.let { _state.value = EnrollmentState.RecoveryPending(it.serverBaseUrl) }
            } catch (_: EnrollmentPersistenceException) {
                _state.value = EnrollmentState.LocalPersistenceUnavailable
            }
            throw cancelled
        } catch (_: EnrollmentPersistenceException) {
            _state.value = EnrollmentState.LocalPersistenceUnavailable
        } finally { operationMutex.unlock() }
    }

    private fun matchesAttempt(attempt: PendingEnrollmentAttempt): Boolean {
        if (pendingAttemptStore.current() == attempt) return true
        _keyFingerprints.value = null
        pendingProfileConfirmation = null
        rawInvitationToken = null
        bootstrapRetryAttempt = null
        _state.value = restoreInitialState()
        return false
    }

    private fun invitationTokenSha256(token: String): String = MessageDigest.getInstance("SHA-256")
        .digest(token.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun invitationDigestMatches(expectedHex: String?, token: String): Boolean {
        if (expectedHex == null || !SHA256_HEX.matches(expectedHex)) return false
        val actualHex = invitationTokenSha256(token)
        return MessageDigest.isEqual(
            expectedHex.toByteArray(Charsets.US_ASCII),
            actualHex.toByteArray(Charsets.US_ASCII),
        )
    }

    private fun rescanWasRejected(): Boolean =
        (_state.value as? EnrollmentState.RecoveryPending)?.invitationRescanRejected == true

    private fun restoreInitialState(): EnrollmentState {
        try {
            val persisted = try {
                familyStateStore.currentState()
            } catch (_: CorruptLocalFamilyStateException) {
                // Do not inspect/recover a pending attempt against an unreadable identity record.
                return EnrollmentState.LocalStateCorrupt
            }
            if (persisted != null) {
                // A family commit can survive while pending cleanup fails. Keep
                // its recovery endpoint actionable after process restart.
                if (persisted.pairingState == PairingState.PAIRING_PENDING) {
                    pendingAttemptStore.current()?.let {
                        return EnrollmentState.RecoveryPending(it.serverBaseUrl)
                    }
                }
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
        } catch (_: EnrollmentPersistenceException) {
            return EnrollmentState.LocalPersistenceUnavailable
        }
    }

    /**
     * Parses [uri] via [linkParser]. With no unresolved attempt it stores the token in memory and
 * moves to [EnrollmentState.InvitationReady]. With an unresolved attempt it only restores the
 * token when its persisted SHA-256 invitation binding matches; this enables an
     * explicit same-attempt retry after restart without persisting the bearer token. Any other
     * link preserves the current state and credentials.
     */
    fun submitInvitationLink(uri: String) {
        if (!operationMutex.tryLock()) return
        try {
            // Synchronous callers have no result channel for reopen/duplicate guidance. Keep the
            // current confirmation state intact; Activity deep links use the reserved async path.
            if (pendingProfileConfirmation != null) return
            submitInvitationLinkLocked(uri)
        } catch (_: EnrollmentPersistenceException) {
            _state.value = EnrollmentState.LocalPersistenceUnavailable
        } finally { operationMutex.unlock() }
    }

    /**
     * Activity deep links use this single-flight suspending entry point so clearing the URI from
     * the retained Android Intent cannot silently discard it while another enrollment operation
     * owns the lock. At most one URI waits in memory; additional links are reported to the caller.
     */
    fun reserveInvitationSubmission(): InvitationSubmissionAdmission? {
        if (!invitationSubmissionMutex.tryLock()) return null
        return InvitationSubmissionAdmission(
            permit = InvitationSubmissionPermit { invitationSubmissionMutex.unlock() },
            waitsForCurrentOperation = operationMutex.isLocked,
        )
    }

    suspend fun submitInvitationLinkWhenAvailable(uri: String): InvitationSubmissionResult {
        val admission = reserveInvitationSubmission() ?: return InvitationSubmissionResult.ALREADY_WAITING
        return submitReservedInvitationLink(uri, admission.permit)
    }

    suspend fun submitReservedInvitationLink(
        uri: String,
        permit: InvitationSubmissionPermit,
    ): InvitationSubmissionResult {
        val boundedUri = uri.takeIf { it.length <= EnrollmentDeepLinkConfig.MAX_INVITATION_URI_LENGTH } ?: ""
        var operationLocked = false
        try {
            if (!operationMutex.tryLock()) operationMutex.lock()
            operationLocked = true
            val confirmation = pendingProfileConfirmation
            if (confirmation != null) {
                val parsed = linkParser.parse(boundedUri) ?: return InvitationSubmissionResult.REJECTED_UNRESOLVED
                if (confirmation.attempt.invitationTokenSha256 == null) {
                    return InvitationSubmissionResult.CURRENT_INVITATION_UNVERIFIED
                }
                return if (invitationDigestMatches(confirmation.attempt.invitationTokenSha256, parsed.rawInvitationToken)) {
                    InvitationSubmissionResult.CURRENT_INVITATION_ALREADY_IN_USE
                } else {
                    InvitationSubmissionResult.REOPEN_AFTER_CONFIRMATION
                }
            }
            return submitInvitationLinkLocked(boundedUri)
        } catch (_: EnrollmentPersistenceException) {
            _state.value = EnrollmentState.LocalPersistenceUnavailable
            return InvitationSubmissionResult.PROCESSED
        } finally {
            if (operationLocked) operationMutex.unlock()
            permit.release()
        }
    }

    private fun submitInvitationLinkLocked(uri: String): InvitationSubmissionResult {
        if (blockIfLocalStateCorrupt()) return InvitationSubmissionResult.PROCESSED
        val parsed = linkParser.parse(uri)
        val pending = pendingAttemptStore.current()
        if (pending != null) {
            if (parsed != null && invitationDigestMatches(pending.invitationTokenSha256, parsed.rawInvitationToken)) {
                val recovery = _state.value as? EnrollmentState.RecoveryPending
                if (recovery?.custodyConflict == true) {
                    // Exact rescanning cannot authorize bootstrap replay while
                    // the server outcome and local root custody disagree.
                    rawInvitationToken = null
                    bootstrapRetryAttempt = null
                    _state.value = recovery.copy(invitationRescanRejected = false)
                    return InvitationSubmissionResult.PROCESSED
                }
                rawInvitationToken = parsed.rawInvitationToken
                bootstrapRetryAttempt = pending
                _state.value = EnrollmentState.BootstrapResultUnknown
            } else if (_state.value is EnrollmentState.RecoveryPending) {
                val custodyConflict = (_state.value as? EnrollmentState.RecoveryPending)?.custodyConflict == true
                _state.value = EnrollmentState.RecoveryPending(
                    pending.serverBaseUrl,
                    invitationRescanRejected = true,
                    custodyConflict = custodyConflict,
                )
            }
            return if (parsed != null && invitationDigestMatches(pending.invitationTokenSha256, parsed.rawInvitationToken)) {
                InvitationSubmissionResult.PROCESSED
            } else {
                InvitationSubmissionResult.REJECTED_UNRESOLVED
            }
        }
        if (parsed == null) {
            rawInvitationToken = null
            _state.value = EnrollmentState.FailedInvitationInvalid
            return InvitationSubmissionResult.PROCESSED
        }
        rawInvitationToken = parsed.rawInvitationToken
        bootstrapRetryAttempt = null
        pendingProfileConfirmation = null
        // A fresh attempt (including the add-another-device path) must never show a stale
        // fingerprint from a PRIOR device's key pair while this one is still being prepared.
        _keyFingerprints.value = null
        _state.value = EnrollmentState.InvitationReady(parsed.serverBaseUrl)
        return InvitationSubmissionResult.PROCESSED
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
        // unavailable root read is not proof that the slot is empty. Keep the
        // root slot locked for the entire sweep so seed capture cannot race it.
        val keepAttemptIds = mutableSetOf(attemptId)
        pendingAttemptStore.current()?.let { keepAttemptIds.add(it.attemptId) }
        val deletion = keyPairGenerator as? DeviceKeyPairDeletion
        val rootStore = firstDeviceRootStore
        if (deletion != null && rootStore != null) {
            rootStore.withConfirmedSafeAttemptKeyCleanup(attemptId) {
                when (val rootRead = rootStore.readState()) {
                    FirstDeviceRootReadResult.Missing -> deletion.deleteOrphanedAttemptKeys(keepAttemptIds)
                    FirstDeviceRootReadResult.Unreadable -> Unit
                    is FirstDeviceRootReadResult.Present -> {
                        keepAttemptIds.add(rootRead.record.seed.attemptId)
                        deletion.deleteOrphanedAttemptKeys(keepAttemptIds)
                    }
                }
            }
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
            status = PendingEnrollmentAttemptStatus.PREPARED,
            invitationTokenSha256 = invitationTokenSha256(token),
        )
        // Durably persisted BEFORE the network call -- section 4 of the mission brief: this must
        // survive process death/app restart/device reboot/network loss/response loss.
        if (!pendingAttemptStore.compareAndSet(expected = null, replacement = pending)) {
            rawInvitationToken = null
            bootstrapRetryAttempt = null
            _keyFingerprints.value = null
            _state.value = restoreInitialState()
            return
        }
        bootstrapRetryAttempt = pending

        sendBootstrapRequest(token, pending)
    }

    /**
     * Re-sends the SAME already-prepared bootstrap request (attemptId, invitation token,
     * recovery token, platform, DSK and DEK)
     * after an ambiguous, generic-400, or generic-404 outcome, while [rawInvitationToken] is held
     * in memory. Following restart, an explicit retry requires the exact invitation to be rescanned.
     * Relies entirely on the server's idempotent replay of that full tuple -- see
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
        val pending = bootstrapRetryAttempt
        val validState = _state.value is EnrollmentState.BootstrapResultUnknown || _state.value is EnrollmentState.FailedRetryable
        if (token == null || pending == null || !validState ||
            !invitationDigestMatches(pending.invitationTokenSha256, token)
        ) {
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        }
        if (!matchesAttempt(pending)) return
        sendBootstrapRequest(token, pending)
    }

    private suspend fun sendBootstrapRequest(token: String, pending: PendingEnrollmentAttempt) {
        // The initial write is compare-and-set from an empty slot. Retries never rewrite it, so a
        // stale coordinator cannot replace a newer attempt before sending.
        if (!matchesAttempt(pending) || !invitationDigestMatches(pending.invitationTokenSha256, token)) return
        var activeAttempt = pending
        val result = try {
            apiClient.prepareAttempt(
                rawInvitationToken = token,
                platform = activeAttempt.platform,
                signingPublicKeyBase64 = activeAttempt.signingPublicKeyBase64,
                encryptionPublicKeyBase64 = activeAttempt.encryptionPublicKeyBase64,
                bootstrapAttemptId = activeAttempt.attemptId,
                attemptRecoveryToken = activeAttempt.attemptRecoveryToken,
            )
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(activeAttempt)) return
            if (activeAttempt.status == PendingEnrollmentAttemptStatus.PREPARED) {
                val submitted = activeAttempt.copy(status = PendingEnrollmentAttemptStatus.BOOTSTRAPPING)
                if (!pendingAttemptStore.compareAndSet(activeAttempt, submitted)) {
                    _state.value = EnrollmentState.LocalPersistenceUnavailable
                    return
                }
                activeAttempt = submitted
                bootstrapRetryAttempt = submitted
            }
            _state.value = EnrollmentState.Bootstrapping
            apiClient.bootstrap(
                rawInvitationToken = token,
                platform = activeAttempt.platform,
                signingPublicKeyBase64 = activeAttempt.signingPublicKeyBase64,
                encryptionPublicKeyBase64 = activeAttempt.encryptionPublicKeyBase64,
                bootstrapAttemptId = activeAttempt.attemptId,
                attemptRecoveryToken = activeAttempt.attemptRecoveryToken,
            )
        } catch (e: BootstrapError.InvitationUnavailable) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(activeAttempt)) return
            if (activeAttempt.status == PendingEnrollmentAttemptStatus.PREPARED) {
                // This durable phase proves bootstrap was not sent. Resolve
                // any reservation that may have succeeded before a response
                // was lost; a recovery 404 can release only this unsent phase.
                resolveRejectedPreparation(activeAttempt)
                return
            }
            // The endpoint deliberately collapses invalid/expired/revoked/already-redeemed and
            // attempt-conflict causes into one 404. Keep this attempt, its keys and its exact
            // in-memory invitation binding: a generic response cannot authorize a different
            // invitation or prove that a concurrent exact replay did not commit. The user may
            // explicitly retry only this same full tuple (including recovery token and platform).
            _state.value = EnrollmentState.BootstrapResultUnknown
            return
        } catch (e: BootstrapError.InvalidRequest) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(activeAttempt)) return
            // A generic HTTP 400 is not an authenticated terminal attempt result. A previous
            // identical request may already have committed, so retain the invite, exact pending
            // attempt and hardware-key custody until the server exposes a terminal resolution
            // contract. The user may explicitly retry only this same tuple.
            _state.value = EnrollmentState.BootstrapResultUnknown
            return
        } catch (e: BootstrapError.UnexpectedServerError) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(activeAttempt)) return
            // Ordinary transient failure -- token AND pending-attempt state are both preserved so
            // a later retryBootstrap() can safely try again.
            _state.value = EnrollmentState.FailedRetryable
            return
        } catch (e: BootstrapError.AmbiguousOutcome) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(activeAttempt)) return
            // BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP -- see EnrollmentState.BootstrapResultUnknown.
            // Deliberately does NOT clear rawInvitationToken or pendingAttemptStore, and does NOT
            // retry automatically.
            _state.value = EnrollmentState.BootstrapResultUnknown
            return
        }

        currentCoroutineContext().ensureActive()
        if (!matchesAttempt(activeAttempt)) return
        if (result.status != PairingState.PAIRING_PENDING.name) {
            // The server contract permits bootstrap to establish only
            // PAIRING_PENDING. A different status means the response cannot
            // safely be committed; keep the token and durable attempt so an
            // explicit retry/recovery can resolve the server-side outcome.
            _state.value = EnrollmentState.BootstrapResultUnknown
            return
        }

        rawInvitationToken = null
        pendingProfileConfirmation = ProfileConfirmation(result, activeAttempt)
        _state.value = EnrollmentState.ProfileConfirmation(
            deviceId = result.deviceId,
            ageUxTier = result.ageUxTier,
            initialPolicyProfile = result.initialPolicyProfile,
        )
    }

    private suspend fun resolveRejectedPreparation(attempt: PendingEnrollmentAttempt) {
        try {
            val result = apiClient.recoverAttempt(attempt.attemptId, attempt.attemptRecoveryToken)
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(attempt)) return
            if (result.status != PairingState.PAIRING_PENDING.name) {
                _state.value = EnrollmentState.BootstrapResultUnknown
                return
            }
            rawInvitationToken = null
            pendingProfileConfirmation = ProfileConfirmation(result, attempt)
            _state.value = EnrollmentState.ProfileConfirmation(
                deviceId = result.deviceId,
                ageUxTier = result.ageUxTier,
                initialPolicyProfile = result.initialPolicyProfile,
            )
        } catch (_: RecoveryError.AttemptAbandoned) {
            currentCoroutineContext().ensureActive()
            clearResolvedAttempt(attempt)
        } catch (_: RecoveryError.NotFound) {
            currentCoroutineContext().ensureActive()
            // PREPARED is persisted before reservation and bootstrap. Since no
            // bootstrap was sent in this phase, no matching server result can
            // still commit when recovery proves no matching attempt exists.
            clearResolvedAttempt(attempt)
        } catch (_: RecoveryError.InvalidRequest) {
            currentCoroutineContext().ensureActive()
            if (matchesAttempt(attempt)) _state.value = EnrollmentState.RecoveryPending(attempt.serverBaseUrl)
        } catch (_: RecoveryError.AmbiguousOutcome) {
            currentCoroutineContext().ensureActive()
            if (matchesAttempt(attempt)) _state.value = EnrollmentState.RecoveryPending(attempt.serverBaseUrl)
        } catch (_: RecoveryError.UnexpectedServerError) {
            currentCoroutineContext().ensureActive()
            if (matchesAttempt(attempt)) _state.value = EnrollmentState.RecoveryPending(attempt.serverBaseUrl)
        }
    }

    private fun clearResolvedAttempt(attempt: PendingEnrollmentAttempt) {
        if (!matchesAttempt(attempt)) return
        val deletion = keyPairGenerator as? DeviceKeyPairDeletion
        val rootStore = firstDeviceRootStore
        // A stale/contradictory abandoned result must not erase DSK/DEK
        // material already captured by the first-device root. The root
        // store runs this only under a confirmed empty/different-attempt
        // state while blocking a concurrent seed capture. Missing store
        // or unreadable root state is not proof that cleanup is safe.
        var pendingCleared = false
        val cleanupSafe = rootStore?.withConfirmedSafeAttemptKeyCleanup(attempt.attemptId) {
            // Recheck ownership before deleting so a stale coordinator cannot
            // erase aliases after another writer replaced the pending record.
            if (!pendingAttemptStore.compareAndSet(attempt, null)) return@withConfirmedSafeAttemptKeyCleanup
            pendingCleared = true
            if (deletion != null) {
                listOf(attempt.signingPrivateKeyAlias, attempt.encryptionPrivateKeyAlias).forEach { alias ->
                    runCatching { deletion.deleteKeyPair(alias) }
                }
            }
        } == true
        if (!cleanupSafe) {
            // Keep the attempt credential and expose an explicit recoverable
            // custody conflict. The server's terminal answer conflicts with
            // local first-device custody (or cannot be reconciled because the
            // root store is unreadable/missing), so "Not enrolled" is unsafe.
            rawInvitationToken = null
            bootstrapRetryAttempt = null
            pendingProfileConfirmation = null
            _keyFingerprints.value = null
            _state.value = EnrollmentState.RecoveryPending(
                serverBaseUrl = attempt.serverBaseUrl,
                invitationRescanRejected = rescanWasRejected(),
                custodyConflict = true,
            )
            return
        }
        if (!pendingCleared) {
            _state.value = EnrollmentState.LocalPersistenceUnavailable
            return
        }
        rawInvitationToken = null
        bootstrapRetryAttempt = null
        pendingProfileConfirmation = null
        _keyFingerprints.value = null
        _state.value = restoreInitialState()
    }

    /**
     * Recovers the outcome of a previously-sent bootstrap attempt using ONLY the durably-held
     * attemptId + attemptRecoveryToken -- never the raw invitation token, which this process may
     * no longer hold (restart after an ambiguous response). Callable from
     * [EnrollmentState.RecoveryPending] or [EnrollmentState.BootstrapResultUnknown] with a
     * pending attempt still on record; otherwise a no-op reporting
     * [EnrollmentState.FailedInvitationInvalid].
     *
     * Section 20 (offline handling): an unresolved failure here
     * ([RecoveryError.NotFound], [RecoveryError.AmbiguousOutcome],
     * [RecoveryError.UnexpectedServerError]) preserves [pendingAttemptStore] and returns to
     * [EnrollmentState.RecoveryPending] honestly -- it never claims success or failure, and never
     * auto-retries in a loop; the caller (UI / connectivity-change handler) decides when to call
     * this again, giving a bounded, explicit resume rather than a retry storm.
     */
    suspend fun recoverAttempt() = runOperation { recoverAttemptLocked() }

    private suspend fun recoverAttemptLocked() {
        if (blockIfLocalStateCorrupt()) return
        val rescanRejected = rescanWasRejected()
        val custodyConflict = (_state.value as? EnrollmentState.RecoveryPending)?.custodyConflict == true
        val pending = pendingAttemptStore.current()
        val validState = _state.value is EnrollmentState.RecoveryPending || _state.value is EnrollmentState.BootstrapResultUnknown
        if (pending == null || !validState) {
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        }

        if (!matchesAttempt(pending)) return
        val result = try {
            apiClient.recoverAttempt(
                bootstrapAttemptId = pending.attemptId,
                attemptRecoveryToken = pending.attemptRecoveryToken,
            )
        } catch (e: RecoveryError.NotFound) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            // The recovery endpoint uses a non-locking lookup and the server deliberately
            // collapses missing-attempt, credential-mismatch, invitation and conflict causes
            // into one 404. A missing row can race the original bootstrap transaction before it
            // commits, so this response cannot prove that the attempt is terminal. Preserve its
            // durable recovery material and hardware keys; only a successful recovery or an
            // authoritative terminal server result may release this custody.
            _state.value = EnrollmentState.RecoveryPending(pending.serverBaseUrl, rescanRejected, custodyConflict)
            return
        } catch (e: RecoveryError.AttemptAbandoned) {
            currentCoroutineContext().ensureActive()
            clearResolvedAttempt(pending)
            return
        } catch (e: RecoveryError.InvalidRequest) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            // A rejected recovery request does not prove that the earlier bootstrap failed.
            // Keep the durable recovery capability and hardware-key custody.
            _state.value = EnrollmentState.RecoveryPending(pending.serverBaseUrl, rescanRejected, custodyConflict)
            return
        } catch (e: RecoveryError.AmbiguousOutcome) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            _state.value = EnrollmentState.RecoveryPending(pending.serverBaseUrl, rescanRejected, custodyConflict)
            return
        } catch (e: RecoveryError.UnexpectedServerError) {
            currentCoroutineContext().ensureActive()
            if (!matchesAttempt(pending)) return
            _state.value = EnrollmentState.RecoveryPending(pending.serverBaseUrl, rescanRejected, custodyConflict)
            return
        }

        currentCoroutineContext().ensureActive()
        if (!matchesAttempt(pending)) return
        if (result.status != PairingState.PAIRING_PENDING.name) {
            // The recovery endpoint returns the original bootstrap result,
            // whose only valid status is PAIRING_PENDING. Preserve the
            // durable recovery capability if the response violates that
            // contract.
            _state.value = EnrollmentState.RecoveryPending(
                pending.serverBaseUrl,
                invitationRescanRejected = rescanRejected,
                custodyConflict = custodyConflict,
            )
            return
        }

        // Recovery is authorized by the durable attempt credentials; a rescanned bearer is no
        // longer needed once the server has returned the committed result. Do not retain it in
        // this long-lived coordinator while profile confirmation or local persistence is pending.
        rawInvitationToken = null
        bootstrapRetryAttempt = null
        pendingProfileConfirmation = ProfileConfirmation(result, pending)
        _state.value = EnrollmentState.ProfileConfirmation(
            deviceId = result.deviceId,
            ageUxTier = result.ageUxTier,
            initialPolicyProfile = result.initialPolicyProfile,
        )
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
            if (!pendingAttemptStore.compareAndSet(confirmation.attempt, null)) {
                pendingProfileConfirmation = null
                rawInvitationToken = null
                bootstrapRetryAttempt = null
                _state.value = restoreInitialState()
                return
            }
            pendingProfileConfirmation = null
            bootstrapRetryAttempt = null
            _state.value = EnrollmentState.PairingPending(result.deviceId)
        } catch (_: EnrollmentPersistenceException) {
            _state.value = EnrollmentState.LocalPersistenceUnavailable
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
        val previousFamily = try {
            familyStateStore.currentState()
        } catch (_: CorruptLocalFamilyStateException) {
            _state.value = EnrollmentState.LocalStateCorrupt
            return false
        }
        if (previousFamily != null && previousFamily.deviceId != result.deviceId) {
            _state.value = EnrollmentState.LocalPersistenceUnavailable
            throw EnrollmentPersistenceException()
        }
        val previousPairingState = previousFamily?.pairingState
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
    private fun blockIfLocalStateCorrupt(): Boolean {
        if (_state.value is EnrollmentState.LocalPersistenceUnavailable) return true
        return try {
            familyStateStore.currentState()
            false
        } catch (_: CorruptLocalFamilyStateException) {
            rawInvitationToken = null
            pendingProfileConfirmation = null
            _state.value = EnrollmentState.LocalStateCorrupt
            true
        } catch (_: EnrollmentPersistenceException) {
            _state.value = EnrollmentState.LocalPersistenceUnavailable
            true
        }
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

    private companion object {
        val SHA256_HEX = Regex("^[0-9a-f]{64}$")
    }
}
