package org.pca.app.persistence.retention

import androidx.room.withTransaction
import java.time.Instant
import java.util.UUID
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.entity.PolicySnapshotEntity
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
            total += deleteDeviceScopedRows(deviceId)
        }
        return insertReceipt(familyId, deviceId, "device_all_categories", total, nowUtc, "delete_now_device")
    }

    /** Deletes every local row belonging to one family member (a child, across all their devices) plus the member record itself. */
    suspend fun deleteChild(familyId: String, memberId: String, childDeviceIds: List<String>, nowUtc: Instant): RetentionDeletionReceiptEntity {
        var total = 0
        database.withTransaction {
            for (deviceId in childDeviceIds) {
                total += deleteDeviceScopedRows(deviceId)
            }
            total += database.parentActionAuditDao().deleteAllForActor(memberId)
            total += database.familyMemberDao().deleteById(memberId)
        }
        return insertReceipt(familyId, null, "child_all_categories", total, nowUtc, "delete_now_child:$memberId")
    }

    /** Every table keyed by `deviceId` (or `childDeviceId`), including [PolicySnapshotEntity] (F1 fix: previously left behind). */
    private suspend fun deleteDeviceScopedRows(deviceId: String): Int {
        var total = 0
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
        total += database.policySnapshotDao().deleteAllForDevice(deviceId)
        total += database.deviceDao().deleteById(deviceId)
        return total
    }

    /**
     * Full family local deletion (doc 11 Section 6) -- wipes every row that
     * belongs to [familyId], scoped via SQL joins through
     * `family_members`/`devices` (F2 fix: the prior implementation used
     * unscoped global deletes, which would erase every OTHER family sharing
     * this local database too -- see [org.pca.app.persistence.dao.FamilyScopeSql]).
     * Table order matters: every table whose scoping query joins through
     * `devices`/`family_members` MUST run before those two tables are
     * themselves deleted, or the join would already find nothing.
     */
    suspend fun deleteFamily(familyId: String, nowUtc: Instant): RetentionDeletionReceiptEntity {
        var total = 0
        database.withTransaction {
            // 1. Tables scoped via devices -> family_members (devices/family_members must still exist).
            total += database.usageSessionDao().deleteAllForFamily(familyId)
            total += database.webVisitDao().deleteAllForFamily(familyId)
            total += database.contentBlockEventDao().deleteAllForFamily(familyId)
            total += database.locationPointDao().deleteAllForFamily(familyId)
            total += database.breakSessionDao().deleteAllForFamily(familyId)
            total += database.proximityEventDao().deleteAllForFamily(familyId)
            total += database.prayerReminderEventDao().deleteAllForFamily(familyId)
            total += database.tamperEventDao().deleteAllForFamily(familyId)
            total += database.policyReceiptDao().deleteAllForFamily(familyId)
            total += database.deviceKeyMetadataDao().deleteAllForFamily(familyId)
            total += database.policySnapshotDao().deleteAllForFamily(familyId)
            // 2. Tables scoped via family_members directly.
            total += database.parentActionAuditDao().deleteAllForFamily(familyId)
            // 3. devices (scoped via family_members -- must run before family_members is deleted).
            total += database.deviceDao().deleteAllForFamily(familyId)
            // 4. Already-family-scoped by their own familyScope column.
            total += database.syncOutboxDao().deleteAllForFamily(familyId)
            total += database.syncReceiptDao().deleteAllForFamily(familyId)
            // 5. family_members last -- every subquery above depends on it still existing.
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
