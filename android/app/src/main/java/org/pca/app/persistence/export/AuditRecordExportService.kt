package org.pca.app.persistence.export

import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.entity.ParentActionAuditEntity
import org.pca.app.persistence.entity.TamperEventEntity

/**
 * PCA-FR-124: produces a local, family-scoped audit record that a caller can persist or hand to
 * the platform share/export flow. The export contains policy/role/retention/deletion actions and
 * tamper events in one chronological record set. Optional action reasons remain represented only
 * as an encrypted-presence flag; this service never decrypts or emits their plaintext.
 *
 * This is deliberately an on-device read/export boundary. It does not upload the record, add a
 * readable central audit store, or bypass the existing local database family-scope relations.
 */
class AuditRecordExportService(private val database: PcaLocalDatabase) {
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
}
