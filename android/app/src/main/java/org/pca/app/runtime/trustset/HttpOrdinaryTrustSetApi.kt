package org.pca.app.runtime.trustset

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.Base64
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
                val responseBody = decodeOrdinaryTrustSetJson(bytes)
                StrictJsonObjectKeys.requireUnique(responseBody)
                val json = JSONObject(responseBody)
                require(json.keys().asSequence().toSet() == setOf(field))
                record(json.getJSONObject(field))
            } finally { connection.disconnect() }
        }
        sessions.assertCurrentSession(token)
        return result
    }
    private suspend fun contact(familyId: String, request: OrdinaryEpochRequest, status: Boolean): OrdinaryEpochResponse {
        val body = encodeRequestBody(request)
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
                connection.setFixedLengthStreamingMode(body.size)
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
                val responseBody = decodeOrdinaryTrustSetJson(bytes)
                StrictJsonObjectKeys.requireUnique(responseBody)
                val json = JSONObject(responseBody)
                require(json.keys().asSequence().toSet() == setOf("outcome", "acceptedEpoch", "acceptedHead"))
                val outcome = OrdinaryEpochOutcome.valueOf(json.getString("outcome"))
                require(if (status) outcome != OrdinaryEpochOutcome.IDEMPOTENT_MATCH else
                    outcome == OrdinaryEpochOutcome.ACCEPTED || outcome == OrdinaryEpochOutcome.IDEMPOTENT_MATCH)
                val acceptedEpoch = if (json.isNull("acceptedEpoch")) null else record(json.getJSONObject("acceptedEpoch"))
                val acceptedHead = record(json.getJSONObject("acceptedHead"))
                if (status) {
                    when (outcome) {
                        OrdinaryEpochOutcome.ACCEPTED -> require(acceptedEpoch?.request == request)
                        OrdinaryEpochOutcome.NOT_ACCEPTED,
                        OrdinaryEpochOutcome.CONFLICT -> require(acceptedEpoch == null)
                        OrdinaryEpochOutcome.IDEMPOTENT_MATCH -> error("invalid_status_outcome")
                    }
                } else {
                    // Both successful submission outcomes describe this exact immutable request.
                    require(acceptedEpoch?.request == request)
                }
                acceptedEpoch?.let {
                    require(acceptedHead.trustSetEpoch >= it.trustSetEpoch && acceptedHead.keyEpoch >= it.keyEpoch)
                    if (acceptedHead.trustSetEpoch == it.trustSetEpoch) require(acceptedHead == it)
                }
                OrdinaryEpochResponse(outcome, acceptedEpoch, acceptedHead)
            } finally { connection.disconnect() }
        }
        sessions.assertCurrentSession(token)
        return result
    }

    /** Keep the device client inside the ordinary transport's canonical-byte and HTTP body caps. */
    private fun encodeRequestBody(request: OrdinaryEpochRequest): ByteArray {
        require(request.canonicalEpochBase64.length in 4..OrdinaryEpochHttpRequestBounds.MAX_CANONICAL_BASE64_CHARS &&
            request.canonicalEpochBase64.length % 4 == 0)
        val canonicalBytes = Base64.getDecoder().decode(request.canonicalEpochBase64)
        OrdinaryEpochHttpRequestBounds.requireCanonicalByteCount(canonicalBytes.size)
        require(Base64.getEncoder().encodeToString(canonicalBytes) == request.canonicalEpochBase64)
        val decodedEpoch = TrustSetEpochCodec.decodeCanonical(canonicalBytes)
        require(TrustSetEpochCodec.canonicalize(decodedEpoch).toByteArray(Charsets.UTF_8).contentEquals(canonicalBytes))
        require(request.signatureBase64.length == 88)
        val signatureBytes = Base64.getDecoder().decode(request.signatureBase64)
        require(signatureBytes.size == 64 && Base64.getEncoder().encodeToString(signatureBytes) == request.signatureBase64)

        return JSONObject().put("canonicalEpochBase64", request.canonicalEpochBase64)
            .put("signatureBase64", request.signatureBase64).toString().toByteArray(Charsets.UTF_8)
            .also { OrdinaryEpochHttpRequestBounds.requireJsonBodyByteCount(it.size) }
    }

    private fun record(json: JSONObject): AcceptedEpochRecord {
        require(json.keys().asSequence().toSet() == setOf("canonicalEpochBase64", "signatureBase64", "signerDeviceId",
            "signerKeyId", "trustSetEpoch", "keyEpoch"))
        return AcceptedEpochRecord(OrdinaryEpochRequest(json.getString("canonicalEpochBase64"), json.getString("signatureBase64")),
            json.getString("signerDeviceId"), json.getString("signerKeyId"), EpochBounds.decodeJson(json, "trustSetEpoch"), EpochBounds.decodeJson(json, "keyEpoch"))
    }

}

