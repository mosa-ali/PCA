package org.pca.app.runtime.trustset

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.pca.app.runtime.sync.DeviceSessionManager
import org.pca.app.runtime.EpochBounds

/** Authenticated bounded transport; never follows redirects carrying device credentials. */
class HttpOrdinaryTrustSetApi(private val baseUrl: String, private val sessions: DeviceSessionManager,
    allowInsecureLocal: Boolean = false) : OrdinaryTrustSetApi {
    init {
        val endpoint = URL(baseUrl)
        require(endpoint.userInfo == null && endpoint.query == null && endpoint.ref == null)
        require(endpoint.path.isEmpty() || endpoint.path == "/")
        require(endpoint.protocol == "https" || (allowInsecureLocal && endpoint.protocol == "http" &&
            endpoint.host in setOf("localhost", "127.0.0.1", "10.0.2.2")))
    }
    override suspend fun submit(familyId: String, request: OrdinaryEpochRequest) = contact(familyId, request, false)
    override suspend fun status(familyId: String, request: OrdinaryEpochRequest) = contact(familyId, request, true)
    override suspend fun getEpoch(familyId: String, trustSetEpoch: Int): AcceptedEpochRecord {
        require(trustSetEpoch >= 1)
        return readRecord(familyId, "/records/$trustSetEpoch", "acceptedEpoch")
    }
    override suspend fun getHead(familyId: String): AcceptedEpochRecord = readRecord(familyId, "/head", "acceptedHead")
    private suspend fun readRecord(familyId: String, suffix: String, field: String): AcceptedEpochRecord {
        val token = sessions.requireSessionToken()
        require(token.length in 1..4096 && token.none { it.isWhitespace() || it.code < 32 || it.code == 127 })
        val result = withContext(Dispatchers.IO) {
            val family = URLEncoder.encode(familyId, "UTF-8").replace("+", "%20")
            val connection = URL(baseUrl.trimEnd('/') + "/api/device/families/$family/trust-set/epochs$suffix")
                .openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.requestMethod = "GET"
                connection.connectTimeout = 15000; connection.readTimeout = 15000
                connection.setRequestProperty("Authorization", "Bearer $token")
                val code = connection.responseCode
                if (code == 401) sessions.invalidateRejectedSession(token)
                require(code in 200..299) { "ordinary_trust_set_unavailable" }
                val bytes = connection.inputStream.use { stream ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = stream.read(buffer); if (count < 0) break
                        require(output.size() + count <= 2097152); output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                val json = JSONObject(bytes.toString(Charsets.UTF_8))
                require(json.keys().asSequence().toSet() == setOf(field))
                record(json.getJSONObject(field))
            } finally { connection.disconnect() }
        }
        sessions.assertCurrentSession(token)
        return result
    }
    private suspend fun contact(familyId: String, request: OrdinaryEpochRequest, status: Boolean): OrdinaryEpochResponse {
        val token = sessions.requireSessionToken()
        require(token.length in 1..4096 && token.none { it.isWhitespace() || it.code < 32 || it.code == 127 })
        val result = withContext(Dispatchers.IO) {
            val family = URLEncoder.encode(familyId, "UTF-8").replace("+", "%20")
            val connection = URL(baseUrl.trimEnd('/') + "/api/device/families/$family/trust-set/epochs" +
                if (status) "/status" else "").openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.requestMethod = "POST"
                connection.connectTimeout = 15000
                connection.readTimeout = 15000
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                val body = JSONObject().put("canonicalEpochBase64", request.canonicalEpochBase64)
                    .put("signatureBase64", request.signatureBase64).toString().toByteArray(Charsets.UTF_8)
                require(body.size <= 2097152)
                connection.outputStream.use { it.write(body) }
                val code = connection.responseCode
                if (code == 401) sessions.invalidateRejectedSession(token)
                require(code in 200..299) { "ordinary_trust_set_unavailable" }
                val bytes = connection.inputStream.use { stream ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = stream.read(buffer)
                        if (count < 0) break
                        require(output.size() + count <= 4194304)
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                val json = JSONObject(bytes.toString(Charsets.UTF_8))
                require(json.keys().asSequence().toSet() == setOf("outcome", "acceptedEpoch", "acceptedHead"))
                val outcome = OrdinaryEpochOutcome.valueOf(json.getString("outcome"))
                require(if (status) outcome != OrdinaryEpochOutcome.IDEMPOTENT_MATCH else
                    outcome == OrdinaryEpochOutcome.ACCEPTED || outcome == OrdinaryEpochOutcome.IDEMPOTENT_MATCH)
                OrdinaryEpochResponse(outcome, if (json.isNull("acceptedEpoch")) null else record(json.getJSONObject("acceptedEpoch")),
                    record(json.getJSONObject("acceptedHead")))
            } finally { connection.disconnect() }
        }
        sessions.assertCurrentSession(token)
        return result
    }
    private fun record(json: JSONObject): AcceptedEpochRecord {
        require(json.keys().asSequence().toSet() == setOf("canonicalEpochBase64", "signatureBase64", "signerDeviceId",
            "signerKeyId", "trustSetEpoch", "keyEpoch"))
        return AcceptedEpochRecord(OrdinaryEpochRequest(json.getString("canonicalEpochBase64"), json.getString("signatureBase64")),
            json.getString("signerDeviceId"), json.getString("signerKeyId"), EpochBounds.decodeJson(json, "trustSetEpoch"), EpochBounds.decodeJson(json, "keyEpoch"))
    }
}
