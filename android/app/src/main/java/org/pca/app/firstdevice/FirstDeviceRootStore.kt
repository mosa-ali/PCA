package org.pca.app.firstdevice

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Base64
import org.pca.app.foundation.PersistentStateStore

/**
 * Wave 6C: durable local state of THIS device's first-device trust-root
 * ceremony. Written in two moments, both BEFORE any irreversible step:
 *
 *  1. [FirstDeviceCeremonySeed] is captured at enrollment completion
 *     (EnrollmentCoordinator.persistSuccess, before the pending-attempt
 *     record is cleared), because the ceremony authenticates with the
 *     attempt's (attemptId, attemptRecoveryToken) credential pair and is
 *     M1-bound to the enrollment DSK. Without this capture a process death
 *     would strand a perfectly committed-capable device with no way to
 *     reach its own ceremony.
 *  2. The submission payload (proof/epoch-1 bytes + signatures + evidence)
 *     is persisted BEFORE the first submit, because ECDSA signatures are
 *     randomized: the backend's commit identity is over the EXACT submitted
 *     bytes, so a re-signed retry after a lost response would 409. Replays
 *     must be byte-identical.
 *
 * The record deliberately contains NO private key material (aliases only --
 * the key lives in the hardware keystore) and NO device-lifecycle field:
 * this store can never move the device lifecycle; server-authoritative
 * acceptance is tracked here and nowhere else.
 */
enum class FirstDeviceRootState {
    /** Seeded from a successful enrollment; no ceremony contact yet. */
    NOT_STARTED,

    /** Challenge obtained; waiting for the parent to approve server-side. */
    AWAITING_APPROVAL,

    /** Server status APPROVED; ready to sign + submit. */
    APPROVED,

    /** Submission payload persisted; submit in flight or outcome ambiguous. */
    SUBMITTING,

    /** Server-authoritative acceptance (status COMMITTED + outcome ACCEPTED). Terminal success. */
    ROOT_COMMITTED,

    /** The ceremony expired before an accepted submission; its persisted submission is trimmed and a NEW ceremony may be started explicitly. */
    EXPIRED,

    /** Server rejected the submission while the ceremony was still APPROVED. Terminal for this ceremony. */
    REJECTED,

    /** Outcome not currently determinable (credential/ceremony ambiguity). Resolve via status(), never by guessing. */
    UNKNOWN,
}

/** Enrollment-time ceremony credentials (captured at persistSuccess). */
data class FirstDeviceCeremonySeed(
    val attemptId: String,
    val attemptRecoveryToken: String,
    val serverBaseUrl: String,
    val deviceId: String,
    val signingKeyId: String,
    val encryptionKeyId: String,
    val dskPublicKeyBase64: String,
    val dekPublicKeyBase64: String,
    val dskAlias: String,
    val dekAlias: String,
)

/** The exact bytes of one submission (persisted before first send; replayed verbatim). */
data class FirstDeviceSubmissionPayload(
    val proofBytes: String,
    val proofSignature: String,
    val epoch1Bytes: String,
    val epoch1Signature: String,
    val attestationEvidence: String,
)

/** Exact signed epoch-1 statement B retained after server-authoritative root acceptance. */
data class FirstDeviceAcceptedEpochAnchor(
    val canonicalBytes: String,
    val signatureBase64Url: String,
)

data class FirstDeviceRootRecord(
    val seed: FirstDeviceCeremonySeed,
    val state: FirstDeviceRootState = FirstDeviceRootState.NOT_STARTED,
    val ceremonyId: String? = null,
    val challengeId: String? = null,
    val nonce: String? = null,
    /** Server ISO string from the challenge response; echoed verbatim into the proof. */
    val expiresAt: String? = null,
    val familyId: String? = null,
    val submission: FirstDeviceSubmissionPayload? = null,
    val committedAtMillis: Long? = null,
    /** Older durable records have no accepted anchor and cannot reconstruct one from server state. */
    val acceptedEpoch1: FirstDeviceAcceptedEpochAnchor? = null,
)

/** Distinguishes an empty slot from unreadable/corrupt root state. */
sealed interface FirstDeviceRootReadResult {
    data object Missing : FirstDeviceRootReadResult
    data object Unreadable : FirstDeviceRootReadResult
    data class Present(val record: FirstDeviceRootRecord) : FirstDeviceRootReadResult
}

