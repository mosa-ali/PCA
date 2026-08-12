package org.pca.app.persistence

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import org.pca.app.persistence.entity.SyncOutboxRecordEntity

/**
 * Explicit migration registry (Section 22). The next entry added here MUST
 * come with a corresponding migration test using the exported schema JSON
 * in `android/app/schemas/`. Never rely on `fallbackToDestructiveMigration()`
 * as a substitute for an entry here (Section 4).
 */
object Migrations {
    /**
     * PCA-RUNTIME-PERSIST-1 Sections 12-14: adds local delivery-scheduling
     * metadata to `sync_outbox_records` -- `priority` (queue-bounds/priority
     * support) and `coalesceKey` (aggregation support). Both are additive,
     * nullable-or-defaulted columns; no existing row's meaning changes.
     * Existing rows backfill to [SyncOutboxRecordEntity.OUTBOX_PRIORITY_DEFAULT]
     * (PARENT_CHILD_DECISION-equivalent) since their true origin priority
     * was never recorded pre-migration.
     */
    val MIGRATION_1_2 = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                "ALTER TABLE sync_outbox_records ADD COLUMN priority INTEGER NOT NULL DEFAULT " +
                    "${SyncOutboxRecordEntity.OUTBOX_PRIORITY_DEFAULT}",
            )
            db.execSQL("ALTER TABLE sync_outbox_records ADD COLUMN coalesceKey TEXT")
            db.execSQL("CREATE INDEX IF NOT EXISTS index_sync_outbox_records_priority ON sync_outbox_records(priority)")
            db.execSQL("CREATE INDEX IF NOT EXISTS index_sync_outbox_records_coalesceKey ON sync_outbox_records(coalesceKey)")
        }
    }

    val ALL: Array<Migration> = arrayOf(MIGRATION_1_2)
}
