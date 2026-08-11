package org.pca.app.persistence.retention

import androidx.room.withTransaction
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.entity.RetentionDeletionReceiptEntity
import org.pca.app.persistence.entity.RetentionPolicy

/** Already-resolved retention parameters for one child device, supplied by the policy-application layer (doc 05 Section 6) -- this engine executes the mechanical deletion, it does not parse signed Policy payloads itself. */
data class DeviceRetentionContext(
    val deviceId: String,
    val generalRetentionPolicy: RetentionPolicy,
    val locationRetentionPolicy: RetentionPolicy,
    val zoneId: ZoneId,
)

/**
 * doc 11 Section 5's deletion algorithm, steps 1-3 and 7 (PCA-LOCAL-DB-1
 * Section 20): compute cutoff, select+delete in-scope records, create a
 * non-sensitive [RetentionDeletionReceiptEntity]. Runs inside one DB
 * transaction per device so a crash mid-cycle cannot leave a partially
 * deleted, partially receipted state (Section 24).
 *
 * Deliberately scoped to Section 3.1 entity classes only (PCA-DATA-020) --
 * [TamperEventEntity]/[ParentActionAuditEntity] are never touched by
 * [runGeneralCycle]; see [runAuditFloorCycle] for their separate, longer
 * floor (PCA-DATA-021).
 */
class RetentionEngine(private val database: PcaLocalDatabase) {

    suspend fun runGeneralCycle(
        familyId: String,
        nowUtc: Instant,
        devices: List<DeviceRetentionContext>,
    ): List<RetentionDeletionReceiptEntity> {
        val receipts = mutableListOf<RetentionDeletionReceiptEntity>()
        database.withTransaction {
            for (ctx in devices) {
                receipts += runLocationCleanup(familyId, ctx, nowUtc)
                receipts += runGeneralWindowCleanup(familyId, ctx, nowUtc)
            }
            receipts.forEach { database.retentionDeletionReceiptDao().insert(it) }
        }
        return receipts
    }

    /** PCA-DATA-021: separate, longer audit-trail floor -- MUST NOT be called from [runGeneralCycle]. */
    suspend fun runAuditFloorCycle(
        familyId: String,
        nowUtc: Instant,
        familyGeneralPolicy: RetentionPolicy,
        zoneId: ZoneId,
    ): List<RetentionDeletionReceiptEntity> {
        val receipts = mutableListOf<RetentionDeletionReceiptEntity>()
        val cutoff = RetentionCutoffCalculator.auditFloorCutoff(familyGeneralPolicy, nowUtc, zoneId)
        val cutoffMillis = cutoff.toEpochMilli()
        database.withTransaction {
            val tamperDeleted = database.tamperEventDao().deleteOlderThanAuditFloor(cutoffMillis)
            if (tamperDeleted > 0) {
                receipts += receipt(familyId, null, "TamperEvent", tamperDeleted, cutoffMillis, nowUtc, "audit_floor")
            }
            val auditDeleted = database.parentActionAuditDao().deleteOlderThanAuditFloor(cutoffMillis)
            if (auditDeleted > 0) {
                receipts += receipt(familyId, null, "ParentActionAudit", auditDeleted, cutoffMillis, nowUtc, "audit_floor")
            }
            receipts.forEach { database.retentionDeletionReceiptDao().insert(it) }
        }
        return receipts
    }

    private suspend fun runLocationCleanup(
        familyId: String,
        ctx: DeviceRetentionContext,
        nowUtc: Instant,
    ): List<RetentionDeletionReceiptEntity> {
        val dao = database.locationPointDao()
        return if (ctx.locationRetentionPolicy == RetentionPolicy.LATEST_ONLY) {
            val deleted = dao.deleteAllExceptLatestForDevice(ctx.deviceId)
            if (deleted > 0) {
                listOf(receipt(familyId, ctx.deviceId, "LocationPoint", deleted, nowUtc.toEpochMilli(), nowUtc, "latest_only"))
            } else {
                emptyList()
            }
        } else {
            val cutoff = RetentionCutoffCalculator.cutoffFor(ctx.locationRetentionPolicy, nowUtc, ctx.zoneId)
            val deleted = dao.deleteOlderThanForDevice(ctx.deviceId, cutoff.toEpochMilli())
            if (deleted > 0) {
                listOf(receipt(familyId, ctx.deviceId, "LocationPoint", deleted, cutoff.toEpochMilli(), nowUtc, "expiry"))
            } else {
                emptyList()
            }
        }
    }

    private suspend fun runGeneralWindowCleanup(
        familyId: String,
        ctx: DeviceRetentionContext,
        nowUtc: Instant,
    ): List<RetentionDeletionReceiptEntity> {
        val cutoff = RetentionCutoffCalculator.cutoffFor(ctx.generalRetentionPolicy, nowUtc, ctx.zoneId)
        val cutoffMillis = cutoff.toEpochMilli()
        val receipts = mutableListOf<RetentionDeletionReceiptEntity>()

        fun record(category: String, deleted: Int) {
            if (deleted > 0) receipts += receipt(familyId, ctx.deviceId, category, deleted, cutoffMillis, nowUtc, "expiry")
        }

        record("UsageSession", database.usageSessionDao().deleteOlderThanForDevice(ctx.deviceId, cutoffMillis))
        record("WebVisit", database.webVisitDao().deleteOlderThanForDevice(ctx.deviceId, cutoffMillis))
        record("ContentBlockEvent", database.contentBlockEventDao().deleteOlderThanForDevice(ctx.deviceId, cutoffMillis))
        record("BreakSession", database.breakSessionDao().deleteOlderThanForDevice(ctx.deviceId, cutoffMillis))
        record("ProximityEvent", database.proximityEventDao().deleteOlderThanForDevice(ctx.deviceId, cutoffMillis))
        record("PrayerReminderEvent", database.prayerReminderEventDao().deleteOlderThanForDevice(ctx.deviceId, cutoffMillis))

        return receipts
    }

    private fun receipt(
        familyId: String,
        deviceId: String?,
        category: String,
        deletedCount: Int,
        cutoffEpochMillis: Long,
        nowUtc: Instant,
        reason: String,
    ) = RetentionDeletionReceiptEntity(
        id = UUID.randomUUID().toString(),
        familyId = familyId,
        deviceId = deviceId,
        entityCategory = category,
        deletedCount = deletedCount,
        cutoffEpochMillis = cutoffEpochMillis,
        createdAtEpochMillis = nowUtc.toEpochMilli(),
        reason = reason,
    )
}
