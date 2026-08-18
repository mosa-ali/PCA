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
    /** Server responded 404 -- token invalid, expired, revoked, already redeemed, or a conflicting attempt id. Indistinguishable by design. */
    object InvitationUnavailable : BootstrapError("invitation_unavailable")

    /** Server responded 400 -- malformed request shape on this client's own side (a caller bug, not a user-recoverable state). */
    object InvalidRequest : BootstrapError("invalid_request")

    /**
     * BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP: no HTTP response was received at all (timeout,
     * connection reset, I/O failure), OR a 201 was received but its body could not be parsed into
     * a valid deviceId/status. In either case the true server-side outcome is unknown -- the
     * device+keys may already have been created and the invitation already marked REDEEMED.
     *
     * PCA-ENROLLMENT-RUNTIME-2: this is no longer a dead end. The same-process caller
     * ([EnrollmentCoordinator.retryBootstrap]) can safely resend the SAME (attemptId, token,
     * DSK, DEK) tuple -- the backend replays the original result idempotently rather than
     * creating a second device (MySqlEnrollmentCoordinatorRepository). If the process has since
     * restarted (rawInvitationToken no longer in memory), [recoverAttempt] recovers the same
     * outcome using only the durably-persisted attemptId + attemptRecoveryToken.
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
    /**
     * Server responded 404 -- either no attempt exists under this attemptId, or the
     * attemptRecoveryToken presented does not match (byte-for-byte indistinguishable responses,
     * per EnrollmentCoordinator.ts's own doc: "no existence oracle"). This is a DEFINITIVE
     * answer -- the server actually processed the request and gave a real response -- unlike
     * [AmbiguousOutcome] below.
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
                404 -> { drainQuietly(connection.errorStream); throw BootstrapError.InvitationUnavailable }
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
                200 -> parseSuccessBody(readBoundedBody(connection.inputStream) { RecoveryError.AmbiguousOutcome }) { RecoveryError.AmbiguousOutcome }
                404 -> { drainQuietly(connection.errorStream); throw RecoveryError.NotFound }
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
        val deviceId = json.optString("deviceId", "")
        val status = json.optString("status", "")
        if (deviceId.isBlank() || status.isBlank()) throw onAmbiguous()
        val ageUxTier = runCatching { AgeUxTier.valueOf(json.optString("ageUxTier", AgeUxTier.YOUNG_CHILD.name)) }
            .getOrElse { throw onAmbiguous() }
        val initialPolicyProfile = runCatching {
            InitialPolicyProfile.valueOf(json.optString("initialPolicyProfile", InitialPolicyProfile.BALANCED.name))
        }.getOrElse { throw onAmbiguous() }
        return DeviceBootstrapResult(
            deviceId = deviceId,
            status = status,
            childProfileId = json.optString("childProfileId", "").ifBlank { null },
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
    private fun readBoundedBody(stream: InputStream?, onAmbiguous: () -> Exception): String {
        if (stream == null) return ""
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
        return String(buffer, 0, total, Charsets.UTF_8)
    }

    /** Error-path bodies are never needed for classification (status code alone determines the outcome) -- drained only to free the connection, any failure here is immaterial. */
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
        const val RECOVER_PATH = "/v1/enrollment/bootstrap/recover"
        const val MAX_RESPONSE_BYTES = 8 * 1024
        const val DEFAULT_TIMEOUT_MILLIS = 15_000
    }
}