interface FirstDeviceRootStore {
    fun current(): FirstDeviceRootRecord?
    /** Typed health read for operations, such as key cleanup, that must fail closed on corruption. */
    fun readState(): FirstDeviceRootReadResult
    /**
     * Runs [cleanup] while the durable root slot is locked only when it is
     * confirmed empty or belongs to a different attempt. Implementations
     * must keep root writes blocked for the duration of the callback so a
     * concurrent seed capture cannot race key deletion. A matching or
     * unreadable root returns false without running [cleanup].
     */
    fun withConfirmedSafeAttemptKeyCleanup(attemptId: String, cleanup: () -> Unit): Boolean
    fun save(record: FirstDeviceRootRecord)
    fun clear()

    /**
     * Atomically persist [record] only when the current full record still
     * equals [expected]. Implementations include the durability barrier and
     * read-back check in this operation. Coordinator snapshots taken before
     * network awaits must use this instead of an unconditional save.
     */
    fun writeIfCurrent(expected: FirstDeviceRootRecord?, record: FirstDeviceRootRecord): Boolean

    /**
     * Captures a seed without erasing an existing ceremony. Same-attempt
     * capture is idempotent and preserves the complete current record. A
     * different attempt may replace an existing record only when its state
     * is in [replaceableTerminalStates]. A preserved record is success: the
     * caller must not overwrite it or discard its owner attempt's keys.
     */
    fun captureSeed(
        candidate: FirstDeviceRootRecord,
        replaceableTerminalStates: Set<FirstDeviceRootState>,
    ): Boolean

    /** Re-confirms durability before any replay of a persisted submission. */
    fun confirmDurable(record: FirstDeviceRootRecord): Boolean

    /**
     * Synchronous durability barrier: returns only after everything written
     * so far is on disk. The first submit MUST be preceded by [flush]
     * (see class doc: a lost, non-persisted submission payload is
     * unrecoverable byte-identically).
     */
    fun flush()
}

/** In-memory reference implementation -- usable for tests/dev builds, NOT durable across process death. */
class InMemoryFirstDeviceRootStore : FirstDeviceRootStore {
    private val lock = Any()
    private var record: FirstDeviceRootRecord? = null
    override fun current(): FirstDeviceRootRecord? = synchronized(lock) { record }
    override fun readState(): FirstDeviceRootReadResult = synchronized(lock) {
        record?.let(FirstDeviceRootReadResult::Present) ?: FirstDeviceRootReadResult.Missing
    }
    override fun withConfirmedSafeAttemptKeyCleanup(attemptId: String, cleanup: () -> Unit): Boolean = synchronized(lock) {
        if (record?.seed?.attemptId == attemptId) return@synchronized false
        cleanup()
        true
    }
    override fun save(record: FirstDeviceRootRecord) { synchronized(lock) { this.record = record } }
    override fun clear() { synchronized(lock) { record = null } }
    override fun writeIfCurrent(expected: FirstDeviceRootRecord?, record: FirstDeviceRootRecord): Boolean = synchronized(lock) {
        if (this.record != expected) return@synchronized false
        this.record = record
        true
    }
    override fun captureSeed(
        candidate: FirstDeviceRootRecord,
        replaceableTerminalStates: Set<FirstDeviceRootState>,
    ): Boolean = synchronized(lock) {
        val existing = record
        if (existing == null) {
            record = candidate
        } else if (existing.seed.attemptId != candidate.seed.attemptId && existing.state in replaceableTerminalStates) {
            record = candidate
        }
        true
    }
    override fun confirmDurable(record: FirstDeviceRootRecord): Boolean = synchronized(lock) { this.record == record }
    override fun flush() { /* nothing to flush */ }
}

/**
 * Durable binding backed by the same OS-protected [PersistentStateStore]
 * every other runtime snapshot uses. Encoding is a flat `|`-joined field
 * list; every field value is guaranteed `|`-free by construction (opaque
 * ids, base64url, ISO timestamps, netstring-encoded proof/epoch strings,
 * and the evidence JSON envelope), and [encode] asserts it. Malformed or
 * legacy records decode to null (fail safe to "no ceremony", never a
 * fabricated state).
 */
class PersistentFirstDeviceRootStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : FirstDeviceRootStore {

    private sealed interface StoredRecord {
        data object Missing : StoredRecord
        data object Invalid : StoredRecord
        data class Valid(val record: FirstDeviceRootRecord) : StoredRecord
    }

    override fun current(): FirstDeviceRootRecord? = synchronized(store.coordinationLock) {
        (readStoredRecord() as? StoredRecord.Valid)?.record
    }

