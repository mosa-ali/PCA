package org.pca.app.runtime.location.geofence

import java.net.HttpURLConnection
import java.net.URL
import java.io.IOException
import java.math.BigDecimal
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.ZoneOffset
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.EpochBounds
import org.pca.app.runtime.sync.DeviceSessionManager
import org.pca.app.runtime.trustset.StrictJsonMemberNames

/** Opaque server delivery row. It is transport state only and is never treated as applied policy. */
data class OpaqueSafeZoneDelivery(
    val zoneId: String,
    val ciphertextB64: String,
    val nonceB64: String,
    val keyEpoch: Int,
    val revision: Long,
    val deliveryState: SafeZoneDeliveryState,
    val updatedAtUtc: String,
)

enum class SafeZoneDeliveryState { PENDING_OFFLINE, READY }

/** Status-only HTTP failure. The server response body is intentionally not retained or exposed. */
class SafeZoneDeliveryHttpFailure(val statusCode: Int) : Exception("safe_zone_delivery_http_$statusCode")

/** The bounded page walk was incomplete, so callers must retain staged state and retry later. */
class SafeZoneDeliveryIncompleteException(message: String) : Exception(message)

/** A successful HTTP response whose body could not be parsed as a delivery page. */
class SafeZoneDeliveryMalformedResponseException(cause: Throwable? = null) :
    Exception("safe_zone_delivery_malformed_response", cause)

/** The authenticated response attempted to supply or alter device/family authority scope. */
class SafeZoneDeliveryAuthorityFailure : Exception("safe_zone_delivery_authority_scope_invalid")

/** Local persistence reported an I/O failure; the cursor must remain retryable. */
class SafeZoneDeliveryPersistenceIoException(cause: Throwable) :
    Exception("safe_zone_delivery_persistence_io", cause)

/** Persisted inbox contents failed integrity/shape validation and require fail-closed handling. */
class SafeZoneDeliveryInboxCorruptException(cause: Throwable? = null) :
    Exception("corrupt_safe_zone_delivery_inbox", cause)

/** A server/local row reused a revision with different opaque bytes. */
class SafeZoneDeliveryRevisionConflictException : Exception("conflicting_safe_zone_delivery_revision")

private data class ParsedSafeZoneDeliveryCursor(val keyEpoch: Int?, val zoneId: String)

/** Accepts old raw zone-ID cursors while binding new cursors to the key epoch they traverse. */
private object SafeZoneDeliveryCursors {
    private const val MAX_CURSOR_BYTES = 160
    private val ZONE_ID = Regex("^[A-Za-z0-9_-]{1,128}$")
    private val VERSIONED = Regex("^v1~([1-9][0-9]{0,9})~([A-Za-z0-9_-]{1,128})$")

    fun parse(value: String): ParsedSafeZoneDeliveryCursor? {
        if (value.toByteArray(Charsets.UTF_8).size > MAX_CURSOR_BYTES) return null
        val match = VERSIONED.matchEntire(value)
        if (match != null) {
            val epoch = match.groupValues[1].toIntOrNull()?.takeIf { it > 0 } ?: return null
            return ParsedSafeZoneDeliveryCursor(epoch, match.groupValues[2])
        }
        return if (ZONE_ID.matches(value)) ParsedSafeZoneDeliveryCursor(null, value) else null
    }

    fun matchesPage(value: String, records: List<OpaqueSafeZoneDelivery>): Boolean {
        val cursor = parse(value) ?: return false
        val last = records.lastOrNull() ?: return false
        if (cursor.zoneId != last.zoneId) return false
        return cursor.keyEpoch == null || records.all { it.keyEpoch == cursor.keyEpoch }
    }

    fun referencesRecord(value: String, records: List<OpaqueSafeZoneDelivery>): Boolean {
        val cursor = parse(value) ?: return false
        return if (cursor.keyEpoch == null) records.any { it.zoneId == cursor.zoneId }
        else records.any { it.zoneId == cursor.zoneId && it.keyEpoch == cursor.keyEpoch }
    }
}