/** HTTP JSON is UTF-8; reject malformed byte sequences instead of replacing them with U+FFFD. */
internal fun decodeOrdinaryTrustSetJson(bytes: ByteArray): String = StandardCharsets.UTF_8.newDecoder()
    .onMalformedInput(CodingErrorAction.REPORT)
    .onUnmappableCharacter(CodingErrorAction.REPORT)
    .decode(ByteBuffer.wrap(bytes))
    .toString()

/** Server-aligned limits for ordinary POST requests; bootstrap and inbound record caps are separate. */
internal object OrdinaryEpochHttpRequestBounds {
    const val MAX_CANONICAL_BYTES = 196_506
    const val MAX_CANONICAL_BASE64_CHARS = 4 * ((MAX_CANONICAL_BYTES + 2) / 3)
    const val MAX_JSON_BODY_BYTES = 262_144

    fun requireCanonicalByteCount(size: Int) {
        require(size in 1..MAX_CANONICAL_BYTES)
    }

    fun requireJsonBodyByteCount(size: Int) {
        require(size in 1..MAX_JSON_BODY_BYTES)
    }
}

/** JSON object member names must be unique before JSONObject's last-value-wins parser runs. */
private object StrictJsonObjectKeys {
    fun requireUnique(source: String) = Scanner(source).scan()

    private class Scanner(private val source: String) {
        private var offset = 0

        fun scan() {
            whitespace()
            value(0)
            whitespace()
            require(offset == source.length) { "invalid_json_response" }
        }

        private fun value(depth: Int) {
            require(depth <= MAX_DEPTH) { "invalid_json_response" }
            whitespace()
            require(offset < source.length) { "invalid_json_response" }
            when (source[offset]) {
                '{' -> objectValue(depth + 1)
                '[' -> arrayValue(depth + 1)
                '"' -> stringValue()
                't' -> literal("true")
                'f' -> literal("false")
                'n' -> literal("null")
                '-', in '0'..'9' -> numberValue()
                else -> error("invalid_json_response")
            }
        }

        private fun objectValue(depth: Int) {
            offset++ // {
            whitespace()
            if (consume('}')) return
            val names = HashSet<String>()
            while (true) {
                whitespace()
                require(offset < source.length && source[offset] == '"') { "invalid_json_response" }
                val name = stringValue()
                require(names.add(name)) { "duplicate_json_object_key" }
                whitespace()
                expect(':')
                value(depth)
                whitespace()
                if (consume('}')) return
                expect(',')
            }
        }

        private fun arrayValue(depth: Int) {
            offset++ // [
            whitespace()
            if (consume(']')) return
            while (true) {
                value(depth)
                whitespace()
                if (consume(']')) return
                expect(',')
            }
        }

        private fun stringValue(): String {
            expect('"')
            val result = StringBuilder()
            while (offset < source.length) {
                val character = source[offset++]
                when {
                    character == '"' -> return result.toString()
                    character == '\\' -> {
                        require(offset < source.length) { "invalid_json_response" }
                        when (val escaped = source[offset++]) {
                            '"', '\\', '/' -> result.append(escaped)
                            'b' -> result.append('\b')
                            'f' -> result.append('\u000c')
                            'n' -> result.append('\n')
                            'r' -> result.append('\r')
                            't' -> result.append('\t')
                            'u' -> {
                                require(offset + 4 <= source.length) { "invalid_json_response" }
                                val codeUnit = source.substring(offset, offset + 4).toIntOrNull(16)
                                    ?: error("invalid_json_response")
                                result.append(codeUnit.toChar())
                                offset += 4
                            }
                            else -> error("invalid_json_response")
                        }
                    }
                    character.code < 0x20 -> error("invalid_json_response")
                    else -> result.append(character)
                }
            }
            error("invalid_json_response")
        }

        private fun numberValue() {
            if (consume('-')) require(offset < source.length) { "invalid_json_response" }
            if (consume('0')) {
                require(offset >= source.length || source[offset] !in '0'..'9') { "invalid_json_response" }
            } else {
                require(offset < source.length && source[offset] in '1'..'9') { "invalid_json_response" }
                while (offset < source.length && source[offset] in '0'..'9') offset++
            }
            if (consume('.')) {
                require(offset < source.length && source[offset] in '0'..'9') { "invalid_json_response" }
                while (offset < source.length && source[offset] in '0'..'9') offset++
            }
            if (offset < source.length && source[offset] in "eE") {
                offset++
                if (offset < source.length && source[offset] in "+-") offset++
                require(offset < source.length && source[offset] in '0'..'9') { "invalid_json_response" }
                while (offset < source.length && source[offset] in '0'..'9') offset++
            }
        }

        private fun literal(value: String) {
            require(source.startsWith(value, offset)) { "invalid_json_response" }
            offset += value.length
        }

        private fun whitespace() {
            while (offset < source.length && source[offset] in charArrayOf(' ', '\t', '\r', '\n')) offset++
        }

        private fun expect(character: Char) {
            require(consume(character)) { "invalid_json_response" }
        }

        private fun consume(character: Char): Boolean {
            if (offset >= source.length || source[offset] != character) return false
            offset++
            return true
        }
    }

    private const val MAX_DEPTH = 64
}
