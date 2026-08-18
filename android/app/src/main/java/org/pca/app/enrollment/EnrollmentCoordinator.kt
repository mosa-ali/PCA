package org.pca.app.enrollment

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.pca.app.security.CryptoSuiteNotApprovedException
import org.pca.app.security.DeviceKeyPairGenerator
import org.pca.app.security.GeneratedKeyPair
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
    private var pendingProfileConfirmation: DeviceBootstrapResult? = null

    private fun restoreInitialState(): EnrollmentState {
        val persisted = familyStateStore.currentState()
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
     */
    fun submitInvitationLink(uri: String) {
        if (pendingProfileConfirmation != null) return
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
    }

    /**
     * Runs key preparation + bootstrap from [EnrollmentState.InvitationReady]. No-op (reports
     * [EnrollmentState.FailedInvitationInvalid]) if called from any other state -- a caller bug,
     * not a network/crypto outcome. Generates a NEW attemptId/attemptRecoveryToken and a NEW
     * DSK/DEK key pair -- this is the only place either is minted; every retry
     * ([retryBootstrap], [recoverAttempt]) reuses what this call persists.
     */
    suspend fun beginBootstrap() {
        val token = rawInvitationToken
        val readyState = _state.value as? EnrollmentState.InvitationReady
        if (token == null || readyState == null) {
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        }

        _state.value = EnrollmentState.PreparingKeys
        val signingKey: GeneratedKeyPair
        val encryptionKey: GeneratedKeyPair
        try {
            signingKey = keyPairGenerator.generateSigningKeyPair()
            encryptionKey = keyPairGenerator.generateEncryptionKeyPair()
        } catch (e: CryptoSuiteNotApprovedException) {
            // Never proceeds to the network call from here -- no apiClient.bootstrap() call
            // exists on this path, and nothing is persisted to pendingAttemptStore either.
            _state.value = EnrollmentState.CryptoReviewRequired
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
            attemptId = AttemptIdentifiers.newAttemptId(),
            attemptRecoveryToken = AttemptIdentifiers.newAttemptRecoveryToken(),
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
    suspend fun retryBootstrap() {
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
            // Definitive: this invitation (or attempt id) is unusable. Section 12: abandon the
            // pending attempt -- its key material is unused and safe to stop tracking. A fresh
            // invitation from the parent is required.
            rawInvitationToken = null
            pendingAttemptStore.clear()
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        } catch (e: BootstrapError.InvalidRequest) {
            // Our own request shape was malformed (should not happen from a correct client) --
            // retrying with the same malformed shape cannot help.
            rawInvitationToken = null
            pendingAttemptStore.clear()
            _state.value = EnrollmentState.FailedRetryable
            return
        } catch (e: BootstrapError.UnexpectedServerError) {
            // Ordinary transient failure -- token AND pending-attempt state are both preserved so
            // a later retryBootstrap() can safely try again.
            _state.value = EnrollmentState.FailedRetryable
            return
        } catch (e: BootstrapError.AmbiguousOutcome) {
            // BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP -- see EnrollmentState.BootstrapResultUnknown.
            // Deliberately does NOT clear rawInvitationToken or pendingAttemptStore, and does NOT
            // retry automatically.
            _state.value = EnrollmentState.BootstrapResultUnknown
            return
        }

        rawInvitationToken = null
        pendingProfileConfirmation = result
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
    suspend fun recoverAttempt() {
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
            // DEFINITIVE: the server actually answered -- no completed attempt exists under this
            // (attemptId, attemptRecoveryToken) pair. Section 12: abandon; this attempt's key
            // material is unused and safe to stop tracking. The one-time invitation token itself
            // is unrecoverable by design (never persisted) -- a fresh invitation is required.
            pendingAttemptStore.clear()
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        } catch (e: RecoveryError.InvalidRequest) {
            // Our own persisted attempt state is malformed (should not normally happen) --
            // retrying the same malformed request cannot help.
            pendingAttemptStore.clear()
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        } catch (e: RecoveryError.AmbiguousOutcome) {
            _state.value = EnrollmentState.RecoveryPending(pending.serverBaseUrl)
            return
        } catch (e: RecoveryError.UnexpectedServerError) {
            _state.value = EnrollmentState.RecoveryPending(pending.serverBaseUrl)
            return
        }

        pendingProfileConfirmation = result
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
        val result = pendingProfileConfirmation
        if (result == null || _state.value !is EnrollmentState.ProfileConfirmation) {
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        }
        persistSuccess(result)
        pendingAttemptStore.clear()
        pendingProfileConfirmation = null
        _state.value = EnrollmentState.PairingPending(result.deviceId)
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
     */
    private fun persistSuccess(result: DeviceBootstrapResult) {
        val serverPairingState = runCatching { PairingState.valueOf(result.status) }
            .getOrDefault(PairingState.PAIRING_PENDING)
        familyStateStore.save(
            LocalFamilyState(
                // KNOWN_GAP: the bootstrap response is {deviceId, status} only
                // (backend/src/http/dto.ts toBootstrapResultDto) -- the server deliberately never
                // discloses familyId to the device at this step (family membership stays
                // server-side authority per the EnrollmentCoordinator backend contract). Left as
                // an explicit empty placeholder, never fabricated; nothing here or downstream
                // treats "" as a real familyId. A future authenticated identity/"whoami" surface
                // would be the correct place to obtain a real value, not this coordinator.
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
    }
}