/** Authenticated read-only client for the device-session-scoped Safe Zone delivery route. */
class HttpSafeZoneDeliveryClient(
    private val baseUrl: String,
    private val sessions: DeviceSessionManager,
    allowInsecureLocal: Boolean = false,
) {
    init {
        val endpoint = URL(baseUrl)
        require(endpoint.userInfo == null && endpoint.query == null && endpoint.ref == null)
        require(endpoint.path.isEmpty() || endpoint.path == "/")
        require(endpoint.protocol == "https" || (allowInsecureLocal && endpoint.protocol == "http" &&
            endpoint.host in setOf("localhost", "127.0.0.1", "10.0.2.2")))
    }

    suspend fun fetch(): List<OpaqueSafeZoneDelivery> {
        val token = sessions.requireSessionToken()
        require(token.length in 1..4096 && token.none { it.isWhitespace() || it.code < 32 || it.code == 127 })
        val gathered = mutableListOf<OpaqueSafeZoneDelivery>()
        val seenIds = mutableSetOf<String>()
        val seenCursors = mutableSetOf<String>()
        var cursor: String? = null
        var completed = false
        var pages = 0
        while (pages < MAX_PAGES) {
            sessions.assertCurrentSession(token)
            val page = requestPage(token, cursor)
            sessions.assertCurrentSession(token)
            pages++
            for (record in page.records) {
                require(seenIds.add(record.zoneId)) { "duplicate_safe_zone_across_pages" }
                gathered += record
            }
            val next = page.nextCursor
            if (next == null) {
                completed = true
                break
            }
            require(seenCursors.add(next) && next != cursor) { "safe_zone_delivery_cursor_cycle" }
            cursor = next
        }
        if (!completed) throw SafeZoneDeliveryIncompleteException("safe_zone_delivery_page_limit_exceeded")
        sessions.assertCurrentSession(token)
        return gathered
    }

    /** Fetches and durably stages one page at a time. A later network failure leaves both the
     * completed pages and the exact next cursor available for a relaunch-safe retry. */
    suspend fun synchronize(inbox: PersistentSafeZoneDeliveryInbox) {
        val token = sessions.requireSessionToken()
        require(token.length in 1..4096 && token.none { it.isWhitespace() || it.code < 32 || it.code == 127 })
        val scope = inbox.requireCurrentScope()
        if (scope.deviceId != sessions.configuredDeviceId) throw SafeZoneDeliveryAuthorityFailure()
        var cursor = inbox.nextCursor(scope)
        var pages = 0
        while (pages < MAX_PAGES) {
            sessions.assertCurrentSession(token)
            val page = requestPage(token, cursor)
            sessions.assertCurrentSession(token)
            inbox.stagePage(scope, page.records, requestedCursor = cursor, nextCursor = page.nextCursor)
            pages++
            cursor = page.nextCursor ?: return
        }
        throw SafeZoneDeliveryIncompleteException("safe_zone_delivery_page_limit_exceeded")
    }

    private suspend fun requestPage(token: String, cursor: String?): DeliveryPage = suspendCancellableCoroutine { continuation ->
        val activeConnection = AtomicReference<HttpURLConnection?>(null)
        continuation.invokeOnCancellation { activeConnection.get()?.disconnect() }
        Dispatchers.IO.dispatch(continuation.context, Runnable {
            if (!continuation.isActive) return@Runnable
            var connection: HttpURLConnection? = null
            try {
                val url = baseUrl.trimEnd('/') + "/v1/runtime-sync/safe-zones" + (cursor?.let { "?cursor=$it" } ?: "")
                connection = URL(url).openConnection() as HttpURLConnection
                activeConnection.set(connection)
                if (!continuation.isActive) return@Runnable
                connection.instanceFollowRedirects = false
                connection.requestMethod = "GET"
                connection.connectTimeout = 15_000
                connection.readTimeout = 15_000
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("Accept", "application/json")
                val status = connection.responseCode
                if (status == 401) sessions.invalidateRejectedSession(token)
                if (status !in 200..299) throw SafeZoneDeliveryHttpFailure(status)
                val bytes = connection.inputStream.use { stream ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        if (!continuation.isActive) throw kotlinx.coroutines.CancellationException("safe_zone_delivery_cancelled")
                        val count = stream.read(buffer)
                        if (count < 0) break
                        if (output.size() + count > MAX_RESPONSE_BYTES) throw SafeZoneDeliveryMalformedResponseException()
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                val responseText = try {
                    StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(bytes))
                        .toString()
                } catch (malformed: java.nio.charset.CharacterCodingException) {
                    throw SafeZoneDeliveryMalformedResponseException(malformed)
                }
                val page = try {
                    decodeResponse(responseText, cursor)
                } catch (malformed: org.json.JSONException) {
                    throw SafeZoneDeliveryMalformedResponseException(malformed)
                }
                if (continuation.isActive) continuation.resumeWith(Result.success(page))
            } catch (failure: Exception) {
                if (continuation.isActive) continuation.resumeWith(Result.failure(failure))
            } finally {
                connection?.disconnect()
                if (connection != null) activeConnection.compareAndSet(connection, null)
            }
        })
    }

    private fun decodeResponse(raw: String, requestedCursor: String?): DeliveryPage = try {
        decodeResponseStrict(raw, requestedCursor)
    } catch (authority: SafeZoneDeliveryAuthorityFailure) {
        throw authority
    } catch (malformed: SafeZoneDeliveryMalformedResponseException) {
        throw malformed
    } catch (cancelled: kotlinx.coroutines.CancellationException) {
        throw cancelled
    } catch (malformed: org.json.JSONException) {
        throw SafeZoneDeliveryMalformedResponseException(malformed)
    } catch (malformed: IllegalArgumentException) {
        throw SafeZoneDeliveryMalformedResponseException(malformed)
    } catch (malformed: ArithmeticException) {
        throw SafeZoneDeliveryMalformedResponseException(malformed)
    } catch (malformed: IllegalStateException) {
        throw SafeZoneDeliveryMalformedResponseException(malformed)
    } catch (malformed: IndexOutOfBoundsException) {
        throw SafeZoneDeliveryMalformedResponseException(malformed)
    }

    private fun decodeResponseStrict(raw: String, requestedCursor: String?): DeliveryPage {
        require(raw.length <= MAX_RESPONSE_BYTES)
        // JSONObject keeps the last duplicate member, which can make a delivery page or
        // cursor ambiguous across clients. Reject duplicates before any row is staged.
        StrictJsonMemberNames.requireUnique(raw)
        val response = JSONObject(raw)
        if (response.keys().asSequence().any { it in AUTHORITY_KEYS }) throw SafeZoneDeliveryAuthorityFailure()
        require(response.keys().asSequence().toSet() == setOf("safeZones", "nextCursor"))
        val rows = response.getJSONArray("safeZones")
        require(rows.length() <= PAGE_SIZE)
        val nextCursorValue = response.get("nextCursor")
        val nextCursor = when (nextCursorValue) {
            JSONObject.NULL -> null
            is String -> nextCursorValue.also { require(SafeZoneDeliveryCursors.parse(it) != null) }
            else -> error("invalid_safe_zone_cursor")
        }
        val seenIds = mutableSetOf<String>()
        val records = (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            if (row.keys().asSequence().any { it in AUTHORITY_KEYS }) throw SafeZoneDeliveryAuthorityFailure()
            require(row.keys().asSequence().toSet() == ROW_KEYS)
            val zoneId = row.getString("zoneId")
            require(TOKEN.matches(zoneId) && seenIds.add(zoneId))
            val ciphertext = row.getString("ciphertextB64")
            val nonce = row.getString("nonceB64")
            require(isCanonicalBase64Url(ciphertext, 1, MAX_CIPHERTEXT_BYTES))
            require(isCanonicalBase64Url(nonce, MIN_NONCE_BYTES, MAX_NONCE_BYTES))
            val keyEpoch = EpochBounds.decodeJson(row, "keyEpoch").also { require(it >= 1) }
            val revision = decodeRevision(row.get("revision"))
            val deliveryState = SafeZoneDeliveryState.valueOf(row.getString("deliveryState"))
            val updatedAtUtc = row.getString("updatedAtUtc")
            require(isCanonicalUtc(updatedAtUtc))
            OpaqueSafeZoneDelivery(zoneId, ciphertext, nonce, keyEpoch, revision, deliveryState, updatedAtUtc)
        }
        require(records.zipWithNext().all { (first, second) -> first.zoneId < second.zoneId })
        if (requestedCursor != null) require(SafeZoneDeliveryCursors.parse(requestedCursor) != null)
        if (nextCursor != null) {
            require(records.size == PAGE_SIZE && nextCursor != requestedCursor &&
                SafeZoneDeliveryCursors.matchesPage(nextCursor, records))
        }
        return DeliveryPage(records, nextCursor)
    }

    private fun isCanonicalBase64Url(value: String, minBytes: Int, maxBytes: Int): Boolean {
        if (value.isEmpty() || value.any { !(it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '-' || it == '_') }) return false
        val decoded = try { Base64.getUrlDecoder().decode(value) } catch (_: IllegalArgumentException) { return false }
        return decoded.size in minBytes..maxBytes && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == value
    }

    private fun decodeRevision(value: Any): Long {
        val number = value as? Number ?: error("invalid_safe_zone_revision")
        val exact = BigDecimal(number.toString()).toBigIntegerExact()
        require(exact.signum() > 0 && exact <= MAX_REVISION)
        return exact.toLong()
    }

    private fun isCanonicalUtc(value: String): Boolean = try {
        value.length == 24 && UTC_MILLIS.matches(value) &&
            DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'")
                .withZone(ZoneOffset.UTC).format(Instant.parse(value)) == value
    } catch (_: Exception) { false }

    private companion object {
        const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024
        const val MAX_PAGES = 8
        const val PAGE_SIZE = 16
        const val MAX_CIPHERTEXT_BYTES = 65_535
        const val MIN_NONCE_BYTES = 12
        const val MAX_NONCE_BYTES = 64
        val AUTHORITY_KEYS = setOf("familyId", "deviceId", "recipientEndpointId", "trustSetEpoch", "dskKeyId", "signature", "authority")
        val MAX_REVISION = java.math.BigInteger("4294967295")
        val TOKEN = Regex("^[A-Za-z0-9_-]{1,128}$")
        val UTC_MILLIS = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")
        val ROW_KEYS = setOf("zoneId", "ciphertextB64", "nonceB64", "keyEpoch", "revision", "deliveryState", "updatedAtUtc")
    }

    private data class DeliveryPage(val records: List<OpaqueSafeZoneDelivery>, val nextCursor: String?)
}

