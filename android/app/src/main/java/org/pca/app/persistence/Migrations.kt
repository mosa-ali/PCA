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

    /**
     * PCA-DATA-026 (WRITER68): adds `tombstone_records` -- a minimal, content-free (id + deletion
     * timestamp only, per the requirement) proof-of-deletion table with its own bounded-lifetime
     * pruning (see [org.pca.app.persistence.retention.RetentionEngine.pruneTombstones]). A brand
     * new table, so this migration is purely additive -- no existing row's meaning changes.
     */
    val MIGRATION_2_3 = object : Migration(2, 3) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `tombstone_records` (" +
                    "`id` TEXT NOT NULL, `familyId` TEXT NOT NULL, `recordId` TEXT NOT NULL, " +
                    "`recordCategory` TEXT NOT NULL, `deletedAtEpochMillis` INTEGER NOT NULL, " +
                    "PRIMARY KEY(`id`))",
            )
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_tombstone_records_familyId` ON `tombstone_records` (`familyId`)")
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS `index_tombstone_records_deletedAtEpochMillis` " +
                    "ON `tombstone_records` (`deletedAtEpochMillis`)",
            )
        }
    }

    /**
     * PCA-FR-045/PCA-FR-131 (WRITER69): adds `installed_app_events` -- a new, purely additive
     * table for the install-observer receiver's "a new app install was observed" records. No
     * existing table/row is touched.
     */
    val MIGRATION_3_4 = object : Migration(3, 4) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `installed_app_events` (" +
                    "`id` TEXT NOT NULL, `deviceId` TEXT NOT NULL, `packageName` TEXT NOT NULL, " +
                    "`appLabel` TEXT, `installedAtEpochMillis` INTEGER NOT NULL, " +
                    "`observedAtEpochMillis` INTEGER NOT NULL, PRIMARY KEY(`id`))",
            )
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_installed_app_events_deviceId` ON `installed_app_events` (`deviceId`)")
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS `index_installed_app_events_installedAtEpochMillis` " +
                    "ON `installed_app_events` (`installedAtEpochMillis`)",
            )
        }
    }

    /**
     * PCA-FR-140: adds `enrollment_lifecycle_audits` -- durable, device-local storage for
     * [org.pca.app.enrollment.EnrollmentLifecycleAuditor]'s transition records, replacing the
     * previous in-memory-only default sink. A brand new table, so this migration is purely
     * additive -- no existing row's meaning changes.
     */
    val MIGRATION_4_5 = object : Migration(4, 5) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `enrollment_lifecycle_audits` (" +
                    "`id` TEXT NOT NULL, `familyId` TEXT, `deviceId` TEXT NOT NULL, `actorId` TEXT NOT NULL, " +
                    "`fromState` TEXT, `toState` TEXT NOT NULL, `reason` TEXT NOT NULL, " +
                    "`occurredAtEpochMillis` INTEGER NOT NULL, PRIMARY KEY(`id`))",
            )
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_enrollment_lifecycle_audits_deviceId` ON `enrollment_lifecycle_audits` (`deviceId`)")
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS `index_enrollment_lifecycle_audits_occurredAtEpochMillis` " +
                    "ON `enrollment_lifecycle_audits` (`occurredAtEpochMillis`)",
            )
        }
    }

    /**
     * PCA-LOCAL-DB-1 Section 8 security fix: `installed_app_events.packageName`/`appLabel` were
     * stored in PLAINTEXT while the sibling `usage_sessions.appOrCategoryTokenEnc` encrypts the
     * identical class of family-sensitive value (see [org.pca.app.persistence.entity.InstalledAppEventEntity]'s
     * own doc comment). This replaces both with the repo-standard encrypted column pair
     * (`<field>Enc` + `<field>Iv`, Base64 `TEXT`, per [org.pca.app.persistence.crypto.EncryptedFieldCodec]).
     *
     * The pre-migration rows are DROPPED rather than carried across. This is deliberate and is the
     * only honest option available here: a [androidx.room.migration.Migration] runs inside Room's
     * own schema-upgrade transaction with nothing but a [SupportSQLiteDatabase], so it has no
     * access to the `AndroidKeyStore`-backed [org.pca.app.persistence.crypto.LocalRecordCipher]
     * needed to encrypt the existing values -- and copying them into the new columns unencrypted
     * would silently defeat the very fix this migration exists to apply, leaving plaintext package
     * names on disk under a column name that claims otherwise. `installed_app_events` is a
     * device-local, retention-bounded visibility log (pruned by
     * [org.pca.app.persistence.retention.RetentionEngine] on the general retention policy, 14 days
     * by default) whose rows are re-observed from the OS as new installs happen; it holds no
     * decision/approval state and nothing else references its rows, so discarding the pre-upgrade
     * window is a bounded, recoverable cost, whereas retaining plaintext is not.
     *
     * `DROP TABLE` also drops that table's indices, so both are recreated below with the exact
     * names Room's generated schema expects.
     */
    val MIGRATION_5_6 = object : Migration(5, 6) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("DROP TABLE IF EXISTS `installed_app_events`")
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `installed_app_events` (" +
                    "`id` TEXT NOT NULL, `deviceId` TEXT NOT NULL, `packageNameEnc` TEXT NOT NULL, " +
                    "`packageNameIv` TEXT NOT NULL, `appLabelEnc` TEXT, `appLabelIv` TEXT, " +
                    "`installedAtEpochMillis` INTEGER NOT NULL, " +
                    "`observedAtEpochMillis` INTEGER NOT NULL, PRIMARY KEY(`id`))",
            )
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_installed_app_events_deviceId` ON `installed_app_events` (`deviceId`)")
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS `index_installed_app_events_installedAtEpochMillis` " +
                    "ON `installed_app_events` (`installedAtEpochMillis`)",
            )
        }
    }

    val ALL: Array<Migration> = arrayOf(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6)
}
