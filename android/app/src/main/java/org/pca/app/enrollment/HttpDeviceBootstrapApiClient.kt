package org.pca.app.enrollment

import java.io.IOException
import java.io.InputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

/**
 * Where and how to reach the unauthenticated bootstrap endpoint
 * (backend/src/http/routes/bootstrapRoutes.ts). Validated eagerly at
 * construction so a misconfigured production build fails closed at
 * composition time rather than silently sending an invitation token/keys
 * over an insecure channel. Non-HTTPS is only ever permitted for the
 * well-known local-development hosts, and only when [allowInsecureHttp] is
 * explicitly set -- mirrors the rest of this codebase's "never silently
 * downgrade" posture (see e.g. RejectingEnvelopeSignatureVerifier).
 */
data class BootstrapEndpointConfig(
    val baseUrl: String,
    val allowInsecureHttp: Boolean = false,
) {
    init {
        val isHttps = baseUrl.startsWith("https://", ignoreCase = true)
        val host = runCatching { URL(baseUrl).host }.getOrNull()
        val isLocalDevHost = host != null && LOCAL_DEV_HOSTS.contains(host)
        require(isHttps || (allowInsecureHttp && isLocalDevHost)) {
            "Refusing to configure an insecure (non-HTTPS) bootstrap endpoint '$baseUrl' -- " +
                "only localhost/10.0.2.2 development hosts may use HTTP, and only with allowInsecureHttp=true."
        }
    }

    private companion object {
        val LOCAL_DEV_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2")
    }
}

/**
 * External outcomes of a bootstrap attempt, mirroring bootstrapRoutes.ts's own deliberately
 * narrow error vocabulary exactly -- this client must never attempt to further distinguish
 * [InvitationUnavailable]'s NOT_FOUND/EXPIRED/REVOKED/ALREADY_REDEEMED/ATTEMPT_CONFLICT causes
 * (the backend collapses them on purpose, an anti-enumeration measure; re-splitting them
 * client-side would defeat it).
 */
sealed class BootstrapError(message: String) : Exception(message) {
    /**
     * The response matched the backend's canonical generic 404 envelope -- token invalid,
     * expired, revoked, already redeemed, or a conflicting attempt id. These causes remain
     * indistinguishable by design. A 404 with any other body is ambiguous and must not be treated
     * as this result.
     */
    object InvitationUnavailable : BootstrapError("invitation_unavailable")

    /** Server responded 400 -- malformed request shape on this client's own side (a caller bug, not a user-recoverable state). */
    object InvalidRequest : BootstrapError("invalid_request")

    /**
     * BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP: no HTTP response was received at all (timeout,
     * connection reset, I/O failure), a 404 body did not match the canonical API error envelope,
     * OR a 201 was received but its body could not be parsed into a valid deviceId/status. In
     * either case the true server-side outcome is unknown -- the device+keys may already have
     * been created and the invitation already marked REDEEMED.
     *
     * [EnrollmentCoordinator.retryBootstrap] can explicitly resend the same attemptId, invitation,
     * recovery token, platform, DSK and DEK tuple. After restart, [recoverAttempt] uses the durable
     * attempt credentials; a rescan of the same invitation can also restore the token in memory
     * after its SHA-256 digest matches the pending record. The coordinator disables that replay
     * path while local first-device root custody is in conflict.
     */
    object AmbiguousOutcome : BootstrapError("bootstrap_result_unknown")

    /** Any other/unexpected status code (5xx, etc). We know a response was actually received and processed by the server infra, so -- unlike [AmbiguousOutcome] -- this is treated as an ordinary retryable failure. */
    object UnexpectedServerError : BootstrapError("unexpected_server_error")
}

/**
 * External outcomes of a call to `POST /v1/enrollment/bootstrap/recover`. Deliberately mirrors
 * [BootstrapError]'s shape -- see that class's own doc for why NotFound covers several distinct
 * server-side causes collapsed into one generic response (no existence oracle).
 */
