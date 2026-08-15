package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * PCA-DATA-026: a minimal, content-free proof that a specific local identity's data was actually
 * deleted -- every column here is non-sensitive deletion METADATA (which identity, of what
 * category, deleted when), never the deleted content itself, satisfying the requirement's "ID +
 * deletion timestamp, no content" shape without literally being a two-column table (same
 * non-sensitive discipline [RetentionDeletionReceiptEntity] already follows one level up, at the
 * count/category granularity; this table is the record-identity-level complement to it, one row
 * per deleted top-level identity rather than per deletion cycle).
 *
 * [recordId] is the id of the thing that was deleted (a `deviceId`, family-member id, or family
 * id -- see [recordCategory]), NOT a reference to any row that still exists; by the time a
 * tombstone is written, the record it describes is already gone. [recordCategory] mirrors
 * [RetentionDeletionReceiptEntity.entityCategory]'s free-string convention. [familyId] is scoping
 * metadata (which family this proof-of-deletion belongs to), not deleted content either.
 *
 * Bounded lifetime (PCA-DATA-026's own requirement): [org.pca.app.persistence.retention.RetentionEngine.pruneTombstones]
 * deletes rows older than [org.pca.app.persistence.retention.RetentionCutoffCalculator]'s own
 * fixed tombstone floor -- a tombstone is deliberately NOT retained forever, since its only job is
 * to let a short post-deletion reconciliation window (e.g. a future sync convergence check)
 * distinguish "deleted" from "never existed," not to serve as a permanent deletion ledger.
 */
@Entity(
    tableName = "tombstone_records",
    indices = [Index("familyId"), Index("deletedAtEpochMillis")],
)
data class TombstoneRecordEntity(
    @PrimaryKey val id: String,
    val familyId: String,
    val recordId: String,
    val recordCategory: String,
    val deletedAtEpochMillis: Long,
)