    override fun save(record: FirstDeviceRootRecord) = synchronized(store.coordinationLock) {
        store.putString(key, encode(record))
    }

    override fun clear() = synchronized(store.coordinationLock) {
        store.remove(key)
    }

    override fun writeIfCurrent(expected: FirstDeviceRootRecord?, record: FirstDeviceRootRecord): Boolean = synchronized(store.coordinationLock) {
        when (val stored = readStoredRecord()) {
            StoredRecord.Missing -> if (expected != null) return@synchronized false
            StoredRecord.Invalid -> return@synchronized false
            is StoredRecord.Valid -> if (stored.record != expected) return@synchronized false
        }
        writeDurably(record)
    }

    override fun captureSeed(
        candidate: FirstDeviceRootRecord,
        replaceableTerminalStates: Set<FirstDeviceRootState>,
    ): Boolean = synchronized(store.coordinationLock) {
        val existing = when (val stored = readStoredRecord()) {
            StoredRecord.Missing -> null
            StoredRecord.Invalid -> return@synchronized false
            is StoredRecord.Valid -> stored.record
        }
        if (existing != null) {
            if (existing.seed.attemptId == candidate.seed.attemptId) {
                // A prior write may have updated the in-memory preferences
                // map before its synchronous commit failed. Re-flush and
                // verify the exact full record before accepting same-attempt
                // recovery, while preserving every progressed field.
                return@synchronized confirmDurable(existing)
            }
            if (existing.state !in replaceableTerminalStates) {
                // Preserve a different attempt's live ceremony only after
                // confirming that the exact complete record is durable.
                return@synchronized confirmDurable(existing)
            }
        }
        writeDurably(candidate)
    }

    override fun readState(): FirstDeviceRootReadResult = synchronized(store.coordinationLock) {
        when (val stored = readStoredRecord()) {
            StoredRecord.Missing -> FirstDeviceRootReadResult.Missing
            StoredRecord.Invalid -> FirstDeviceRootReadResult.Unreadable
            is StoredRecord.Valid -> FirstDeviceRootReadResult.Present(stored.record)
        }
    }

    override fun withConfirmedSafeAttemptKeyCleanup(attemptId: String, cleanup: () -> Unit): Boolean = synchronized(store.coordinationLock) {
        when (val stored = readStoredRecord()) {
            StoredRecord.Missing -> {
                cleanup()
                true
            }
            StoredRecord.Invalid -> false
            is StoredRecord.Valid -> if (stored.record.seed.attemptId == attemptId) {
                false
            } else {
                cleanup()
                true
            }
        }
    }

    override fun confirmDurable(record: FirstDeviceRootRecord): Boolean = synchronized(store.coordinationLock) {
        try {
            store.flush()
            (readStoredRecord() as? StoredRecord.Valid)?.record == record
        } catch (_: Exception) {
            false
        }
    }

    override fun flush() = synchronized(store.coordinationLock) {
        store.flush()
    }

    private fun writeDurably(record: FirstDeviceRootRecord): Boolean {
        return try {
            store.putString(key, encode(record))
            store.flush()
            (readStoredRecord() as? StoredRecord.Valid)?.record == record
        } catch (_: Exception) {
            false
        }
    }

    private fun readStoredRecord(): StoredRecord {
        val raw = try {
            store.getString(key)
        } catch (_: Exception) {
            return StoredRecord.Invalid
        } ?: return StoredRecord.Missing
        val record = decode(raw) ?: return StoredRecord.Invalid
        return StoredRecord.Valid(record)
    }