/**
 * Durable encrypted-at-rest staging for opaque delivery rows. Scope is supplied from local
 * enrollment; server rows never choose their own family/device namespace. Missing rows are retained
 * because the delivery contract has no signed deletion tombstone. A newer local revision cannot be
 * replaced by an older server response, and equal-revision conflicts fail closed.
 */
class PersistentSafeZoneDeliveryInbox(
    private val state: PersistentStateStore,
    private val scopeProvider: () -> GeofenceStorageScope?,
) {
    /** If rollback itself cannot be confirmed, this inbox instance must not publish the cursor. */
    private val failClosedStorageKeys = mutableSetOf<String>()

    fun read(): List<OpaqueSafeZoneDelivery> {
        val scope = currentScope() ?: return emptyList()
        return readSnapshot(scope).records
    }

    fun nextCursor(): String? {
        val scope = currentScope() ?: return null
        return readSnapshot(scope).nextCursor
    }

    internal fun requireCurrentScope(): GeofenceStorageScope =
        currentScope() ?: throw SafeZoneDeliveryAuthorityFailure()

    internal fun nextCursor(scope: GeofenceStorageScope): String? {
        assertCurrentScope(scope)
        return readSnapshot(scope).nextCursor
    }

    fun mergeFetched(records: List<OpaqueSafeZoneDelivery>) {
        val scope = currentScope() ?: throw IllegalStateException("Safe Zone delivery scope is unavailable")
        require(records.map { it.zoneId }.distinct().size == records.size)
        records.forEach(::validatePersistableRecord)
        synchronized(state.coordinationLock) {
            check(currentScope() == scope) { "Safe Zone delivery scope changed" }
            val current = readSnapshot(scope)
            val merged = merge(current.records, records)
            val cursor = current.nextCursor?.takeIf { SafeZoneDeliveryCursors.referencesRecord(it, merged) }
            persist(scope, merged, cursor)
        }
    }

    /** Atomically commits a page and its next cursor. If persistence fails, replaying the request
     * from [requestedCursor] is safe and cannot expose a partially staged page. */
    fun stagePage(scope: GeofenceStorageScope, records: List<OpaqueSafeZoneDelivery>, requestedCursor: String?, nextCursor: String?) {
        validatePage(records, requestedCursor, nextCursor)
        synchronized(state.coordinationLock) {
            assertCurrentScope(scope)
            val current = readSnapshot(scope)
            if (current.nextCursor != requestedCursor) {
                throw SafeZoneDeliveryIncompleteException("safe_zone_delivery_stale_cursor")
            }
            val merged = merge(current.records, records)
            if (nextCursor != null && !SafeZoneDeliveryCursors.referencesRecord(nextCursor, merged)) {
                throw SafeZoneDeliveryIncompleteException("safe_zone_delivery_cursor_record_mismatch")
            }
            persist(scope, merged, nextCursor)
        }
    }

    private fun merge(existingRecords: List<OpaqueSafeZoneDelivery>, incomingRecords: List<OpaqueSafeZoneDelivery>): List<OpaqueSafeZoneDelivery> {
        val existing = existingRecords.associateBy { it.zoneId }
        val merged = existing.toMutableMap()
        for (incoming in incomingRecords) {
            val prior = existing[incoming.zoneId]
            if (prior == null || incoming.revision > prior.revision) {
                merged[incoming.zoneId] = incoming
            } else if (incoming.revision == prior.revision && incoming != prior) {
                throw SafeZoneDeliveryRevisionConflictException()
            }
        }
        return merged.values.sortedBy { it.zoneId }
    }

    private fun validatePage(records: List<OpaqueSafeZoneDelivery>, requestedCursor: String?, nextCursor: String?) {
        require(records.size <= PAGE_SIZE)
        records.forEach(::validatePersistableRecord)
        require(requestedCursor == null || SafeZoneDeliveryCursors.parse(requestedCursor) != null)
        require(nextCursor == null || SafeZoneDeliveryCursors.parse(nextCursor) != null)
        require(records.map { it.zoneId }.distinct().size == records.size)
        require(records.zipWithNext().all { (first, second) -> first.zoneId < second.zoneId })
        if (nextCursor != null) {
            require(records.size == PAGE_SIZE && nextCursor != requestedCursor &&
                SafeZoneDeliveryCursors.matchesPage(nextCursor, records))
        }
    }

    private fun persist(scope: GeofenceStorageScope, records: List<OpaqueSafeZoneDelivery>, nextCursor: String?) {
        val encoded = encode(records, nextCursor)
        if (encoded.length > MAX_STAGED_CHARS) {
            throw SafeZoneDeliveryIncompleteException("safe_zone_delivery_staged_size_limit")
        }
        val storageKey = scope.zoneStoreKey(KEY_PREFIX)
        val previousEncoded = try {
            state.getString(storageKey)
        } catch (failure: Exception) {
            throw SafeZoneDeliveryPersistenceIoException(failure)
        }
        try {
            state.putString(storageKey, encoded)
            state.flush()
            val persisted = readSnapshot(scope)
            check(persisted.records == records && persisted.nextCursor == nextCursor) { "Safe Zone delivery write was not durable" }
        } catch (failure: Exception) {
            try {
                // SharedPreferences.apply() mutates its live map before commit/flush can fail.
                // Restore the previous atomic rows+cursor value in memory first, then request
                // durability for that rollback before exposing the retryable failure.
                if (previousEncoded == null) state.remove(storageKey) else state.putString(storageKey, previousEncoded)
                state.flush()
                check(state.getString(storageKey) == previousEncoded) { "Safe Zone delivery rollback was not durable" }
            } catch (rollbackFailure: Exception) {
                failure.addSuppressed(rollbackFailure)
                failClosedStorageKeys += storageKey
            }
            throw SafeZoneDeliveryPersistenceIoException(failure)
        }
    }

    private data class InboxSnapshot(val records: List<OpaqueSafeZoneDelivery>, val nextCursor: String?)

    private fun readSnapshot(scope: GeofenceStorageScope): InboxSnapshot = synchronized(state.coordinationLock) {
        val storageKey = scope.zoneStoreKey(KEY_PREFIX)
        if (storageKey in failClosedStorageKeys) {
            throw SafeZoneDeliveryPersistenceIoException(IOException("Safe Zone delivery rollback durability is uncertain"))
        }
        val raw = state.getString(storageKey) ?: return@synchronized InboxSnapshot(emptyList(), null)
        try {
            require(raw.length <= MAX_STAGED_CHARS)
            StrictJsonMemberNames.requireUnique(raw)
            val json = JSONObject(raw)
            val version = json.getInt("version")
            require((version == 1 && json.keys().asSequence().toSet() == setOf("version", "records")) ||
                (version == 2 && json.keys().asSequence().toSet() == setOf("version", "records", "nextCursor")))
            val array = json.getJSONArray("records")
            val records = (0 until array.length()).map { index ->
                val row = array.getJSONObject(index)
                require(row.keys().asSequence().toSet() == PERSISTED_ROW_KEYS)
                OpaqueSafeZoneDelivery(
                    row.getString("zoneId"), row.getString("ciphertextB64"), row.getString("nonceB64"),
                    EpochBounds.decodeJson(row, "keyEpoch"), decodeRevision(row.get("revision")),
                    SafeZoneDeliveryState.valueOf(row.getString("deliveryState")), row.getString("updatedAtUtc"),
                ).also(::validatePersistedRecord)
            }.also {
                require(it.map(OpaqueSafeZoneDelivery::zoneId).distinct().size == it.size)
                require(it.zipWithNext().all { (first, second) -> first.zoneId < second.zoneId })
            }
            val nextCursor = if (version == 1 || json.isNull("nextCursor")) null else json.getString("nextCursor")
            require(nextCursor == null || SafeZoneDeliveryCursors.referencesRecord(nextCursor, records))
            InboxSnapshot(records, nextCursor)
        } catch (io: IOException) {
            throw SafeZoneDeliveryPersistenceIoException(io)
        } catch (corrupt: Exception) {
            throw SafeZoneDeliveryInboxCorruptException(corrupt)
        }
    }

    private fun encode(records: List<OpaqueSafeZoneDelivery>, nextCursor: String?): String = JSONObject()
        .put("version", 2)
        .put("nextCursor", nextCursor ?: JSONObject.NULL)
        .put("records", JSONArray().also { array -> records.forEach { row -> array.put(JSONObject()
            .put("zoneId", row.zoneId).put("ciphertextB64", row.ciphertextB64).put("nonceB64", row.nonceB64)
            .put("keyEpoch", row.keyEpoch).put("revision", row.revision).put("deliveryState", row.deliveryState.name)
            .put("updatedAtUtc", row.updatedAtUtc)) } })
        .toString()

    private fun currentScope(): GeofenceStorageScope? = runCatching { scopeProvider() }.getOrNull()?.takeIf { it.isValid() }

    private fun assertCurrentScope(expected: GeofenceStorageScope) {
        if (currentScope() != expected) throw SafeZoneDeliveryAuthorityFailure()
    }

    private fun decodeRevision(value: Any): Long {
        val number = value as? Number ?: error("invalid_safe_zone_revision")
        val exact = BigDecimal(number.toString()).toBigIntegerExact()
        require(exact.signum() > 0 && exact <= MAX_REVISION)
        return exact.toLong()
    }

    /** Validate opaque row shape at every persistence boundary, including callers that bypass HTTP. */
    private fun validatePersistableRecord(record: OpaqueSafeZoneDelivery) {
        require(record.zoneId.matches(TOKEN))
        require(isCanonicalBase64Url(record.ciphertextB64, 1, MAX_CIPHERTEXT_BYTES))
        require(isCanonicalBase64Url(record.nonceB64, MIN_NONCE_BYTES, MAX_NONCE_BYTES))
        require(record.keyEpoch >= 1 && record.revision in 1..MAX_REVISION.toLong())
        require(isCanonicalUtc(record.updatedAtUtc))
    }

    private fun validatePersistedRecord(record: OpaqueSafeZoneDelivery) {
        validatePersistableRecord(record)
        require(SafeZoneDeliveryState.values().contains(record.deliveryState))
    }

    private fun isCanonicalBase64Url(value: String, minBytes: Int, maxBytes: Int): Boolean {
        if (value.isEmpty() || value.any { !(it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '-' || it == '_') }) return false
        val decoded = try { Base64.getUrlDecoder().decode(value) } catch (_: IllegalArgumentException) { return false }
        return decoded.size in minBytes..maxBytes && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == value
    }

    private fun isCanonicalUtc(value: String): Boolean = try {
        value.length == 24 && Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$").matches(value) &&
            DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'")
                .withZone(ZoneOffset.UTC).format(Instant.parse(value)) == value
    } catch (_: Exception) { false }

    private companion object {
        const val KEY_PREFIX = "opaque_safe_zone_delivery_v1"
        const val PAGE_SIZE = 16
        const val MAX_STAGED_CHARS = 16 * 1024 * 1024
        const val MAX_CIPHERTEXT_BYTES = 65_535
        const val MIN_NONCE_BYTES = 12
        const val MAX_NONCE_BYTES = 64
        val MAX_REVISION = java.math.BigInteger("4294967295")
        val TOKEN = Regex("^[A-Za-z0-9_-]{1,128}$")
        val PERSISTED_ROW_KEYS = setOf("zoneId", "ciphertextB64", "nonceB64", "keyEpoch", "revision", "deliveryState", "updatedAtUtc")
    }
}
