package org.pca.app.persistence.export

import java.time.Instant
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.repository.LocationPointRepository
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.persistence.repository.WebVisitRepository
import org.pca.app.persistence.retention.RetentionCutoffCalculator

/**
 * Reads only the current device-local family replica. The family/member and
 * device joins are resolved before any activity row is read, so another local
 * family's records cannot enter an export. Encrypted Room columns are
 * decrypted only in memory and are handed to the family encryptor, never to a
 * file, log, relay, or support path.
 */
class LocalRoomFamilyExportDataSource(
    private val database: PcaLocalDatabase,
    private val localCipher: LocalRecordCipher,
) : FamilyExportDataSource {
    override suspend fun collect(
        familyId: String,
        scope: FamilyExportRetentionScope,
        now: Instant,
    ): List<FamilyExportRecord> {
        require(familyId.isNotBlank()) { "familyId must not be blank" }
        require(RetentionCutoffCalculator.isLocationRetentionAllowed(scope.generalPolicy, scope.locationPolicy)) {
            "Location retention must be shorter than or equal to general retention."
        }
        val members = database.familyMemberDao().observeByFamily(familyId).first()
        val memberIds = members.map { it.memberId }.toSet()
        val deviceIds = database.deviceDao().getAll()
            .filter { it.memberId in memberIds }
            .map { it.deviceId }
            .toSet()

        val generalCutoff = RetentionCutoffCalculator.cutoffFor(scope.generalPolicy, now, scope.zoneId).toEpochMilli()
        val auditCutoff = RetentionCutoffCalculator.auditFloorCutoff(scope.generalPolicy, now, scope.zoneId).toEpochMilli()
        val records = mutableListOf<FamilyExportRecord>()

        val usageRepository = UsageSessionRepository(database.usageSessionDao(), localCipher)
        val webRepository = WebVisitRepository(database.webVisitDao(), localCipher)
        val locationRepository = LocationPointRepository(database.locationPointDao(), localCipher)
        val locationCandidates = mutableListOf<FamilyExportRecord>()

        for (deviceId in deviceIds) {
            usageRepository.getForDevice(deviceId)
                .filter { it.startedAtEpochMillis >= generalCutoff }
                .forEach { usage ->
                    records += FamilyExportRecord(
                        entityClass = "USAGE_SESSION",
                        id = usage.id,
                        eventTimestampEpochMillis = usage.startedAtEpochMillis,
                        deviceId = usage.deviceId,
                        payload = JSONObject()
                            .put("appOrCategoryToken", usage.appOrCategoryToken)
                            .put("startedAtEpochMillis", usage.startedAtEpochMillis)
                            .put("endedAtEpochMillis", usage.endedAtEpochMillis)
                            .put("durationMillis", usage.durationMillis)
                            .put("sourceConfidence", usage.sourceConfidence.name),
                    )
                }

            webRepository.getForDevice(deviceId)
                .filter { it.timestampEpochMillis >= generalCutoff }
                .forEach { visit ->
                    records += FamilyExportRecord(
                        entityClass = "WEB_VISIT",
                        id = visit.id,
                        eventTimestampEpochMillis = visit.timestampEpochMillis,
                        deviceId = visit.deviceId,
                        payload = JSONObject()
                            .put("domain", visit.domain)
                            .put("url", visit.url ?: JSONObject.NULL)
                            .put("title", visit.title ?: JSONObject.NULL)
                            .put("classificationCategory", visit.classificationCategory)
                            .put("ruleOrModelVersion", visit.ruleOrModelVersion)
                            .put("action", visit.action.name)
                            .put("timestampEpochMillis", visit.timestampEpochMillis),
                    )
                }

            locationRepository.getForDevice(deviceId).forEach { point ->
                val effectivePolicy = stricterLocationPolicy(scope.locationPolicy, point.retentionPolicy)
                if (effectivePolicy == RetentionPolicy.LATEST_ONLY ||
                    point.timestampEpochMillis >= RetentionCutoffCalculator.cutoffFor(effectivePolicy, now, scope.zoneId).toEpochMilli()
                ) {
                    locationCandidates += FamilyExportRecord(
                        entityClass = "LOCATION_POINT",
                        id = point.id,
                        eventTimestampEpochMillis = point.timestampEpochMillis,
                        deviceId = point.deviceId,
                        payload = JSONObject()
                            .put("latitude", point.latitude)
                            .put("longitude", point.longitude)
                            .put("accuracyMeters", point.accuracyMeters)
                            .put("source", point.source)
                            .put("retentionPolicy", point.retentionPolicy.name)
                            .put("timestampEpochMillis", point.timestampEpochMillis),
                    )
                }
            }

            database.contentBlockEventDao().getForDevice(deviceId)
                .filter { it.timestampEpochMillis >= generalCutoff }
                .forEach { event ->
                    records += FamilyExportRecord(
                        entityClass = "CONTENT_BLOCK_EVENT",
                        id = event.id,
                        eventTimestampEpochMillis = event.timestampEpochMillis,
                        deviceId = event.deviceId,
                        payload = JSONObject()
                            .put("category", event.category)
                            .put("ruleOrModelVersion", event.ruleOrModelVersion)
                            .put("reasonCode", event.reasonCode)
                            .put("confidenceBucket", event.confidenceBucket ?: JSONObject.NULL)
                            .put("timestampEpochMillis", event.timestampEpochMillis),
                    )
                }

            database.breakSessionDao().getForDevice(deviceId)
                .filter { it.breakStartEpochMillis >= generalCutoff }
                .forEach { event ->
                    records += FamilyExportRecord(
                        entityClass = "BREAK_SESSION",
                        id = event.id,
                        eventTimestampEpochMillis = event.breakStartEpochMillis,
                        deviceId = event.deviceId,
                        payload = JSONObject()
                            .put("triggerType", event.triggerType)
                            .put("continuousUseDurationMillis", event.continuousUseDurationMillis)
                            .put("breakStartEpochMillis", event.breakStartEpochMillis)
                            .put("breakEndEpochMillis", event.breakEndEpochMillis ?: JSONObject.NULL)
                            .put("completionReason", event.completionReason ?: JSONObject.NULL)
                            .put("optionalCounterTotal", event.optionalCounterTotal ?: JSONObject.NULL),
                    )
                }

            database.proximityEventDao().getForDevice(deviceId)
                .filter { it.timestampEpochMillis >= generalCutoff }
                .forEach { event ->
                    records += FamilyExportRecord(
                        entityClass = "PROXIMITY_EVENT",
                        id = event.id,
                        eventTimestampEpochMillis = event.timestampEpochMillis,
                        deviceId = event.deviceId,
                        payload = JSONObject()
                            .put("distanceBucket", event.distanceBucket.name)
                            .put("action", event.action)
                            .put("timestampEpochMillis", event.timestampEpochMillis),
                    )
                }

            database.prayerReminderEventDao().getForDevice(deviceId)
                .filter { it.scheduledAtEpochMillis >= generalCutoff }
                .forEach { event ->
                    records += FamilyExportRecord(
                        entityClass = "PRAYER_REMINDER_EVENT",
                        id = event.id,
                        eventTimestampEpochMillis = event.scheduledAtEpochMillis,
                        deviceId = event.deviceId,
                        payload = JSONObject()
                            .put("prayerKey", event.prayerKey)
                            .put("scheduledAtEpochMillis", event.scheduledAtEpochMillis)
                            .put("deliveryState", event.deliveryState.name),
                    )
                }

            database.installedAppEventDao().getForDevice(deviceId)
                .filter { it.installedAtEpochMillis >= generalCutoff }
                .forEach { event ->
                    records += FamilyExportRecord(
                        entityClass = "ROUTINE_ACTIVITY",
                        id = event.id,
                        eventTimestampEpochMillis = event.installedAtEpochMillis,
                        deviceId = event.deviceId,
                        payload = JSONObject()
                            .put("packageName", event.packageName)
                            .put("appLabel", event.appLabel ?: JSONObject.NULL)
                            .put("installedAtEpochMillis", event.installedAtEpochMillis)
                            .put("observedAtEpochMillis", event.observedAtEpochMillis),
                    )
                }

            database.policyReceiptDao().getForDevice(deviceId).forEach { receipt ->
                records += FamilyExportRecord(
                    entityClass = "SYNC_RECEIPT",
                    id = receipt.id,
                    eventTimestampEpochMillis = receipt.appliedAtEpochMillis,
                    deviceId = receipt.deviceId,
                    payload = JSONObject()
                        .put("policyId", receipt.policyId)
                        .put("policyVersion", receipt.policyVersion)
                        .put("verifiedAtEpochMillis", receipt.verifiedAtEpochMillis)
                        .put("appliedAtEpochMillis", receipt.appliedAtEpochMillis)
                        .put("signedByKeyId", receipt.signedByKeyId),
                )
            }
        }

        val latestLocationByDevice = locationCandidates
            .filter { it.deviceId != null }
            .groupBy { it.deviceId }
            .mapValues { (_, values) -> values.maxWith(compareBy<FamilyExportRecord> { it.eventTimestampEpochMillis }.thenBy { it.id }) }
            .values
            .map { it.id }
            .toSet()
        records += locationCandidates.filter {
            stricterLocationPolicy(scope.locationPolicy, RetentionPolicy.valueOf(it.payload.getString("retentionPolicy"))) != RetentionPolicy.LATEST_ONLY ||
                it.id in latestLocationByDevice
        }

        database.parentActionAuditDao().getForFamily(familyId)
            .filter { it.timestampEpochMillis >= auditCutoff }
            .forEach { audit ->
                records += FamilyExportRecord(
                    entityClass = "PARENT_ACTION_AUDIT",
                    id = audit.id,
                    eventTimestampEpochMillis = audit.timestampEpochMillis,
                    deviceId = null,
                    payload = JSONObject()
                        .put("actorMemberId", audit.actorMemberId)
                        .put("actionType", audit.actionType.name)
                        .put("targetEntity", audit.targetEntity)
                        .put("timestampEpochMillis", audit.timestampEpochMillis)
                        .put("reasonPresent", audit.reasonEnc != null),
                )
            }

        database.tamperEventDao().getForFamily(familyId)
            .filter { it.detectedAtEpochMillis >= auditCutoff }
            .forEach { event ->
                records += FamilyExportRecord(
                    entityClass = "TAMPER_EVENT",
                    id = event.id,
                    eventTimestampEpochMillis = event.detectedAtEpochMillis,
                    deviceId = event.deviceId,
                    payload = JSONObject()
                        .put("conditionType", event.conditionType)
                        .put("detectedAtEpochMillis", event.detectedAtEpochMillis)
                        .put("resolvedAtEpochMillis", event.resolvedAtEpochMillis ?: JSONObject.NULL),
                )
            }

        database.retentionDeletionReceiptDao().getForFamily(familyId).forEach { receipt ->
            records += FamilyExportRecord(
                entityClass = "RETENTION_DELETION_RECEIPT",
                id = receipt.id,
                eventTimestampEpochMillis = receipt.createdAtEpochMillis,
                deviceId = receipt.deviceId,
                payload = JSONObject()
                    .put("familyId", receipt.familyId)
                    .put("deviceId", receipt.deviceId ?: JSONObject.NULL)
                    .put("entityCategory", receipt.entityCategory)
                    .put("deletedCount", receipt.deletedCount)
                    .put("cutoffEpochMillis", receipt.cutoffEpochMillis)
                    .put("createdAtEpochMillis", receipt.createdAtEpochMillis)
                    .put("reason", receipt.reason),
            )
        }

        database.tombstoneRecordDao().getForFamily(familyId).forEach { tombstone ->
            records += FamilyExportRecord(
                entityClass = "DELETION_TOMBSTONE",
                id = tombstone.id,
                eventTimestampEpochMillis = tombstone.deletedAtEpochMillis,
                deviceId = null,
                payload = JSONObject()
                    .put("familyId", tombstone.familyId)
                    .put("recordId", tombstone.recordId)
                    .put("recordCategory", tombstone.recordCategory)
                    .put("deletedAtEpochMillis", tombstone.deletedAtEpochMillis),
            )
        }

        return records.sortedWith(
            compareByDescending<FamilyExportRecord> { it.eventTimestampEpochMillis }
                .thenBy { it.entityClass }
                .thenBy { it.id },
        )
    }

    private fun stricterLocationPolicy(a: RetentionPolicy, b: RetentionPolicy): RetentionPolicy {
        if (a == RetentionPolicy.LATEST_ONLY || b == RetentionPolicy.LATEST_ONLY) return RetentionPolicy.LATEST_ONLY
        return if (rank(a) <= rank(b)) a else b
    }

    private fun rank(policy: RetentionPolicy): Int = when (policy) {
        RetentionPolicy.FOURTEEN_DAYS -> 0
        RetentionPolicy.ONE_MONTH -> 1
        RetentionPolicy.THREE_MONTHS -> 2
        RetentionPolicy.SIX_MONTHS -> 3
        RetentionPolicy.NINE_MONTHS -> 4
        RetentionPolicy.LATEST_ONLY -> Int.MIN_VALUE
    }
}
