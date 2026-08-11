package org.pca.app.persistence.sync

import org.pca.app.persistence.dao.SyncReceiptDao
import org.pca.app.persistence.entity.SyncReceiptApplicationState
import org.pca.app.persistence.entity.SyncReceiptRecordEntity

enum class ReceiptOutcome { APPLIED, DUPLICATE_IGNORED, STALE_EPOCH_REJECTED, OUT_OF_ORDER_REJECTED }

/**
 * doc 09 Section 5.1 / PCA-LOCAL-DB-1 Section 19. Protects against:
 *  - duplicate receipt: `messageId` primary key + [SyncReceiptDao.insertIfAbsent] IGNORE.
 *  - stale epoch: rejects a receipt whose `keyEpoch` is behind [currentKeyEpoch].
 *  - out-of-order receipt: rejects a `sequence` not greater than the highest
 *    already-applied sequence for that family scope.
 */
class SyncReceiptRepository(private val dao: SyncReceiptDao) {
    suspend fun apply(
        messageId: String,
        familyScope: String,
        senderScope: String,
        sequence: Long,
        keyEpoch: Long,
        currentKeyEpoch: Long,
        receivedAtEpochMillis: Long,
    ): ReceiptOutcome {
        if (keyEpoch < currentKeyEpoch) {
            dao.insertIfAbsent(
                SyncReceiptRecordEntity(
                    messageId = messageId,
                    familyScope = familyScope,
                    senderScope = senderScope,
                    sequence = sequence,
                    keyEpoch = keyEpoch,
                    applicationState = SyncReceiptApplicationState.STALE_EPOCH_REJECTED,
                    receivedAtEpochMillis = receivedAtEpochMillis,
                    appliedAtEpochMillis = null,
                ),
            )
            return ReceiptOutcome.STALE_EPOCH_REJECTED
        }

        val maxSequence = dao.getMaxSequence(familyScope) ?: -1L
        val state = if (sequence <= maxSequence) {
            SyncReceiptApplicationState.OUT_OF_ORDER_REJECTED
        } else {
            SyncReceiptApplicationState.APPLIED
        }

        val insertedRowId = dao.insertIfAbsent(
            SyncReceiptRecordEntity(
                messageId = messageId,
                familyScope = familyScope,
                senderScope = senderScope,
                sequence = sequence,
                keyEpoch = keyEpoch,
                applicationState = state,
                receivedAtEpochMillis = receivedAtEpochMillis,
                appliedAtEpochMillis = if (state == SyncReceiptApplicationState.APPLIED) receivedAtEpochMillis else null,
            ),
        )
        if (insertedRowId == -1L) return ReceiptOutcome.DUPLICATE_IGNORED

        return when (state) {
            SyncReceiptApplicationState.APPLIED -> ReceiptOutcome.APPLIED
            SyncReceiptApplicationState.OUT_OF_ORDER_REJECTED -> ReceiptOutcome.OUT_OF_ORDER_REJECTED
            else -> ReceiptOutcome.OUT_OF_ORDER_REJECTED
        }
    }
}
