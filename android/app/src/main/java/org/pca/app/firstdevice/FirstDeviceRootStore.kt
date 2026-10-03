package org.pca.app.firstdevice

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
)

interface FirstDeviceRootStore {
    fun current(): FirstDeviceRootRecord?
    fun save(record: FirstDeviceRootRecord)
    fun clear()

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
    private var record: FirstDeviceRootRecord? = null
    override fun current(): FirstDeviceRootRecord? = record
    override fun save(record: FirstDeviceRootRecord) { this.record = record }
    override fun clear() { record = null }
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

    override fun current(): FirstDeviceRootRecord? {
        val raw = store.getString(key) ?: return null
        return decode(raw)
    }

    override fun save(record: FirstDeviceRootRecord) {
        store.putString(key, encode(record))
    }

    override fun clear() {
        store.remove(key)
    }

    override fun flush() {
        store.flush()
    }

    internal fun encode(record: FirstDeviceRootRecord): String {
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
        )
        for (field in fields) {
            require(!field.contains(FIELD_SEPARATOR)) { "ceremony record field must not contain the separator" }
        }
        return fields.joinToString(FIELD_SEPARATOR)
    }

    internal fun decode(raw: String): FirstDeviceRootRecord? {
        val parts = raw.split(FIELD_SEPARATOR)
        if (parts.size != FIELD_COUNT) return null
        return try {
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
                state = FirstDeviceRootState.valueOf(parts[10]),
                ceremonyId = parts[11].ifEmpty { null },
                challengeId = parts[12].ifEmpty { null },
                nonce = parts[13].ifEmpty { null },
                expiresAt = parts[14].ifEmpty { null },
                familyId = parts[15].ifEmpty { null },
                submission = submission,
                committedAtMillis = parts[21].ifEmpty { null }?.toLong(),
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private companion object {
        const val KEY = "first_device_root_v1"
        const val FIELD_SEPARATOR = "|"
        const val FIELD_COUNT = 22
    }
}
