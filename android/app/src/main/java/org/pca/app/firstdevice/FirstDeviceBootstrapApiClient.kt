package org.pca.app.firstdevice

import java.io.IOException
import java.io.InputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import org.pca.app.enrollment.BootstrapEndpointConfig
import org.pca.app.runtime.trustset.StrictJsonMemberNames

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
                200 -> parseFirstDeviceChallenge(readBoundedBody(connection.inputStream))
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
                    parseFirstDeviceSubmitResponse(readBoundedBody(connection.inputStream))
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
                        parseFirstDeviceStatusResponse(readBoundedBody(connection.inputStream))
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
        return try {
            StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(buffer, 0, total))
                .toString()
        } catch (_: Exception) {
            throw FirstDeviceBootstrapError.AmbiguousOutcome
        }
    }

    private fun drainQuietly(stream: InputStream?) {
        if (stream == null) return
        try {
            discardBootstrapErrorResponse(stream, MAX_RESPONSE_BYTES)
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
        const val MAX_RESPONSE_BYTES = 8 * 1024
        const val DEFAULT_TIMEOUT_MILLIS = 15_000
    }
}

/** Parse only the exact successful challenge DTO; coercion could turn malformed identity fields into authority input. */
internal fun parseFirstDeviceChallenge(bodyText: String): FirstDeviceChallenge {
    val json = parseFirstDeviceJson(bodyText, setOf(
            "status", "ceremonyId", "challengeId", "nonce", "expiresAt", "familyId", "deviceId",
        ))
    if (requiredFirstDeviceString(json, "status") != "PENDING") {
        throw FirstDeviceBootstrapError.AmbiguousOutcome
    }
    return FirstDeviceChallenge(
        ceremonyId = requiredFirstDeviceString(json, "ceremonyId"),
        challengeId = requiredFirstDeviceString(json, "challengeId"),
        nonce = requiredFirstDeviceString(json, "nonce"),
        expiresAt = requiredFirstDeviceString(json, "expiresAt"),
        familyId = requiredFirstDeviceString(json, "familyId"),
        deviceId = requiredFirstDeviceString(json, "deviceId"),
    )
}

internal fun parseFirstDeviceSubmitResponse(bodyText: String): FirstDeviceSubmitOutcome {
    val json = parseFirstDeviceJson(bodyText, setOf("status"))
    val status = requiredFirstDeviceString(json, "status")
    if (status != "ACCEPTED") throw FirstDeviceBootstrapError.AmbiguousOutcome
    return FirstDeviceSubmitOutcome(status)
}

internal fun parseFirstDeviceStatusResponse(bodyText: String): FirstDeviceStatusOutcome {
    val json = parseFirstDeviceJson(bodyText, setOf("status", "outcome"))
    val status = requiredFirstDeviceString(json, "status")
    if (status !in setOf("PENDING", "APPROVED", "COMMITTED", "EXPIRED")) {
        throw FirstDeviceBootstrapError.AmbiguousOutcome
    }
    val rawOutcome = json.opt("outcome")
    val outcome = when (rawOutcome) {
        JSONObject.NULL -> null
        is String -> rawOutcome
        else -> throw FirstDeviceBootstrapError.AmbiguousOutcome
    }
    val validCombination = when (status) {
        "COMMITTED" -> outcome == null || outcome == "ACCEPTED"
        else -> outcome == null
    }
    if (!validCombination) throw FirstDeviceBootstrapError.AmbiguousOutcome
    return FirstDeviceStatusOutcome(status, outcome)
}

private fun parseFirstDeviceJson(bodyText: String, expectedKeys: Set<String>): JSONObject {
    try {
        StrictJsonMemberNames.requireUnique(bodyText)
    } catch (_: Exception) {
        throw FirstDeviceBootstrapError.AmbiguousOutcome
    }
    val json = try {
        JSONObject(bodyText)
    } catch (_: JSONException) {
        throw FirstDeviceBootstrapError.AmbiguousOutcome
    }
    if (json.keys().asSequence().toSet() != expectedKeys) throw FirstDeviceBootstrapError.AmbiguousOutcome
    return json
}

private fun requiredFirstDeviceString(json: JSONObject, name: String): String =
    (json.opt(name) as? String)?.takeIf { it.isNotBlank() }
        ?: throw FirstDeviceBootstrapError.AmbiguousOutcome

/** Error classification uses the status code; discarded bodies cannot consume an unbounded stream. */
internal fun discardBootstrapErrorResponse(stream: InputStream, maximumBytes: Int) {
    require(maximumBytes > 0)
    val buffer = ByteArray(minOf(maximumBytes, 8 * 1024))
    stream.use { input ->
        var consumed = 0
        while (consumed < maximumBytes) {
            val count = input.read(buffer, 0, minOf(buffer.size, maximumBytes - consumed))
            if (count == -1) break
            if (count == 0) break
            consumed += count
        }
    }
}
