package org.pca.app.persistence.export

import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import org.json.JSONObject
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus
import org.pca.app.persistence.entity.RetentionPolicy

/**
 * The retention scope is captured at export creation and is not inferred by a
 * later reader. The device-side data source applies the same cutoff rules as
 * [org.pca.app.persistence.retention.RetentionEngine].
 */
data class FamilyExportRetentionScope(
    val generalPolicy: RetentionPolicy,
    val locationPolicy: RetentionPolicy,
    val zoneId: ZoneId,
)

data class FamilyExportRecord(
    val entityClass: String,
    val id: String,
    val eventTimestampEpochMillis: Long,
    val deviceId: String?,
    val payload: JSONObject,
)

interface FamilyExportDataSource {
    suspend fun collect(
        familyId: String,
        scope: FamilyExportRetentionScope,
        now: Instant,
    ): List<FamilyExportRecord>
}

/** The only encryption port accepted by the local export service. */
data class EncryptedFamilyExportPayload(
    val ciphertext: ByteArray,
    val encryptionMetadata: ByteArray,
)

interface FamilyExportEncryptor {
    /**
     * [familyId] is an authenticated family-binding input, not a key lookup
     * hint. A production implementation must bind the manifest and payload to
     * the authorized family's approved key epoch before returning.
     */
    suspend fun encrypt(
        familyId: String,
        manifestBytes: ByteArray,
        payloadBytes: ByteArray,
    ): EncryptedFamilyExportPayload
}

class FamilyExportCryptoUnavailableException : IllegalStateException(
    "PCA family export encryption is unavailable until the approved crypto suite is activated",
)

/**
 * Production default. It is deliberately rejecting: local-at-rest AES keys
 * are not family E2EE keys and must never be used as an export substitute.
 */
class RejectingFamilyExportEncryptor : FamilyExportEncryptor {
    override suspend fun encrypt(
        familyId: String,
        manifestBytes: ByteArray,
        payloadBytes: ByteArray,
    ): EncryptedFamilyExportPayload {
        throw FamilyExportCryptoUnavailableException()
    }
}

sealed interface FamilyExportAuthorization {
    data object Allowed : FamilyExportAuthorization
    data class Denied(val code: Code) : FamilyExportAuthorization

    enum class Code { FORBIDDEN, STEP_UP_REQUIRED }
}

interface FamilyExportAuthorizer {
    suspend fun authorize(
        familyId: String,
        actorMemberId: String,
        stepUpSatisfied: Boolean,
    ): FamilyExportAuthorization
}

/** Owner-only plus explicit step-up. Administrators and Viewers are denied. */
class RoomFamilyExportAuthorizer(
    private val database: PcaLocalDatabase,
) : FamilyExportAuthorizer {
    override suspend fun authorize(
        familyId: String,
        actorMemberId: String,
        stepUpSatisfied: Boolean,
    ): FamilyExportAuthorization {
        val member = database.familyMemberDao().getById(actorMemberId)
        if (
            member == null ||
            member.familyId != familyId ||
            member.status != FamilyMemberStatus.ACTIVE ||
            member.role != FamilyMemberRole.OWNER
        ) {
            return FamilyExportAuthorization.Denied(FamilyExportAuthorization.Code.FORBIDDEN)
        }
        if (!stepUpSatisfied) {
            return FamilyExportAuthorization.Denied(FamilyExportAuthorization.Code.STEP_UP_REQUIRED)
        }
        return FamilyExportAuthorization.Allowed
    }
}

data class EncryptedFamilyExportArtifact(
    val exportId: String,
    val manifestBytes: ByteArray,
    val ciphertext: ByteArray,
    val encryptionMetadata: ByteArray,
)

interface EncryptedFamilyExportFileStore {
    /** Writes only an already-encrypted artifact and finalizes it atomically. */
    fun write(artifact: EncryptedFamilyExportArtifact): File

    /** Removes only an app-managed copy; it cannot revoke a copy shared externally. */
    fun delete(exportId: String): Boolean
}

/**
 * App-private, encrypted-artifact-only store. Plaintext is never staged, and
 * a failed write removes its staging file before the error is returned.
 */