sealed class RecoveryError(message: String) : Exception(message) {
    /** The server serialized recovery against bootstrap and proved no device was committed. */
    object AttemptAbandoned : RecoveryError("attempt_abandoned")
    /**
     * The body matched the backend's canonical generic 404 envelope -- either no attempt exists
     * under this attemptId, or the attemptRecoveryToken presented does not match (byte-for-byte
     * indistinguishable responses, per EnrollmentCoordinator.ts: "no existence oracle"). It is
     * not proof that the attempt is terminal: the backend uses an unlocked read, so an original
     * bootstrap transaction can still be in flight and commit after this lookup. Normal recovery
     * callers preserve pending attempt and key custody. Cleanup is allowed only in the
     * coordinator's PREPARED-only path after both prepare and recovery returned this canonical
     * envelope. A 404 with any other body is AmbiguousOutcome.
     */
    object NotFound : RecoveryError("invitation_unavailable")

    /** Server responded 400 -- malformed persisted attempt state on this client's own side (should not normally happen; a corrupted/legacy local record, not a network outcome). */
    object InvalidRequest : RecoveryError("invalid_request")

    /** No HTTP response was received at all (timeout, connection reset, I/O failure), or a 200 body could not be parsed. Transient -- callers must preserve pending-attempt state and may retry later (bounded, not a storm), never treat this as a definitive answer. */
    object AmbiguousOutcome : RecoveryError("recovery_result_unknown")

    /** Any other/unexpected status code (5xx, etc) -- a response was received, treated as an ordinary transient/retryable failure, same posture as [BootstrapError.UnexpectedServerError]. */
    object UnexpectedServerError : RecoveryError("unexpected_server_error")
}

/**
 * Real HTTP implementation of [DeviceBootstrapApiClient], calling
 * `POST /v1/enrollment/bootstrap` and `POST /v1/enrollment/bootstrap/recover` exactly per
 * bootstrapRoutes.ts's verified contract. Uses `java.net.HttpURLConnection` (JDK/Android SDK, no
 * new Gradle dependency), matching the sole existing precedent in this codebase
 * ([org.pca.app.runtime.sync.transport.HttpUrlConnectionRelayHttpClient]).
 *
 * Never logs [rawInvitationToken], either public key, or attemptRecoveryToken -- they are read
 * once from the method parameters directly into the outgoing JSON body and touched nowhere else
 * (no `Log.*` call anywhere in this class; grep-provable). Cancellation-safe:
 * `withContext(Dispatchers.IO)` propagates coroutine cancellation normally, and every catch
 * clause here explicitly re-throws [CancellationException] before falling through to broader
 * exception handling, unlike the pre-existing RelayHttpClient precedent (which does not do this)
 * -- deliberately hardened here per this lane's mission brief.
 */
