package org.pca.app.persistence.export

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.entity.ParentActionAuditEntity
import org.pca.app.persistence.entity.ParentActionType
import org.pca.app.persistence.entity.TamperEventEntity
import org.pca.app.persistence.retention.RetentionCutoffCalculator

/**
 * PCA-FR-124: produces a local, family-scoped audit record that a caller can persist or hand to
 * the platform share/export flow. The export contains policy/role/retention/deletion actions and
 * tamper events in one chronological record set. Optional action reasons remain represented only
 * as an encrypted-presence flag; this service never decrypts or emits their plaintext.
 *
 * This is deliberately an on-device read/export boundary. It does not upload the record, add a
 * readable central audit store, or bypass the existing local database family-scope relations.
 */
class AuditRecordExportService(
    private val database: PcaLocalDatabase,
    private val dataSource: FamilyExportDataSource? = null,
    private val localCipher: LocalRecordCipher? = null,
) {
    suspend fun exportFamily(familyId: String, generatedAtEpochMillis: Long): String {
        require(familyId.isNotBlank()) { "familyId must not be blank" }

        val records = (database.parentActionAuditDao().getForFamily(familyId).map(::actionRecord) +
            database.tamperEventDao().getForFamily(familyId).map(::tamperRecord))
            .sortedByDescending { it.first }

        val recordArray = JSONArray()
        records.forEach { recordArray.put(it.second) }

        return JSONObject()
            .put("schema", "pca-family-audit-export-v1")
            .put("familyId", familyId)
            .put("generatedAtEpochMillis", generatedAtEpochMillis)
            .put("records", recordArray)
            .toString(2)
    }

    /**
     * PCA-FR-125/PCA-SEC-026: generates an encrypted export on this device.
     * The service does not know how to decrypt family E2EE material and never
     * substitutes the local-at-rest cipher. Until the approved family crypto
     * provider is injected, the rejecting provider returns a typed failure and
     * no file is created.
     */
    suspend fun generateEncryptedExport(
        familyId: String,
        actorMemberId: String,
        retentionScope: FamilyExportRetentionScope,
        createdAtEpochMillis: Long,
        stepUpSatisfied: Boolean,
        encryptor: FamilyExportEncryptor,
        fileStore: EncryptedFamilyExportFileStore,
        authorizer: FamilyExportAuthorizer = RoomFamilyExportAuthorizer(database),
        now: Instant = Instant.ofEpochMilli(createdAtEpochMillis),
    ): FamilyExportOutcome {
        if (familyId.isBlank() || actorMemberId.isBlank() || createdAtEpochMillis < 0) {
            return FamilyExportOutcome.Failed(FamilyExportOutcome.Failed.Code.INVALID_REQUEST)
        }

        when (val authorization = authorizer.authorize(familyId, actorMemberId, stepUpSatisfied)) {
            is FamilyExportAuthorization.Denied -> {
                recordAuditIfSameFamily(
                    familyId = familyId,
                    actorMemberId = actorMemberId,
                    timestampEpochMillis = createdAtEpochMillis,
                    reason = "EXPORT_DENIED_${authorization.code.name}",
                )
                return FamilyExportOutcome.Denied(authorization.code)
            }
            FamilyExportAuthorization.Allowed -> Unit
        }

        val source = dataSource ?: return FamilyExportOutcome.Failed(FamilyExportOutcome.Failed.Code.SOURCE_UNAVAILABLE)
        val exportId = newExportId()
        val records = try {
            source.collect(familyId, retentionScope, now)
        } catch (error: Throwable) {
            rethrowCancellation(error)
            return FamilyExportOutcome.Failed(FamilyExportOutcome.Failed.Code.SOURCE_UNAVAILABLE)
        }
        val payloadBytes = serializePayload(familyId, exportId, createdAtEpochMillis, records)
        val manifest = buildManifest(familyId, exportId, createdAtEpochMillis, retentionScope, now, records, payloadBytes)
        val manifestBytes = manifest.toJson().toString().toByteArray(Charsets.UTF_8)
        val encrypted = try {
            encryptor.encrypt(familyId, manifestBytes, payloadBytes)
        } catch (_: FamilyExportCryptoUnavailableException) {
            return FamilyExportOutcome.Failed(FamilyExportOutcome.Failed.Code.CRYPTO_UNAVAILABLE)
        } catch (error: Throwable) {
            rethrowCancellation(error)
            return FamilyExportOutcome.Failed(FamilyExportOutcome.Failed.Code.CRYPTO_UNAVAILABLE)
        }
        if (encrypted.ciphertext.isEmpty()) {
            return FamilyExportOutcome.Failed(FamilyExportOutcome.Failed.Code.CRYPTO_UNAVAILABLE)
        }

        val file = try {
            fileStore.write(
                EncryptedFamilyExportArtifact(
                    exportId = exportId,
                    manifestBytes = manifestBytes,
                    ciphertext = encrypted.ciphertext,
                    encryptionMetadata = encrypted.encryptionMetadata,
                ),
            )
        } catch (error: Throwable) {
            rethrowCancellation(error)
            return FamilyExportOutcome.Failed(FamilyExportOutcome.Failed.Code.STORAGE_FAILED)
        }

        return try {
            recordAuditIfSameFamily(
                familyId = familyId,
                actorMemberId = actorMemberId,
                timestampEpochMillis = createdAtEpochMillis,
                reason = "EXPORT_COMPLETED",
            )
            FamilyExportOutcome.Completed(exportId, file, manifest)
        } catch (error: Throwable) {
            rethrowCancellation(error)
            fileStore.delete(exportId)
            FamilyExportOutcome.Failed(FamilyExportOutcome.Failed.Code.STORAGE_FAILED)
        }
    }

    private fun serializePayload(
        familyId: String,
        exportId: String,
        createdAtEpochMillis: Long,
        records: List<FamilyExportRecord>,
    ): ByteArray {
        val array = JSONArray()
        records.forEach { record ->
            array.put(
                JSONObject()
                    .put("entityClass", record.entityClass)
                    .put("id", record.id)
                    .put("eventTimestampEpochMillis", record.eventTimestampEpochMillis)
                    .put("deviceId", record.deviceId ?: JSONObject.NULL)
                    .put("payload", record.payload),
            )
        }
        return JSONObject()
            .put("schema", "pca-family-export-data-v1")
            .put("familyId", familyId)
            .put("exportId", exportId)
            .put("createdAtEpochMillis", createdAtEpochMillis)
            .put("records", array)
            .toString()
            .toByteArray(Charsets.UTF_8)
    }

    private fun buildManifest(
        familyId: String,
        exportId: String,
        createdAtEpochMillis: Long,
        scope: FamilyExportRetentionScope,
        now: Instant,
        records: List<FamilyExportRecord>,
        payloadBytes: ByteArray,
    ): FamilyExportManifest {
        val counts = records.groupingBy { it.entityClass }.eachCount().toSortedMap()
        return FamilyExportManifest(
            exportId = exportId,
            createdAtEpochMillis = createdAtEpochMillis,
            familyId = familyId,
            scope = scope,
            retentionCutoffEpochMillis = RetentionCutoffCalculator.cutoffFor(scope.generalPolicy, now, scope.zoneId).toEpochMilli(),
            includedCategories = counts.keys.toList(),
            recordCounts = counts,
            integrityDigestSha256 = sha256Hex(payloadBytes),
        )
    }

    private suspend fun recordAuditIfSameFamily(
        familyId: String,
        actorMemberId: String,
        timestampEpochMillis: Long,
        reason: String,
    ) {
        val actor = database.familyMemberDao().getById(actorMemberId) ?: return
        if (actor.familyId != familyId) return
        val encryptedReason = localCipher?.encrypt(reason)
        database.parentActionAuditDao().upsert(
            ParentActionAuditEntity(
                id = UUID.randomUUID().toString(),
                actorMemberId = actorMemberId,
                actionType = ParentActionType.EXPORT,
                targetEntity = "FAMILY_EXPORT",
                timestampEpochMillis = timestampEpochMillis,
                reasonEnc = encryptedReason?.ciphertext?.let { android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP) },
                reasonIv = encryptedReason?.iv?.let { android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP) },
            ),
        )
    }

    private fun actionRecord(entity: ParentActionAuditEntity): Pair<Long, JSONObject> =
        entity.timestampEpochMillis to JSONObject()
            .put("recordType", "PARENT_ACTION")
            .put("id", entity.id)
            .put("actorMemberId", entity.actorMemberId)
            .put("actionType", entity.actionType.name)
            .put("targetEntity", entity.targetEntity)
            .put("timestampEpochMillis", entity.timestampEpochMillis)
            .put("reasonPresent", entity.reasonEnc != null)

    private fun tamperRecord(entity: TamperEventEntity): Pair<Long, JSONObject> =
        entity.detectedAtEpochMillis to JSONObject()
            .put("recordType", "TAMPER_EVENT")
            .put("id", entity.id)
            .put("deviceId", entity.deviceId)
            .put("conditionType", entity.conditionType)
            .put("detectedAtEpochMillis", entity.detectedAtEpochMillis)
            .put("resolvedAtEpochMillis", entity.resolvedAtEpochMillis)

    private fun rethrowCancellation(error: Throwable) {
        if (error is CancellationException) throw error
    }
}
