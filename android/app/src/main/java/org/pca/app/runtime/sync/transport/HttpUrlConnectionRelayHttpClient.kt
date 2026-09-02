package org.pca.app.runtime.sync.transport

import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Real HTTP transport using `java.net.HttpURLConnection` -- a JDK/Android
 * SDK class, not a Gradle dependency, so this needs no `build.gradle.kts`
 * change (the Android tree has no OkHttp/Ktor dependency yet -- see doc 40
 * Section 8 / lane brief Section 8's own note that transport library
 * selection was explicitly deferred). Every call runs on `Dispatchers.IO`.
 *
 * [baseUrl] is validated eagerly at construction, exactly as
 * [org.pca.app.enrollment.BootstrapEndpointConfig] validates the bootstrap
 * endpoint: a misconfigured build must fail closed at composition time
 * rather than silently carrying device session tokens and relay envelopes
 * over an insecure channel. Non-HTTPS is only ever permitted for the
 * well-known local-development hosts, and only when [allowInsecureHttp] is
 * explicitly set -- the same "never silently downgrade" posture used
 * throughout this codebase (see also RejectingEnvelopeSignatureVerifier).
 */
class HttpUrlConnectionRelayHttpClient(
    private val baseUrl: String,
    allowInsecureHttp: Boolean = false,
) : RelayHttpClient {

    init {
        val isHttps = baseUrl.startsWith("https://", ignoreCase = true)
        val host = runCatching { URL(baseUrl).host }.getOrNull()
        val isLocalDevHost = host != null && LOCAL_DEV_HOSTS.contains(host)
        require(isHttps || (allowInsecureHttp && isLocalDevHost)) {
            "Refusing to configure an insecure (non-HTTPS) relay endpoint '$baseUrl' -- " +
                "only localhost/10.0.2.2 development hosts may use HTTP, and only with allowInsecureHttp=true."
        }
    }

    private suspend fun request(path: String, method: String, sessionToken: String?, body: JSONObject?): JSONObject =
        withContext(Dispatchers.IO) {
            val connection = try {
                URL("$baseUrl$path").openConnection() as HttpURLConnection
            } catch (e: Exception) {
                throw RelayHttpException(RelayHttpErrorCode.Network, "Could not open connection: ${e.message}")
            }
            try {
                connection.requestMethod = method
                connection.setRequestProperty("content-type", "application/json")
                if (sessionToken != null) connection.setRequestProperty("authorization", "Bearer $sessionToken")
                connection.connectTimeout = 15_000
                connection.readTimeout = 15_000

                if (body != null) {
                    connection.doOutput = true
                    OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
                }

                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
                val parsed = if (text.isNotBlank()) JSONObject(text) else JSONObject()

                if (status in 200..299) return@withContext parsed
                if (status == 401) throw RelayHttpException(RelayHttpErrorCode.Unauthorized, "Authentication failed.")
                if (status in 400..499) throw RelayHttpException(RelayHttpErrorCode.InvalidRequest, "Request was rejected.")
                throw RelayHttpException(RelayHttpErrorCode.Unknown, "Unexpected server response: $status")
            } catch (e: RelayHttpException) {
                throw e
            } catch (e: Exception) {
                throw RelayHttpException(RelayHttpErrorCode.Network, "The request could not be completed: ${e.message}")
            } finally {
                connection.disconnect()
            }
        }

    override suspend fun issueChallenge(deviceId: String): ChallengeResponse {
        val response = request("/v1/runtime-sync/devices/$deviceId/challenge", "POST", null, null)
        return ChallengeResponse(response.getString("challengeId"), response.getString("nonce"), response.getString("expiresAt"))
    }

    override suspend fun completeChallenge(deviceId: String, challengeId: String, signature: String): DeviceSessionInfo {
        val body = JSONObject().put("challengeId", challengeId).put("signature", signature)
        val response = request("/v1/runtime-sync/devices/$deviceId/session", "POST", null, body)
        return DeviceSessionInfo(response.getString("sessionToken"), response.getString("expiresAt"))
    }

    override suspend fun submitOutbound(sessionToken: String, items: List<OutboundSubmitItem>): OutboundBatchResult {
        val itemsArray = JSONArray()
        for (item in items) {
            val itemJson = JSONObject()
                .put("messageId", item.messageId)
                .put("recipientDeviceId", item.recipientDeviceId)
                .put("ciphertext", item.ciphertextBase64)
                .put("messageType", item.messageType)
                .put("enqueuedAtEpochMillis", item.enqueuedAtEpochMillis)
            if (item.ttlMillis != null) itemJson.put("ttlMs", item.ttlMillis)
            itemsArray.put(itemJson)
        }
        val response = request("/v1/runtime-sync/outbound", "POST", sessionToken, JSONObject().put("items", itemsArray))

        val results = mutableListOf<OutboundItemOutcome>()
        val resultsArray = response.getJSONArray("results")
        for (i in 0 until resultsArray.length()) {
            val entry = resultsArray.getJSONObject(i)
            results.add(OutboundItemOutcome(entry.getString("messageId"), entry.getString("outcome")))
        }
        val dropped = mutableListOf<String>()
        val droppedArray = response.getJSONArray("droppedForBatchBound")
        for (i in 0 until droppedArray.length()) dropped.add(droppedArray.getString(i))

        return OutboundBatchResult(results, dropped)
    }

    override suspend fun listInbound(sessionToken: String): InboundListResult {
        val response = request("/v1/runtime-sync/inbound", "GET", sessionToken, null)
        val applied = mutableListOf<InboundAppliedEnvelope>()
        val appliedArray = response.getJSONArray("applied")
        for (i in 0 until appliedArray.length()) {
            val entry = appliedArray.getJSONObject(i)
            applied.add(InboundAppliedEnvelope(entry.getString("messageId"), entry.getString("senderDeviceId"), entry.getString("messageType"), entry.getString("payload")))
        }
        val unparseable = mutableListOf<String>()
        val unparseableArray = response.getJSONArray("unparseableMessageIds")
        for (i in 0 until unparseableArray.length()) unparseable.add(unparseableArray.getString(i))
        val dropped = mutableListOf<String>()
        val droppedArray = response.getJSONArray("droppedForListBound")
        for (i in 0 until droppedArray.length()) dropped.add(droppedArray.getString(i))

        return InboundListResult(applied, unparseable, dropped)
    }

    override suspend fun acknowledgeInbound(sessionToken: String, messageId: String) {
        request("/v1/runtime-sync/inbound/$messageId/ack", "POST", sessionToken, null)
    }

    override suspend fun getStatus(sessionToken: String): String {
        val response = request("/v1/runtime-sync/status", "GET", sessionToken, null)
        return response.getString("connectionState")
    }

    /**
     * Follows the six methods above exactly: one route, one authenticated `request(...)` call, no
     * generic escape hatch. The route answers 204 with an empty body, which [request] already
     * normalizes to an empty [JSONObject], so there is nothing to parse -- a non-2xx status still
     * surfaces as the same typed [RelayHttpException] every other method here throws, so the caller
     * can never mistake a rejected report for a delivered one.
     */
    override suspend fun reportProtectionStatus(sessionToken: String, protectionLevel: RelayProtectionLevel) {
        request(
            "/v1/runtime-sync/protection-status",
            "POST",
            sessionToken,
            JSONObject().put("protectionLevel", protectionLevel.name),
        )
    }

    private companion object {
        val LOCAL_DEV_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2")
    }
}
