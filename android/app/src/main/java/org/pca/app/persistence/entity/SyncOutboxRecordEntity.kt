package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 09 Section 5.1 / PCA-LOCAL-DB-1 Section 18. Durable local outbox for
 * E2EE family sync -- MUST survive process death/reboot, hence a Room table
 * rather than an in-memory queue. `ciphertextEnvelope` is the ALREADY
 * E2EE-encrypted envelope produced upstream by the family key hierarchy
 * (doc 09); this table never holds plaintext payload in an
 * infrastructure-readable form, and additionally wraps it with
 * [org.pca.app.persistence.crypto.LocalRecordCipher] as this device's own
 * local-at-rest layer (defense in depth, not a substitute for the E2EE
 * envelope).
 */
@Entity(
    tableName = "sync_outbox_records",
    indices = [Index("familyScope"), Index("state"), Index("sequence")],
)
data class SyncOutboxRecordEntity(
    @PrimaryKey val messageId: String,
    val familyScope: String,
    val recipientScope: String,
    val envelopeCipherEnc: String,
    val envelopeCipherIv: String,
    val sequence: Long,
    val state: SyncOutboxState,
    val retryCount: Int,
    val nextRetryAtEpochMillis: Long?,
    val expiresAtEpochMillis: Long,
    val createdAtEpochMillis: Long,
)