    internal fun encode(record: FirstDeviceRootRecord): String {
        require(record.seed.dskAlias == ALIAS_PREFIX_DSK + record.seed.attemptId)
        require(record.seed.dekAlias == ALIAS_PREFIX_DEK + record.seed.attemptId)
        val acceptedEpoch1 = record.acceptedEpoch1
        require(acceptedEpoch1 == null || record.state == FirstDeviceRootState.ROOT_COMMITTED)
        acceptedEpoch1?.let {
            require(it.canonicalBytes.length in 1..MAX_CANONICAL_EPOCH_UNITS)
            require(isCanonicalSignatureBase64Url(it.signatureBase64Url))
        }
        val submission = record.submission
        val fields = listOf(
            record.seed.attemptId,
            record.seed.attemptRecoveryToken,
            record.seed.serverBaseUrl,
            record.seed.deviceId,
            record.seed.signingKeyId,
            record.seed.encryptionKeyId,
            record.seed.dskPublicKeyBase64,
            record.seed.dekPublicKeyBase64,
            record.seed.dskAlias,
            record.seed.dekAlias,
            record.state.name,
            record.ceremonyId ?: "",
            record.challengeId ?: "",
            record.nonce ?: "",
            record.expiresAt ?: "",
            record.familyId ?: "",
            submission?.proofBytes ?: "",
            submission?.proofSignature ?: "",
            submission?.epoch1Bytes ?: "",
            submission?.epoch1Signature ?: "",
            submission?.attestationEvidence ?: "",
            record.committedAtMillis?.toString() ?: "",
            acceptedEpoch1?.let { Base64.getEncoder().encodeToString(it.canonicalBytes.toByteArray(Charsets.UTF_8)) } ?: "",
            acceptedEpoch1?.signatureBase64Url ?: "",
        )
        for (field in fields) {
            require(!field.contains(FIELD_SEPARATOR)) { "ceremony record field must not contain the separator" }
        }
        return fields.joinToString(FIELD_SEPARATOR)
    }

    internal fun decode(raw: String): FirstDeviceRootRecord? {
        val parts = raw.split(FIELD_SEPARATOR)
        if (parts.size != LEGACY_FIELD_COUNT && parts.size != FIELD_COUNT) return null
        return try {
            val attemptId = parts[0]
            require(parts[8] == ALIAS_PREFIX_DSK + attemptId)
            require(parts[9] == ALIAS_PREFIX_DEK + attemptId)
            val submission = if (parts[16].isEmpty() && parts[17].isEmpty() && parts[18].isEmpty() && parts[19].isEmpty() && parts[20].isEmpty()) {
                null
            } else {
                FirstDeviceSubmissionPayload(
                    proofBytes = parts[16],
                    proofSignature = parts[17],
                    epoch1Bytes = parts[18],
                    epoch1Signature = parts[19],
                    attestationEvidence = parts[20],
                )
            }
            val acceptedEpoch1 = if (parts.size == LEGACY_FIELD_COUNT || (parts[22].isEmpty() && parts[23].isEmpty())) {
                null
            } else {
                require(parts[22].isNotEmpty() && parts[23].isNotEmpty())
                val canonicalBytes = Base64.getDecoder().decode(parts[22])
                require(Base64.getEncoder().encodeToString(canonicalBytes) == parts[22])
                val canonicalText = Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(canonicalBytes)).toString()
                require(canonicalText.length in 1..MAX_CANONICAL_EPOCH_UNITS)
                require(isCanonicalSignatureBase64Url(parts[23]))
                FirstDeviceAcceptedEpochAnchor(canonicalText, parts[23])
            }
            val state = FirstDeviceRootState.valueOf(parts[10])
            require(acceptedEpoch1 == null || state == FirstDeviceRootState.ROOT_COMMITTED)
            FirstDeviceRootRecord(
                seed = FirstDeviceCeremonySeed(
                    attemptId = parts[0],
                    attemptRecoveryToken = parts[1],
                    serverBaseUrl = parts[2],
                    deviceId = parts[3],
                    signingKeyId = parts[4],
                    encryptionKeyId = parts[5],
                    dskPublicKeyBase64 = parts[6],
                    dekPublicKeyBase64 = parts[7],
                    dskAlias = parts[8],
                    dekAlias = parts[9],
                ),
                state = state,
                ceremonyId = parts[11].ifEmpty { null },
                challengeId = parts[12].ifEmpty { null },
                nonce = parts[13].ifEmpty { null },
                expiresAt = parts[14].ifEmpty { null },
                familyId = parts[15].ifEmpty { null },
                submission = submission,
                committedAtMillis = parts[21].ifEmpty { null }?.toLong(),
                acceptedEpoch1 = acceptedEpoch1,
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun isCanonicalSignatureBase64Url(value: String): Boolean = try {
        val decoded = Base64.getUrlDecoder().decode(value)
        decoded.size == 64 && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == value
    } catch (_: IllegalArgumentException) {
        false
    }

    private companion object {
        const val KEY = "first_device_root_v1"
        const val FIELD_SEPARATOR = "|"
        const val LEGACY_FIELD_COUNT = 22
        const val FIELD_COUNT = 24
        const val MAX_CANONICAL_EPOCH_UNITS = 262144
        const val ALIAS_PREFIX_DSK = "pca.dsk."
        const val ALIAS_PREFIX_DEK = "pca.dek."
    }
}
