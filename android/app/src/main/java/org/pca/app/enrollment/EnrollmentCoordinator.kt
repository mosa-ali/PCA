package org.pca.app.enrollment

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.pca.app.security.CryptoSuiteNotApprovedException
import org.pca.app.security.DeviceKeyPairGenerator
import org.pca.app.security.GeneratedKeyPair
import org.pca.app.storage.FamilyStateStore
import org.pca.app.storage.LocalFamilyState

/**
 * Drives the child-device enrollment flow end to end: parses an invitation deep link (via the
 * pre-existing [EnrollmentLinkParser], reused as-is), prepares this device's key pairs (gated by
 * [DeviceKeyPairGenerator]'s crypto-suite approval), calls [DeviceBootstrapApiClient], and
 * persists the server-issued identity via [FamilyStateStore]. Never sends or infers familyId,
 * role, or any authority claim -- the request body this coordinator builds mirrors
 * bootstrapRoutes.ts's verified shape exactly (rawInvitationToken/platform/signingPublicKey/
 * encryptionPublicKey only).
 *
 * The raw invitation token is held ONLY in [rawInvitationToken], an in-memory field, for the
 * duration of one active attempt. It is never written to [FamilyStateStore] or any other
 * persistent store, never logged, and is cleared on success and on every terminal (non-ambiguous)
 * failure. It is deliberately NOT cleared on [EnrollmentState.BootstrapResultUnknown] -- see that
 * state's own doc; this does not mean the coordinator will reuse it automatically (it never does),
 * only that a human-directed retry has the option without asking the user to re-scan/re-paste.
 */
class EnrollmentCoordinator(
    private val linkParser: EnrollmentLinkParser,
    private val apiClient: DeviceBootstrapApiClient,
    private val keyPairGenerator: DeviceKeyPairGenerator,
    private val familyStateStore: FamilyStateStore,
    private val platform: String = "ANDROID",
) {
    private val _state = MutableStateFlow(restoreInitialState())
    val state: StateFlow<EnrollmentState> = _state.asStateFlow()

    private var rawInvitationToken: String? = null

    private fun restoreInitialState(): EnrollmentState {
        val persisted = familyStateStore.currentState() ?: return EnrollmentState.NotEnrolled
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

    /**
     * Parses [uri] via [linkParser] and, if valid, stores its opaque token in memory and moves to
     * [EnrollmentState.InvitationReady]. Any parse failure (wrong scheme/host, missing token) is
     * reported as [EnrollmentState.FailedInvitationInvalid] -- the same generic outcome as a
     * server-side 404, so this client never becomes a token/link validity oracle either.
     */
    fun submitInvitationLink(uri: String) {
        val parsed = linkParser.parse(uri)
        if (parsed == null) {
            rawInvitationToken = null
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        }
        rawInvitationToken = parsed.rawInvitationToken
        _state.value = EnrollmentState.InvitationReady(parsed.serverBaseUrl)
    }

    /**
     * Runs key preparation + bootstrap from [EnrollmentState.InvitationReady]. No-op (reports
     * [EnrollmentState.FailedInvitationInvalid]) if called from any other state -- a caller bug,
     * not a network/crypto outcome.
     */
    suspend fun beginBootstrap() {
        val token = rawInvitationToken
        if (token == null || _state.value !is EnrollmentState.InvitationReady) {
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
            // Never proceeds to the network call from here -- no apiClient.bootstrap() call exists
            // on this path.
            _state.value = EnrollmentState.CryptoReviewRequired
            return
        }

        _state.value = EnrollmentState.Bootstrapping
        val result = try {
            apiClient.bootstrap(
                rawInvitationToken = token,
                platform = platform,
                signingPublicKeyBase64 = signingKey.publicKeyBase64,
                encryptionPublicKeyBase64 = encryptionKey.publicKeyBase64,
            )
        } catch (e: BootstrapError.InvitationUnavailable) {
            rawInvitationToken = null
            _state.value = EnrollmentState.FailedInvitationInvalid
            return
        } catch (e: BootstrapError.InvalidRequest) {
            rawInvitationToken = null
            _state.value = EnrollmentState.FailedRetryable
            return
        } catch (e: BootstrapError.UnexpectedServerError) {
            _state.value = EnrollmentState.FailedRetryable
            return
        } catch (e: BootstrapError.AmbiguousOutcome) {
            // BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP -- see EnrollmentState.BootstrapResultUnknown.
            // Deliberately does NOT clear rawInvitationToken and does NOT retry automatically.
            _state.value = EnrollmentState.BootstrapResultUnknown
            return
        }

        persistSuccess(result)
        rawInvitationToken = null
        _state.value = EnrollmentState.PairingPending(result.deviceId)
    }

    /**
     * Atomic local-commit boundary: a single [FamilyStateStore.save] call, executed only after
     * the server has confirmed success (HTTP 201, parsed body) and only after
     * [keyPairGenerator]'s calls above have already durably stored this device's key material
     * (both key-pair generation calls, and therefore their [SecureKeyStore][org.pca.app.security
     * .SecureKeyStore] writes, complete before this method is ever reached). A persisted
     * [LocalFamilyState] can therefore never reference key material that was not actually stored,
     * nor can key material be stored without this call eventually reflecting the device as
     * enrolled -- there is exactly one write here, not several that could partially apply.
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
            ),
        )
    }
}