class AtomicEncryptedFamilyExportFileStore(
    private val rootDirectory: File,
) : EncryptedFamilyExportFileStore {
    override fun write(artifact: EncryptedFamilyExportArtifact): File {
        require(isSafeExportId(artifact.exportId)) { "invalid export id" }
        require(artifact.ciphertext.isNotEmpty()) { "empty encrypted export" }
        require(artifact.manifestBytes.isNotEmpty()) { "missing export manifest" }
        if (!rootDirectory.exists() && !rootDirectory.mkdirs()) {
            throw IllegalStateException("export directory unavailable")
        }
        if (!rootDirectory.isDirectory) throw IllegalStateException("export directory unavailable")

        val destination = File(rootDirectory, "${artifact.exportId}.pca-export")
        if (destination.exists()) throw IllegalStateException("export already exists")

        val staging = File.createTempFile(".${artifact.exportId}.", ".staging", rootDirectory)
        try {
            FileOutputStream(staging).use { output ->
                output.write(encodeArtifact(artifact))
                output.fd.sync()
            }
            staging.setReadable(true, true)
            staging.setWritable(false, true)
            try {
                Files.move(
                    staging.toPath(),
                    destination.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                if (!staging.renameTo(destination)) {
                    throw IllegalStateException("atomic export finalization unavailable")
                }
            }
            destination.setReadable(true, true)
            destination.setWritable(false, true)
            return destination
        } catch (error: Throwable) {
            staging.delete()
            destination.delete()
            throw error
        } finally {
            staging.delete()
        }
    }

    override fun delete(exportId: String): Boolean {
        if (!isSafeExportId(exportId)) return false
        return File(rootDirectory, "$exportId.pca-export").delete()
    }

    private fun encodeArtifact(artifact: EncryptedFamilyExportArtifact): ByteArray =
        JSONObject()
            .put("schema", "pca-family-encrypted-export-v1")
            .put("exportId", artifact.exportId)
            .put("manifestBase64", Base64.encodeToString(artifact.manifestBytes, Base64.NO_WRAP))
            .put("ciphertextBase64", Base64.encodeToString(artifact.ciphertext, Base64.NO_WRAP))
            .put("encryptionMetadataBase64", Base64.encodeToString(artifact.encryptionMetadata, Base64.NO_WRAP))
            .toString()
            .toByteArray(Charsets.UTF_8)

    private companion object {
        val EXPORT_ID_PATTERN = Regex("[A-Za-z0-9_-]{1,128}")

        fun isSafeExportId(value: String): Boolean = EXPORT_ID_PATTERN.matches(value)
    }
}

data class FamilyExportManifest(
    val exportId: String,
    val createdAtEpochMillis: Long,
    val familyId: String,
    val scope: FamilyExportRetentionScope,
    val retentionCutoffEpochMillis: Long,
    val includedCategories: List<String>,
    val recordCounts: Map<String, Int>,
    val integrityDigestSha256: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("schema", "pca-family-export-manifest-v1")
        .put("exportId", exportId)
        .put("createdAtEpochMillis", createdAtEpochMillis)
        .put("familyId", familyId)
        .put(
            "retentionScope",
            JSONObject()
                .put("generalPolicy", scope.generalPolicy.name)
                .put("locationPolicy", scope.locationPolicy.name)
                .put("timezone", scope.zoneId.id),
        )
        .put("retentionCutoffEpochMillis", retentionCutoffEpochMillis)
        .put("includedCategories", includedCategories)
        .put("recordCounts", JSONObject(recordCounts))
        .put("integrityDigestAlgorithm", "SHA-256")
        .put("integrityDigest", integrityDigestSha256)
}

sealed interface FamilyExportOutcome {
    data class Completed(
        val exportId: String,
        val file: File,
        val manifest: FamilyExportManifest,
    ) : FamilyExportOutcome

    data class Denied(val code: FamilyExportAuthorization.Code) : FamilyExportOutcome

    data class Failed(val code: Code) : FamilyExportOutcome {
        enum class Code { CRYPTO_UNAVAILABLE, SOURCE_UNAVAILABLE, STORAGE_FAILED, INVALID_REQUEST }
    }
}

internal fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

internal fun newExportId(): String = UUID.randomUUID().toString()
