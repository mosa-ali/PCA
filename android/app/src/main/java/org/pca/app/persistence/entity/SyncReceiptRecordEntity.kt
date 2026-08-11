package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 09 Section 5.1 / PCA-LOCAL-DB-1 Section 19. Acknowledgement/receipt
 * for an inbound synced message. `messageId` is the PRIMARY KEY (not just
 * indexed) so a duplicate-delivery insert is rejected by the DB itself --
 * idempotency is a schema-level guarantee, not only an application check
 * (protects against duplicate receipt). `sequence` plus `applicationState`
 * let the repository reject out-of-order/stale-epoch receipts.
 */
@Entity(
    tableName = "sync_receipt_records",
    indices = [Index("familyScope"), Index("sequence")],
)
data class SyncReceiptRecordEntity(
    @PrimaryKey val messageId: String,
    val familyScope: String,
    val senderScope: String,
    val sequence: Long,
    val keyEpoch: Long,
    val applicationState: SyncReceiptApplicationState,
    val receivedAtEpochMillis: Long,
    val appliedAtEpochMillis: Long?,
)
