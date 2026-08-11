package org.pca.app.persistence

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import org.pca.app.persistence.dao.BreakSessionDao
import org.pca.app.persistence.dao.ContentBlockEventDao
import org.pca.app.persistence.dao.DeviceDao
import org.pca.app.persistence.dao.DeviceKeyMetadataDao
import org.pca.app.persistence.dao.FamilyMemberDao
import org.pca.app.persistence.dao.LocationPointDao
import org.pca.app.persistence.dao.ParentActionAuditDao
import org.pca.app.persistence.dao.PolicyReceiptDao
import org.pca.app.persistence.dao.PolicySnapshotDao
import org.pca.app.persistence.dao.PrayerReminderEventDao
import org.pca.app.persistence.dao.ProximityEventDao
import org.pca.app.persistence.dao.RetentionDeletionReceiptDao
import org.pca.app.persistence.dao.SyncOutboxDao
import org.pca.app.persistence.dao.SyncReceiptDao
import org.pca.app.persistence.dao.TamperEventDao
import org.pca.app.persistence.dao.UsageSessionDao
import org.pca.app.persistence.dao.WebVisitDao
import org.pca.app.persistence.entity.BreakSessionEntity
import org.pca.app.persistence.entity.ContentBlockEventEntity
import org.pca.app.persistence.entity.DeviceEntity
import org.pca.app.persistence.entity.DeviceKeyMetadataEntity
import org.pca.app.persistence.entity.FamilyMemberEntity
import org.pca.app.persistence.entity.LocationPointEntity
import org.pca.app.persistence.entity.ParentActionAuditEntity
import org.pca.app.persistence.entity.PolicyReceiptEntity
import org.pca.app.persistence.entity.PolicySnapshotEntity
import org.pca.app.persistence.entity.PrayerReminderEventEntity
import org.pca.app.persistence.entity.ProximityEventEntity
import org.pca.app.persistence.entity.RetentionDeletionReceiptEntity
import org.pca.app.persistence.entity.SyncOutboxRecordEntity
import org.pca.app.persistence.entity.SyncReceiptRecordEntity
import org.pca.app.persistence.entity.TamperEventEntity
import org.pca.app.persistence.entity.UsageSessionEntity
import org.pca.app.persistence.entity.WebVisitEntity

/**
 * PCA-LOCAL-DB-1: the single canonical Android on-device structured
 * database (Section 4). Entities implement doc 10's approved logical local
 * data model (storage-engine selection is left to this document, per doc 10
 * Section 11). This is NOT MySQL and mobile apps never connect directly to
 * the central MySQL database (doc 05 Section 3.3/3.4 boundary) -- this
 * database exists only on this trusted device (Section 7).
 *
 * `exportSchema = true`: versioned schema JSON is written to
 * `android/app/schemas/org.pca.app.persistence.PcaLocalDatabase/<version>.json`
 * (configured via the `room.schemaLocation` KSP arg in build.gradle.kts) and
 * consumed by [androidx.room.testing.MigrationTestHelper] in migration
 * tests -- Section 22.
 *
 * No `fallbackToDestructiveMigration()` is used anywhere this database is
 * built for real family data (Section 4) -- schema changes MUST ship an
 * explicit [androidx.room.migration.Migration].
 */
@Database(
    version = PcaLocalDatabase.VERSION,
    exportSchema = true,
    entities = [
        FamilyMemberEntity::class,
        DeviceEntity::class,
        PolicySnapshotEntity::class,
        UsageSessionEntity::class,
        WebVisitEntity::class,
        ContentBlockEventEntity::class,
        LocationPointEntity::class,
        BreakSessionEntity::class,
        ProximityEventEntity::class,
        PrayerReminderEventEntity::class,
        DeviceKeyMetadataEntity::class,
        PolicyReceiptEntity::class,
        TamperEventEntity::class,
        ParentActionAuditEntity::class,
        RetentionDeletionReceiptEntity::class,
        SyncOutboxRecordEntity::class,
        SyncReceiptRecordEntity::class,
    ],
)
@TypeConverters(Converters::class)
abstract class PcaLocalDatabase : RoomDatabase() {
    abstract fun familyMemberDao(): FamilyMemberDao
    abstract fun deviceDao(): DeviceDao
    abstract fun policySnapshotDao(): PolicySnapshotDao
    abstract fun usageSessionDao(): UsageSessionDao
    abstract fun webVisitDao(): WebVisitDao
    abstract fun contentBlockEventDao(): ContentBlockEventDao
    abstract fun locationPointDao(): LocationPointDao
    abstract fun breakSessionDao(): BreakSessionDao
    abstract fun proximityEventDao(): ProximityEventDao
    abstract fun prayerReminderEventDao(): PrayerReminderEventDao
    abstract fun deviceKeyMetadataDao(): DeviceKeyMetadataDao
    abstract fun policyReceiptDao(): PolicyReceiptDao
    abstract fun tamperEventDao(): TamperEventDao
    abstract fun parentActionAuditDao(): ParentActionAuditDao
    abstract fun retentionDeletionReceiptDao(): RetentionDeletionReceiptDao
    abstract fun syncOutboxDao(): SyncOutboxDao
    abstract fun syncReceiptDao(): SyncReceiptDao

    companion object {
        const val VERSION = 1
        const val DATABASE_NAME = "pca_local.db"

        /**
         * Real Android builder. Deliberately does NOT call
         * `fallbackToDestructiveMigration()` (Section 4) -- an unhandled
         * future schema change fails loudly (`IllegalStateException`)
         * rather than silently deleting family data.
         */
        fun build(context: Context): PcaLocalDatabase =
            Room.databaseBuilder(context.applicationContext, PcaLocalDatabase::class.java, DATABASE_NAME)
                .addMigrations(*Migrations.ALL)
                .build()
    }
}
