package org.pca.app.firstdevice

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
import org.pca.app.enrollment.BootstrapEndpointConfig

/**
 * Wave 6C: client contract for the certified first-device trust-root
 * ceremony endpoints (backend/src/http/routes/firstDeviceBootstrapRoutes.ts):
 *
 *   POST /v1/first-device-bootstrap/challenge -> ceremony/challenge/nonce
 *   POST /v1/first-device-bootstrap/submit    -> ACCEPTED (or 409 rejected)
 *   POST /v1/first-device-bootstrap/status    -> PENDING|APPROVED|COMMITTED|EXPIRED
 *
 * Device authority on every call is ONLY the enrollment attempt's
 * (attemptId, attemptRecoveryToken) credential pair -- the same
 * anti-enumeration vocabulary as the bootstrap endpoints applies (404
 * ceremony_unavailable never distinguishes not-found from not-yet-approved
 * from expired; 409 bootstrap_rejected never reveals a verification
 * cause). The client MUST therefore resolve ambiguity through the status
 * endpoint, never by guessing.
 */
data class FirstDeviceChallenge(
    val ceremonyId: String,
    val challengeId: String,
    val nonce: String,
    /** Server ISO timestamp, echoed VERBATIM into the proof bytes (never re-formatted). */
    val expiresAt: String,
    val familyId: String,
    val deviceId: String,
)

/** External outcomes of a ceremony call; the backend's collapsed vocabulary is preserved, never re-split. */
sealed class FirstDeviceBootstrapError(message: String) : Exception(message) {
    /** 404 ceremony_unavailable -- unknown/expired/not-yet-approved/invalid credential, deliberately indistinguishable. */
    object Unavailable : FirstDeviceBootstrapError("ceremony_unavailable")

    /** 409 bootstrap_rejected -- submit verification failed OR the ceremony already committed different bytes. Resolution requires status(). */
    object Rejected : FirstDeviceBootstrapError("bootstrap_rejected")

    /** 400 invalid_request -- our own request shape is malformed (a caller bug, not a user-recoverable state). */
    object InvalidRequest : FirstDeviceBootstrapError("invalid_request")

    /** No HTTP response at all (timeout/reset/IO) or an unparseable success body -- the true server-side outcome is unknown; resolve via status(). */
    object AmbiguousOutcome : FirstDeviceBootstrapError("ceremony_result_unknown")

    /** Any other status code (e.g. 5xx) -- a response was received; ordinary transient failure. */
    object UnexpectedServerError : FirstDeviceBootstrapError("unexpected_server_error")
}

data class FirstDeviceSubmitOutcome(val status: String) // always "ACCEPTED" when not an exception

data class FirstDeviceStatusOutcome(
    /** One of PENDING, APPROVED, COMMITTED, EXPIRED (server vocabulary). */
    val status: String,
    /** 'ACCEPTED' only for COMMITTED ceremonies whose outcome is the accepted root. */
    val outcome: String?,
)

interface FirstDeviceBootstrapApiClient {
    suspend fun challenge(
        attemptId: String,
        attemptRecoveryToken: String,
        dskKeyId: String,
        dskPublicKeyBase64: String,
    ): FirstDeviceChallenge

    suspend fun submit(
        attemptId: String,
        attemptRecoveryToken: String,
        ceremonyId: String,
        proofBytes: String,
        proofSignature: String,
        epoch1Bytes: String,
        epoch1Signature: String,
        attestationEvidence: String,
    ): FirstDeviceSubmitOutcome

    suspend fun status(attemptId: String, attemptRecoveryToken: String, ceremonyId: String): FirstDeviceStatusOutcome
}

/**
 * Real HTTP transport (java.net.HttpURLConnection; no new dependencies),
 * mirroring [org.pca.app.enrollment.HttpDeviceBootstrapApiClient]'s
 * hardened patterns exactly: eager HTTPS-or-local-dev endpoint validation
 * via [BootstrapEndpointConfig], bounded response reads, cancellation-safe
 * coroutines, and NO logging of credentials, keys, proof bytes, signatures
 * or evidence anywhere (grep-provable: no Log.* call exists in this file).
 */
