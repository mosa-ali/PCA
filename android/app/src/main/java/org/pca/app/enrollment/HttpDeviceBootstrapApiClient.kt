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
 * [InvitationUnavailable]'s NOT_FOUND/EXPIRED/REVOKED/ALREADY_REDEEMED causes (the backend
 * collapses them on purpose, an anti-enumeration measure; re-splitting them client-side would
 * defeat it).
 */
sealed class BootstrapError(message: String) : Exception(message) {
    /** Server responded 404 -- token invalid, expired, revoked, or already redeemed. Indistinguishable by design. */
    object InvitationUnavailable : BootstrapError("invitation_unavailable")

    /** Server responded 400 -- malformed request shape on this client's own side (a caller bug, not a user-recoverable state). */
    object InvalidRequest : BootstrapError("invalid_request")

    /**
     * BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP: no HTTP response was received at all (timeout,
     * connection reset, I/O failure), OR a 201 was received but its body could not be parsed into
     * a valid deviceId/status. In either case the true server-side outcome is unknown -- the
     * device+keys may already have been created and the invitation already marked REDEEMED. The
     * backend (confirmed via EnrollmentRepository.ts / MySqlEnrollmentCoordinatorRepository.ts /
     * bootstrapRoutes.ts) has no idempotency key and no way to recover a deviceId from a retry: a
     * retry with the same token after a true success returns a bare 404 invitation_unavailable,
     * indistinguishable from "this token was never valid." Callers MUST NOT automatically retry
     * the same token on this error and MUST NOT treat it as success or as ordinary failure.
     */
    object AmbiguousOutcome : BootstrapError("bootstrap_result_unknown")

    /** Any other/unexpected status code (5xx, etc). We know a response was actually received and processed by the server infra, so -- unlike [AmbiguousOutcome] -- this is treated as an ordinary retryable failure. */
    object UnexpectedServerError : BootstrapError("unexpected_server_error")
}

/**
 * Real HTTP implementation of [DeviceBootstrapApiClient], calling
 * `POST /v1/enrollment/bootstrap` exactly per bootstrapRoutes.ts's verified
 * contract. Uses `java.net.HttpURLConnection` (JDK/Android SDK, no new
 * Gradle dependency), matching the sole existing precedent in this codebase
 * ([org.pca.app.runtime.sync.transport.HttpUrlConnectionRelayHttpClient]).
 *
 * Never logs [rawInvitationToken] or either public key -- they are read
 * once from the method parameters directly into the outgoing JSON body and
 * touched nowhere else (no `Log.*` call anywhere in this class; grep-
 * provable). Cancellation-safe: `withContext(Dispatchers.IO)` propagates
 * coroutine cancellation normally, and every catch clause here explicitly
 * re-throws [CancellationException] before falling through to broader
 * exception handling, unlike the pre-existing RelayHttpClient precedent
 * (which does not do this) -- deliberately hardened here per this lane's
 * mission brief.
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
    ): DeviceBootstrapResult = withContext(Dispatchers.IO) {
        val connection = openConnection()
        try {
            configureRequest(connection)
            writeRequestBody(connection, rawInvitationToken, platform, signingPublicKeyBase64, encryptionPublicKeyBase64)

            val status = readStatusCode(connection)
            when (status) {
                201 -> parseSuccessBody(readBoundedBody(connection.inputStream))
                404 -> { drainQuietly(connection.errorStream); throw BootstrapError.InvitationUnavailable }
                400 -> { drainQuietly(connection.errorStream); throw BootstrapError.InvalidRequest }
                else -> { drainQuietly(connection.errorStream); throw BootstrapError.UnexpectedServerError }
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun openConnection(): HttpURLConnection = try {
        URL("${config.baseUrl}$BOOTSTRAP_PATH").openConnection() as HttpURLConnection
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        throw BootstrapError.AmbiguousOutcome
    }

    private fun configureRequest(connection: HttpURLConnection) {
        connection.requestMethod = "POST"
        connection.setRequestProperty("content-type", "application/json")
        connection.setRequestProperty("accept", "application/json")
        connection.connectTimeout = connectTimeoutMillis
        connection.readTimeout = readTimeoutMillis
        connection.doOutput = true
    }

    /** The invitation token and both public keys pass through this JSONObject only -- never assigned to a field, never logged. */
    private fun writeRequestBody(
        connection: HttpURLConnection,
        rawInvitationToken: String,
        platform: String,
        signingPublicKeyBase64: String,
        encryptionPublicKeyBase64: String,
    ) {
        val body = JSONObject()
            .put("rawInvitationToken", rawInvitationToken)
            .put("platform", platform)
            .put("signingPublicKey", signingPublicKeyBase64)
            .put("encryptionPublicKey", encryptionPublicKeyBase64)
        try {
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            // The request may or may not have reached/been processed by the server -- see
            // BootstrapError.AmbiguousOutcome's own doc (BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP).
            throw BootstrapError.AmbiguousOutcome
        }
    }

    private fun readStatusCode(connection: HttpURLConnection): Int = try {
        connection.responseCode
    } catch (e: CancellationException) {
        throw e
    } catch (e: IOException) {
        // No response arrived at all (timeout / connection reset) -- the true server-side
        // outcome is unknown. See BootstrapError.AmbiguousOutcome.
        throw BootstrapError.AmbiguousOutcome
    }

    private fun parseSuccessBody(bodyText: String): DeviceBootstrapResult {
        val json = try {
            JSONObject(bodyText)
        } catch (e: JSONException) {
            // Server said 201 (created) but the body could not be parsed -- something WAS
            // created server-side, but its deviceId cannot be recovered from this response.
            throw BootstrapError.AmbiguousOutcome
        }
        val deviceId = json.optString("deviceId", "")
        val status = json.optString("status", "")
        if (deviceId.isBlank() || status.isBlank()) throw BootstrapError.AmbiguousOutcome
        return DeviceBootstrapResult(deviceId = deviceId, status = status)
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
    private fun readBoundedBody(stream: InputStream?): String {
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
            throw BootstrapError.AmbiguousOutcome
        }
        if (total >= MAX_RESPONSE_BYTES) throw BootstrapError.AmbiguousOutcome
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
        const val MAX_RESPONSE_BYTES = 8 * 1024
        const val DEFAULT_TIMEOUT_MILLIS = 15_000
    }
}
