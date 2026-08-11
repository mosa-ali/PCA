package org.pca.app.persistence.retention

import androidx.room.withTransaction
import java.time.Instant
import java.util.UUID
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.entity.RetentionDeletionReceiptEntity

/**
 * PCA-LOCAL-DB-1 Section 21: one local DB deletion coordinator entrypoint
 * for "Delete Now." Every deletion path runs inside a single Room
 * transaction (Section 24: interrupted "Delete Now" must not leave a
 * half-deleted family) and returns a non-sensitive receipt (counts only,
 * doc 11 Section 5 step 7).
 *
 * Does NOT delete: platform keys, account bootstrap, or other families'
 * data -- only the requested scope (Section 21).
 */
class DeleteNowCoordinator(private val database: PcaLocalDatabase) {

    /** Deletes every local row scoped to [deviceId] across all activity/security tables owned by that device. */
    suspend fun deleteDevice(familyId: String, deviceId: String, nowUtc: Instant): RetentionDeletionReceiptEntity {
        var total = 0
        database.withTransaction {
            total += database.usageSessionDao().deleteAllForDevice(deviceId)
            total += database.webVisitDao().deleteAllForDevice(deviceId)
            total += database.contentBlockEventDao().deleteAllForDevice(deviceId)
            total += database.locationPointDao().deleteAllForDevice(deviceId)
            total += database.breakSessionDao().deleteAllForDevice(deviceId)
            total += database.proximityEventDao().deleteAllForDevice(deviceId)
            total += database.prayerReminderEventDao().deleteAllForDevice(deviceId)
            total += database.tamperEventDao().deleteAllForDevice(deviceId)
            total += database.policyReceiptDao().deleteAllForDevice(deviceId)
            total += database.deviceKeyMetadataDao().deleteAllForDevice(deviceId)
            total += database.deviceDao().deleteById(deviceId)
        }
        return insertReceipt(familyId, deviceId, "device_all_categories", total, nowUtc, "delete_now_device")
    }

    /** Deletes every local row belonging to one family member (a child, across all their devices) plus the member record itself. */
    suspend fun deleteChild(familyId: String, memberId: String, childDeviceIds: List<String>, nowUtc: Instant): RetentionDeletionReceiptEntity {
        var total = 0
        database.withTransaction {
            for (deviceId in childDeviceIds) {
                total += database.usageSessionDao().deleteAllForDevice(deviceId)
                total += database.webVisitDao().deleteAllForDevice(deviceId)
                total += database.contentBlockEventDao().deleteAllForDevice(deviceId)
                total += database.locationPointDao().deleteAllForDevice(deviceId)
                total += database.breakSessionDao().deleteAllForDevice(deviceId)
                total += database.proximityEventDao().deleteAllForDevice(deviceId)
                total += database.prayerReminderEventDao().deleteAllForDevice(deviceId)
                total += database.tamperEventDao().deleteAllForDevice(deviceId)
                total += database.policyReceiptDao().deleteAllForDevice(deviceId)
                total += database.deviceKeyMetadataDao().deleteAllForDevice(deviceId)
                total += database.deviceDao().deleteById(deviceId)
            }
            total += database.parentActionAuditDao().deleteAllForActor(memberId)
            total += database.familyMemberDao().deleteById(memberId)
        }
        return insertReceipt(familyId, null, "child_all_categories", total, nowUtc, "delete_now_child:$memberId")
    }

    /** Full family local deletion (doc 11 Section 6) -- wipes every family-scoped table in this local database. */
    suspend fun deleteFamily(familyId: String, nowUtc: Instant): RetentionDeletionReceiptEntity {
        var total = 0
        database.withTransaction {
            total += database.usageSessionDao().deleteOlderThan(Long.MAX_VALUE)
            total += database.webVisitDao().deleteOlderThan(Long.MAX_VALUE)
            total += database.contentBlockEventDao().deleteOlderThan(Long.MAX_VALUE)
            total += database.locationPointDao().deleteOlderThan(Long.MAX_VALUE)
            total += database.breakSessionDao().deleteOlderThan(Long.MAX_VALUE)
            total += database.proximityEventDao().deleteOlderThan(Long.MAX_VALUE)
            total += database.prayerReminderEventDao().deleteOlderThan(Long.MAX_VALUE)
            total += database.tamperEventDao().deleteAll()
            total += database.parentActionAuditDao().deleteAll()
            total += database.policyReceiptDao().deleteAll()
            total += database.deviceKeyMetadataDao().deleteAll()
            total += database.policySnapshotDao().deleteAll()
            total += database.deviceDao().deleteAll()
            total += database.syncOutboxDao().deleteAllForFamily(familyId)
            total += database.syncReceiptDao().deleteAllForFamily(familyId)
            total += database.familyMemberDao().deleteAllForFamily(familyId)
        }
        return insertReceipt(familyId, null, "family_all_categories", total, nowUtc, "delete_now_family")
    }

    private suspend fun insertReceipt(
        familyId: String,
        deviceId: String?,
        category: String,
        deletedCount: Int,
        nowUtc: Instant,
        reason: String,
    ): RetentionDeletionReceiptEntity {
        val receipt = RetentionDeletionReceiptEntity(
            id = UUID.randomUUID().toString(),
            familyId = familyId,
            deviceId = deviceId,
            entityCategory = category,
            deletedCount = deletedCount,
            cutoffEpochMillis = nowUtc.toEpochMilli(),
            createdAtEpochMillis = nowUtc.toEpochMilli(),
            reason = reason,
        )
        database.retentionDeletionReceiptDao().insert(receipt)
        return receipt
    }
}
