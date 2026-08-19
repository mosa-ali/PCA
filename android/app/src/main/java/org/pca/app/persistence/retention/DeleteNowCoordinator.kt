package org.pca.app.persistence.retention

import androidx.room.withTransaction
import java.time.Instant
import java.util.UUID
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.entity.RetentionDeletionReceiptEntity
import org.pca.app.persistence.entity.TombstoneRecordEntity

/**
 * PCA-LOCAL-DB-1 Section 21: one local DB deletion coordinator entrypoint
 * for "Delete Now." Every deletion path runs inside a single Room
 * transaction (Section 24: interrupted "Delete Now" must not leave a
 * half-deleted family) and returns a non-sensitive receipt (counts only,
 * doc 11 Section 5 step 7).
 *
 * Does NOT delete: platform keys, account bootstrap, or other families'
 * data -- only the requested scope (Section 21).
 *
 * PCA-DATA-026: alongside the existing count-only [RetentionDeletionReceiptEntity], each deletion
 * here also writes ONE [TombstoneRecordEntity] row for the top-level identity that was actually
 * deleted (the device id / member id / family id itself -- not one row per underlying table),
 * matching the requirement's own "ID + deletion timestamp only, no content" shape. This is the
 * local-side half of "delete-now-to-outbox propagation" (see [org.pca.app.runtime.graph.PcaAppGraph]'s
 * `familySyncRuntimePort` doc comment for the external, crypto-gated half this lane does not cross).
 */
class DeleteNowCoordinator(private val database: PcaLocalDatabase) {

    /** Deletes every local activity row scoped to [deviceId], preserving family configuration and audit rows. */
    suspend fun deleteDevice(familyId: String, deviceId: String, nowUtc: Instant): RetentionDeletionReceiptEntity {
        require(familyId.isNotBlank() && deviceId.isNotBlank()) { "delete scope is not available" }
        return database.withTransaction {
            val device = database.deviceDao().getById(deviceId)
            if (device != null) {
                requireDeviceBelongsToFamily(familyId, device.memberId)
            }
            val total = if (device == null) 0 else deleteDeviceScopedRows(deviceId)
            if (device != null) {
                insertTombstone(familyId, deviceId, "Device", nowUtc)
            }
            insertReceipt(familyId, deviceId, "device_all_categories", total, nowUtc, "delete_now_device")
        }
    }

    /** Deletes activity rows belonging to one family member (a child, across all their devices), preserving the member record. */
    suspend fun deleteChild(familyId: String, memberId: String, childDeviceIds: List<String>, nowUtc: Instant): RetentionDeletionReceiptEntity {
        require(familyId.isNotBlank() && memberId.isNotBlank()) { "delete scope is not available" }
        return database.withTransaction {
            requireDeviceBelongsToFamily(familyId, memberId)
            val actualDeviceIds = database.deviceDao().getAll()
                .filter { it.memberId == memberId }
                .map { it.deviceId }
                .toSet()
            require(childDeviceIds.distinct().size == childDeviceIds.size && childDeviceIds.all { it in actualDeviceIds }) {
                "delete scope is not available"
            }
            var total = 0
            // The database relation is authoritative. A stale caller list
            // cannot omit a newly enrolled device from a child-wide delete.
            for (deviceId in actualDeviceIds) {
                total += deleteDeviceScopedRows(deviceId)
            }
            insertTombstone(familyId, memberId, "FamilyMember", nowUtc)
            insertReceipt(familyId, null, "child_all_categories", total, nowUtc, "delete_now_child:$memberId")
        }
    }

    /** Every general activity table keyed by `deviceId`; protected policy, key, membership, and audit rows are not Delete Now targets. */
    private suspend fun deleteDeviceScopedRows(deviceId: String): Int {
        var total = 0
        total += database.usageSessionDao().deleteAllForDevice(deviceId)
        total += database.webVisitDao().deleteAllForDevice(deviceId)
        total += database.contentBlockEventDao().deleteAllForDevice(deviceId)
        total += database.locationPointDao().deleteAllForDevice(deviceId)
        total += database.breakSessionDao().deleteAllForDevice(deviceId)
        total += database.proximityEventDao().deleteAllForDevice(deviceId)
        total += database.prayerReminderEventDao().deleteAllForDevice(deviceId)
        total += database.installedAppEventDao().deleteAllForDevice(deviceId)
        return total
    }

    /**
     * Family-wide Delete Now (doc 11 Section 6) -- wipes activity rows that
     * belong to [familyId], scoped via SQL joins through
     * `family_members`/`devices`. Protected family configuration, current
     * policies/keys, roles, and audit rows remain intact; family/device
     * removal is a separate lifecycle flow.
     */
    suspend fun deleteFamily(familyId: String, nowUtc: Instant): RetentionDeletionReceiptEntity {
        require(familyId.isNotBlank()) { "delete scope is not available" }
        return database.withTransaction {
            var total = 0
            // Tables scoped via devices -> family_members.
            total += database.usageSessionDao().deleteAllForFamily(familyId)
            total += database.webVisitDao().deleteAllForFamily(familyId)
            total += database.contentBlockEventDao().deleteAllForFamily(familyId)
            total += database.locationPointDao().deleteAllForFamily(familyId)
            total += database.breakSessionDao().deleteAllForFamily(familyId)
            total += database.proximityEventDao().deleteAllForFamily(familyId)
            total += database.prayerReminderEventDao().deleteAllForFamily(familyId)
            total += database.installedAppEventDao().deleteAllForFamily(familyId)
            // Queued family ciphertext is an activity replica; remove it for
            // a family-wide purge while keeping current policy/status rows.
            total += database.syncOutboxDao().deleteAllForFamily(familyId)
            total += database.syncReceiptDao().deleteAllForFamily(familyId)
            insertTombstone(familyId, familyId, "Family", nowUtc)
            insertReceipt(familyId, null, "family_all_categories", total, nowUtc, "delete_now_family")
        }
    }

    /**
     * Delete scope ids are untrusted local caller input. Keep the failure
     * deliberately generic so a caller cannot use this boundary as a
     * cross-family membership oracle.
     */
    private suspend fun requireDeviceBelongsToFamily(familyId: String, memberId: String) {
        val member = database.familyMemberDao().getById(memberId)
        require(member?.familyId == familyId) { "delete scope is not available" }
    }

    private suspend fun insertTombstone(familyId: String, recordId: String, recordCategory: String, nowUtc: Instant) {
        database.tombstoneRecordDao().insert(
            TombstoneRecordEntity(
                id = UUID.randomUUID().toString(),
                familyId = familyId,
                recordId = recordId,
                recordCategory = recordCategory,
                deletedAtEpochMillis = nowUtc.toEpochMilli(),
            ),
        )
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