class HttpDeviceBootstrapApiClient(
    private val config: BootstrapEndpointConfig,
    private val connectTimeoutMillis: Int = DEFAULT_TIMEOUT_MILLIS,
    private val readTimeoutMillis: Int = DEFAULT_TIMEOUT_MILLIS,
) : DeviceBootstrapApiClient {

    override suspend fun prepareAttempt(
        rawInvitationToken: String,
        platform: String,
        signingPublicKeyBase64: String,
        encryptionPublicKeyBase64: String,
        bootstrapAttemptId: String,
        attemptRecoveryToken: String,
    ) = withContext(Dispatchers.IO) {
        val connection = openConnection(PREPARE_PATH) { BootstrapError.AmbiguousOutcome }
        try {
            configureRequest(connection)
            val body = JSONObject()
                .put("rawInvitationToken", rawInvitationToken)
                .put("platform", platform)
                .put("signingPublicKey", signingPublicKeyBase64)
                .put("encryptionPublicKey", encryptionPublicKeyBase64)
                .put("bootstrapAttemptId", bootstrapAttemptId)
                .put("attemptRecoveryToken", attemptRecoveryToken)
            writeRequestBody(connection, body) { BootstrapError.AmbiguousOutcome }

            val status = readStatusCode(connection) { BootstrapError.AmbiguousOutcome }
            when (status) {
                200 -> {
                    val json = runCatching { JSONObject(readBoundedBody(connection.inputStream) { BootstrapError.AmbiguousOutcome }) }
                        .getOrElse { throw BootstrapError.AmbiguousOutcome }
                    if (json.optString("status") !in setOf("READY", "COMPLETED")) throw BootstrapError.AmbiguousOutcome
                }
                404 -> {
                    val errorBody = readBoundedBytes(connection.errorStream) { BootstrapError.AmbiguousOutcome }
                    if (isCanonicalInvitationUnavailableEnvelope(errorBody)) throw BootstrapError.InvitationUnavailable
                    throw BootstrapError.AmbiguousOutcome
                }
                400 -> { drainQuietly(connection.errorStream); throw BootstrapError.InvalidRequest }
                else -> { drainQuietly(connection.errorStream); throw BootstrapError.UnexpectedServerError }
            }
        } finally {
            connection.disconnect()
        }
    }

    override suspend fun bootstrap(
        rawInvitationToken: String,
        platform: String,
        signingPublicKeyBase64: String,
        encryptionPublicKeyBase64: String,
        bootstrapAttemptId: String,
        attemptRecoveryToken: String,
    ): DeviceBootstrapResult = withContext(Dispatchers.IO) {
        val connection = openConnection(BOOTSTRAP_PATH) { BootstrapError.AmbiguousOutcome }
        try {
            configureRequest(connection)
            val body = JSONObject()
                .put("rawInvitationToken", rawInvitationToken)
                .put("platform", platform)
                .put("signingPublicKey", signingPublicKeyBase64)
                .put("encryptionPublicKey", encryptionPublicKeyBase64)
                .put("bootstrapAttemptId", bootstrapAttemptId)
                .put("attemptRecoveryToken", attemptRecoveryToken)
            writeRequestBody(connection, body) { BootstrapError.AmbiguousOutcome }

            val status = readStatusCode(connection) { BootstrapError.AmbiguousOutcome }
            when (status) {
                201 -> parseSuccessBody(readBoundedBody(connection.inputStream) { BootstrapError.AmbiguousOutcome }) { BootstrapError.AmbiguousOutcome }
                404 -> {
                    val errorBody = readBoundedBytes(connection.errorStream) { BootstrapError.AmbiguousOutcome }
                    if (isCanonicalInvitationUnavailableEnvelope(errorBody)) throw BootstrapError.InvitationUnavailable
                    throw BootstrapError.AmbiguousOutcome
                }
                400 -> { drainQuietly(connection.errorStream); throw BootstrapError.InvalidRequest }
                else -> { drainQuietly(connection.errorStream); throw BootstrapError.UnexpectedServerError }
            }
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Response-loss recovery: never sends [rawInvitationToken] (the caller may not even hold it
     * in memory anymore) -- authority here is solely possession of [attemptRecoveryToken].
     */
    override suspend fun recoverAttempt(
        bootstrapAttemptId: String,
        attemptRecoveryToken: String,
    ): DeviceBootstrapResult = withContext(Dispatchers.IO) {
        val connection = openConnection(RECOVER_PATH) { RecoveryError.AmbiguousOutcome }
        try {
            configureRequest(connection)
            val body = JSONObject()
                .put("bootstrapAttemptId", bootstrapAttemptId)
                .put("attemptRecoveryToken", attemptRecoveryToken)
            writeRequestBody(connection, body) { RecoveryError.AmbiguousOutcome }

            val status = readStatusCode(connection) { RecoveryError.AmbiguousOutcome }
            when (status) {
                200 -> {
                    val responseBody = readBoundedBody(connection.inputStream) { RecoveryError.AmbiguousOutcome }
                    val json = runCatching { JSONObject(responseBody) }.getOrElse { throw RecoveryError.AmbiguousOutcome }
                    if (json.optString("status") == ATTEMPT_ABANDONED_STATUS) throw RecoveryError.AttemptAbandoned
                    parseSuccessBody(responseBody) { RecoveryError.AmbiguousOutcome }
                }
                404 -> {
                    val errorBody = readBoundedBytes(connection.errorStream) { RecoveryError.AmbiguousOutcome }
                    if (isCanonicalInvitationUnavailableEnvelope(errorBody)) throw RecoveryError.NotFound
                    throw RecoveryError.AmbiguousOutcome
                }
                400 -> { drainQuietly(connection.errorStream); throw RecoveryError.InvalidRequest }
                else -> { drainQuietly(connection.errorStream); throw RecoveryError.UnexpectedServerError }
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun openConnection(path: String, onAmbiguous: () -> Exception): HttpURLConnection = try {
        URL("${config.baseUrl}$path").openConnection() as HttpURLConnection
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        throw onAmbiguous()
    }

    private fun configureRequest(connection: HttpURLConnection) {
        connection.requestMethod = "POST"
        connection.setRequestProperty("content-type", "application/json")
        connection.setRequestProperty("accept", "application/json")
        connection.connectTimeout = connectTimeoutMillis
        connection.readTimeout = readTimeoutMillis
        connection.doOutput = true
    }

    /** [body]'s sensitive fields (token/keys/recovery secret) pass through this JSONObject only -- never assigned to a field, never logged. */
    private fun writeRequestBody(connection: HttpURLConnection, body: JSONObject, onAmbiguous: () -> Exception) {
        try {
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            // The request may or may not have reached/been processed by the server -- see
            // BootstrapError.AmbiguousOutcome / RecoveryError.AmbiguousOutcome's own docs
            // (BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP).
            throw onAmbiguous()
        }
    }

    private fun readStatusCode(connection: HttpURLConnection, onAmbiguous: () -> Exception): Int = try {
        connection.responseCode
    } catch (e: CancellationException) {
        throw e
    } catch (e: IOException) {
        // No response arrived at all (timeout / connection reset) -- the true server-side
        // outcome is unknown.
        throw onAmbiguous()
    }

    private fun parseSuccessBody(bodyText: String, onAmbiguous: () -> Exception): DeviceBootstrapResult {
        val json = try {
            JSONObject(bodyText)
        } catch (e: JSONException) {
            // Server said success but the body could not be parsed -- something WAS
            // created/found server-side, but its deviceId cannot be recovered from this response.
            throw onAmbiguous()
        }
        val deviceId = json.opt("deviceId") as? String ?: throw onAmbiguous()
        val status = json.opt("status") as? String ?: throw onAmbiguous()
        // Bootstrap and recovery DTOs are intentionally narrower than the
        // general device lifecycle: this endpoint may establish only the
        // server-issued identity in PAIRING_PENDING. Treat every other status
        // as an ambiguous success, preserve the attempt, and require recovery
        // rather than persisting a higher lifecycle state from this response.
        if (deviceId.isBlank() || status != PAIRING_PENDING_STATUS) throw onAmbiguous()
        // Wave 6C: the server-minted DSK/DEK key ids are part of the
        // certified DTO on BOTH routes; a response missing them cannot feed
        // the first-device trust-root ceremony and is therefore ambiguous
        // (the attempt is preserved and recovery can re-obtain them).
        val signingKeyId = json.opt("signingKeyId") as? String ?: throw onAmbiguous()
        val encryptionKeyId = json.opt("encryptionKeyId") as? String ?: throw onAmbiguous()
        if (signingKeyId.isBlank() || encryptionKeyId.isBlank()) throw onAmbiguous()
        // These two values are server-selected enrollment authority data, not
        // optional client presentation hints. Require actual JSON strings and
        // recognized values; never invent a default when the DTO is incomplete.
        val ageUxTierValue = json.opt("ageUxTier") as? String ?: throw onAmbiguous()
        val ageUxTier = runCatching { AgeUxTier.valueOf(ageUxTierValue) }
            .getOrElse { throw onAmbiguous() }
        val initialPolicyProfileValue = json.opt("initialPolicyProfile") as? String ?: throw onAmbiguous()
        val initialPolicyProfile = runCatching {
            InitialPolicyProfile.valueOf(initialPolicyProfileValue)
        }.getOrElse { throw onAmbiguous() }
        if (!json.has("childProfileId")) throw onAmbiguous()
        val childProfileId = when (val value = json.opt("childProfileId")) {
            JSONObject.NULL -> null
            is String -> value.takeIf { it.isNotBlank() } ?: throw onAmbiguous()
            else -> throw onAmbiguous()
        }
        return DeviceBootstrapResult(
            deviceId = deviceId,
            status = status,
            signingKeyId = signingKeyId,
            encryptionKeyId = encryptionKeyId,
            childProfileId = childProfileId,
            ageUxTier = ageUxTier,
            initialPolicyProfile = initialPolicyProfile,
        )
    }

    /**
     * Bounded read: never buffers more than [MAX_RESPONSE_BYTES] regardless of what the server
     * sends. If the buffer fills completely (the body is at least [MAX_RESPONSE_BYTES]), the
     * response is treated as unparseable/oversized -- deliberately does not perform an extra
     * read-past-the-bound probe to confirm truncation (HttpURLConnection's length-aware stream can
     * block on that with a "Connection: close" server, e.g. a bare `HttpURLConnection` talking to
     * a simple non-keep-alive test server); filling the bound exactly is already conservative
     * enough to distrust the body without further reads.
     */
    private fun readBoundedBody(stream: InputStream?, onAmbiguous: () -> Exception): String =
        String(readBoundedBytes(stream, onAmbiguous), Charsets.UTF_8)

    private fun readBoundedBytes(stream: InputStream?, onAmbiguous: () -> Exception): ByteArray {
        if (stream == null) return ByteArray(0)
        val buffer = ByteArray(MAX_RESPONSE_BYTES)
        var total = 0
        try {
            stream.use { input ->
                while (total < buffer.size) {
                    val read = input.read(buffer, total, buffer.size - total)
                    if (read == -1) break
                    total += read
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw onAmbiguous()
        }
        if (total >= MAX_RESPONSE_BYTES) throw onAmbiguous()
        return buffer.copyOf(total)
    }

    /**
     * Match only the backend's one-property generic 404 JSON envelope. This deliberately avoids
     * JSONObject: its duplicate-key handling can collapse an invalid response into an apparently
     * valid object. Permit only RFC JSON whitespace around tokens, and compare the ASCII bytes
     * directly so malformed UTF-8, duplicate keys, additional properties and proxy-generated
     * error pages remain ambiguous.
     */
    private fun isCanonicalInvitationUnavailableEnvelope(body: ByteArray): Boolean {
        var index = 0

        fun skipJsonWhitespace() {
            while (index < body.size) {
                when (body[index].toInt() and 0xff) {
                    0x20, 0x09, 0x0a, 0x0d -> index++
                    else -> return
                }
            }
        }

        fun consumeAscii(expected: String): Boolean {
            for (character in expected) {
                if (index >= body.size || (body[index].toInt() and 0xff) != character.code) return false
                index++
            }
            return true
        }

        skipJsonWhitespace()
        if (!consumeAscii("{")) return false
        skipJsonWhitespace()
        if (!consumeAscii("\"error\"")) return false
        skipJsonWhitespace()
        if (!consumeAscii(":")) return false
        skipJsonWhitespace()
        if (!consumeAscii("\"invitation_unavailable\"")) return false
        skipJsonWhitespace()
        if (!consumeAscii("}")) return false
        skipJsonWhitespace()
        return index == body.size
    }

    /** Bodies for other error statuses are not used for classification; drain them only to free the connection. */
    private fun drainQuietly(stream: InputStream?) {
        if (stream == null) return
        try {
            val buffer = ByteArray(MAX_RESPONSE_BYTES)
            stream.use { input -> while (input.read(buffer) != -1) { /* discard */ } }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            // Ignored: the status code already fully determined the outcome.
        }
    }

    private companion object {
        const val BOOTSTRAP_PATH = "/v1/enrollment/bootstrap"
        const val PREPARE_PATH = "/v1/enrollment/bootstrap/prepare"
        const val RECOVER_PATH = "/v1/enrollment/bootstrap/recover"
        const val ATTEMPT_ABANDONED_STATUS = "ATTEMPT_ABANDONED"
        const val PAIRING_PENDING_STATUS = "PAIRING_PENDING"
        const val MAX_RESPONSE_BYTES = 8 * 1024
        const val DEFAULT_TIMEOUT_MILLIS = 15_000
    }
}