class HttpFirstDeviceBootstrapApiClient(
    private val config: BootstrapEndpointConfig,
    private val connectTimeoutMillis: Int = DEFAULT_TIMEOUT_MILLIS,
    private val readTimeoutMillis: Int = DEFAULT_TIMEOUT_MILLIS,
) : FirstDeviceBootstrapApiClient {

    override suspend fun challenge(
        attemptId: String,
        attemptRecoveryToken: String,
        dskKeyId: String,
        dskPublicKeyBase64: String,
    ): FirstDeviceChallenge = withContext(Dispatchers.IO) {
        val connection = openConnection(CHALLENGE_PATH)
        try {
            configureRequest(connection)
            val body = JSONObject()
                .put("attemptId", attemptId)
                .put("attemptRecoveryToken", attemptRecoveryToken)
                .put("dskKeyId", dskKeyId)
                .put("dskPublicKey", dskPublicKeyBase64)
            writeRequestBody(connection, body)
            when (val code = readStatusCode(connection)) {
                200 -> parseChallenge(readBoundedBody(connection.inputStream))
                404 -> { drainQuietly(connection.errorStream); throw FirstDeviceBootstrapError.Unavailable }
                400 -> { drainQuietly(connection.errorStream); throw FirstDeviceBootstrapError.InvalidRequest }
                else -> { drainQuietly(connection.errorStream); throw FirstDeviceBootstrapError.UnexpectedServerError }
            }
        } finally {
            connection.disconnect()
        }
    }

    override suspend fun submit(
        attemptId: String,
        attemptRecoveryToken: String,
        ceremonyId: String,
        proofBytes: String,
        proofSignature: String,
        epoch1Bytes: String,
        epoch1Signature: String,
        attestationEvidence: String,
    ): FirstDeviceSubmitOutcome = withContext(Dispatchers.IO) {
        val connection = openConnection(SUBMIT_PATH)
        try {
            configureRequest(connection)
            val body = JSONObject()
                .put("attemptId", attemptId)
                .put("attemptRecoveryToken", attemptRecoveryToken)
                .put("ceremonyId", ceremonyId)
                .put("proofBytes", proofBytes)
                .put("proofSignature", proofSignature)
                .put("epoch1Bytes", epoch1Bytes)
                .put("epoch1Signature", epoch1Signature)
                .put("attestationEvidence", attestationEvidence)
            writeRequestBody(connection, body)
            when (readStatusCode(connection)) {
                200 -> {
                    val status = runCatching { JSONObject(readBoundedBody(connection.inputStream)).optString("status", "") }
                        .getOrElse { throw FirstDeviceBootstrapError.AmbiguousOutcome }
                    if (status != ACCEPTED_STATUS) throw FirstDeviceBootstrapError.AmbiguousOutcome
                    FirstDeviceSubmitOutcome(status)
                }
                404 -> { drainQuietly(connection.errorStream); throw FirstDeviceBootstrapError.Unavailable }
                409 -> { drainQuietly(connection.errorStream); throw FirstDeviceBootstrapError.Rejected }
                400 -> { drainQuietly(connection.errorStream); throw FirstDeviceBootstrapError.InvalidRequest }
                else -> { drainQuietly(connection.errorStream); throw FirstDeviceBootstrapError.UnexpectedServerError }
            }
        } finally {
            connection.disconnect()
        }
    }

    override suspend fun status(attemptId: String, attemptRecoveryToken: String, ceremonyId: String): FirstDeviceStatusOutcome =
        withContext(Dispatchers.IO) {
            val connection = openConnection(STATUS_PATH)
            try {
                configureRequest(connection)
                val body = JSONObject()
                    .put("attemptId", attemptId)
                    .put("attemptRecoveryToken", attemptRecoveryToken)
                    .put("ceremonyId", ceremonyId)
                writeRequestBody(connection, body)
                when (readStatusCode(connection)) {
                    200 -> {
                        val json = runCatching { JSONObject(readBoundedBody(connection.inputStream)) }
                            .getOrElse { throw FirstDeviceBootstrapError.AmbiguousOutcome }
                        val status = json.optString("status", "")
                        if (status.isBlank()) throw FirstDeviceBootstrapError.AmbiguousOutcome
                        val outcome = json.optString("outcome", "").ifBlank { null }
                        FirstDeviceStatusOutcome(status = status, outcome = outcome)
                    }
                    404 -> { drainQuietly(connection.errorStream); throw FirstDeviceBootstrapError.Unavailable }
                    400 -> { drainQuietly(connection.errorStream); throw FirstDeviceBootstrapError.InvalidRequest }
                    else -> { drainQuietly(connection.errorStream); throw FirstDeviceBootstrapError.UnexpectedServerError }
                }
            } finally {
                connection.disconnect()
            }
        }

    private fun openConnection(path: String): HttpURLConnection = try {
        URL("${config.baseUrl}$path").openConnection() as HttpURLConnection
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        throw FirstDeviceBootstrapError.AmbiguousOutcome
    }

    private fun configureRequest(connection: HttpURLConnection) {
        connection.requestMethod = "POST"
        connection.setRequestProperty("content-type", "application/json")
        connection.setRequestProperty("accept", "application/json")
        connection.connectTimeout = connectTimeoutMillis
        connection.readTimeout = readTimeoutMillis
        connection.doOutput = true
    }

    private fun writeRequestBody(connection: HttpURLConnection, body: JSONObject) {
        try {
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw FirstDeviceBootstrapError.AmbiguousOutcome
        }
    }

    private fun readStatusCode(connection: HttpURLConnection): Int = try {
        connection.responseCode
    } catch (e: CancellationException) {
        throw e
    } catch (e: IOException) {
        throw FirstDeviceBootstrapError.AmbiguousOutcome
    }

    private fun parseChallenge(bodyText: String): FirstDeviceChallenge {
        val json = try {
            JSONObject(bodyText)
        } catch (e: JSONException) {
            throw FirstDeviceBootstrapError.AmbiguousOutcome
        }
        val ceremonyId = json.optString("ceremonyId", "")
        val challengeId = json.optString("challengeId", "")
        val nonce = json.optString("nonce", "")
        val expiresAt = json.optString("expiresAt", "")
        val familyId = json.optString("familyId", "")
        val deviceId = json.optString("deviceId", "")
        if (ceremonyId.isBlank() || challengeId.isBlank() || nonce.isBlank() || expiresAt.isBlank() || familyId.isBlank() || deviceId.isBlank()) {
            throw FirstDeviceBootstrapError.AmbiguousOutcome
        }
        return FirstDeviceChallenge(ceremonyId, challengeId, nonce, expiresAt, familyId, deviceId)
    }

    /** Bounded read: never buffers more than [MAX_RESPONSE_BYTES]; a filled buffer is treated as unparseable. */
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
            throw FirstDeviceBootstrapError.AmbiguousOutcome
        }
        if (total >= MAX_RESPONSE_BYTES) throw FirstDeviceBootstrapError.AmbiguousOutcome
        return String(buffer, 0, total, Charsets.UTF_8)
    }

    private fun drainQuietly(stream: InputStream?) {
        if (stream == null) return
        try {
            val buffer = ByteArray(MAX_RESPONSE_BYTES)
            stream.use { input -> while (input.read(buffer) != -1) { /* discard */ } }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            // The status code already fully determined the outcome.
        }
    }

    private companion object {
        const val CHALLENGE_PATH = "/v1/first-device-bootstrap/challenge"
        const val SUBMIT_PATH = "/v1/first-device-bootstrap/submit"
        const val STATUS_PATH = "/v1/first-device-bootstrap/status"
        const val ACCEPTED_STATUS = "ACCEPTED"
        const val MAX_RESPONSE_BYTES = 8 * 1024
        const val DEFAULT_TIMEOUT_MILLIS = 15_000
    }
}
