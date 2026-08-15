package org.pca.app.persistence

import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test

/**
 * PCA-LOCAL-DB-1 Section 22/28: migration test harness against the exported
 * schema JSON in `android/app/schemas/`. Requires a device/emulator
 * (`MigrationTestHelper` needs real instrumentation) -- not runnable via
 * `testDebugUnitTest`; run via `connectedDebugAndroidTest` when a device is
 * available.
 *
 * PCA-RUNTIME-PERSIST-1 added [Migrations.MIGRATION_1_2] (outbox
 * priority/coalesceKey columns, Sections 12-14) -- per this file's own
 * standing instruction, that migration's `runMigrationsAndValidate` case is
 * added below alongside it. The next migration added to [Migrations.ALL]
 * MUST do the same -- an unhandled schema change failing this test is the
 * intended signal, not a test to relax.
 */
class PcaLocalDatabaseMigrationTest {
    @get:Rule
    val helper: MigrationTestHelper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        PcaLocalDatabase::class.java,
        emptyList(),
        FrameworkSQLiteOpenHelperFactory(),
    )

    @Test
    fun version1SchemaCreatesCleanly() {
        helper.createDatabase(TEST_DB_NAME, 1).close()
    }

    @Test
    fun migrate2To3CreatesTombstoneRecordsTable() {
        helper.createDatabase(TEST_DB_NAME, 2).close()

        val migrated = helper.runMigrationsAndValidate(TEST_DB_NAME, 3, true, Migrations.MIGRATION_2_3)
        migrated.execSQL(
            "INSERT INTO tombstone_records (id, familyId, recordId, recordCategory, deletedAtEpochMillis) " +
                "VALUES ('t1', 'family-1', 'device-1', 'Device', 1000)",
        )
        val cursor = migrated.query("SELECT recordId, recordCategory, deletedAtEpochMillis FROM tombstone_records WHERE id = 't1'")
        try {
            org.junit.Assert.assertTrue(cursor.moveToFirst())
            org.junit.Assert.assertEquals("device-1", cursor.getString(cursor.getColumnIndexOrThrow("recordId")))
            org.junit.Assert.assertEquals("Device", cursor.getString(cursor.getColumnIndexOrThrow("recordCategory")))
            org.junit.Assert.assertEquals(1000L, cursor.getLong(cursor.getColumnIndexOrThrow("deletedAtEpochMillis")))
        } finally {
            cursor.close()
            migrated.close()
        }
    }

    @Test
    fun migrate1To2AddsOutboxPriorityAndCoalesceKeyColumns() {
        helper.createDatabase(TEST_DB_NAME, 1).apply {
            execSQL(
                "INSERT INTO sync_outbox_records (messageId, familyScope, recipientScope, envelopeCipherEnc, " +
                    "envelopeCipherIv, sequence, state, retryCount, nextRetryAtEpochMillis, expiresAtEpochMillis, " +
                    "createdAtEpochMillis) VALUES ('msg-1', 'family-1', 'device-1', 'enc', 'iv', 1, 'PENDING', 0, NULL, 999999, 1000)",
            )
            close()
        }

        val migrated = helper.runMigrationsAndValidate(TEST_DB_NAME, 2, true, Migrations.MIGRATION_1_2)
        val cursor = migrated.query("SELECT priority, coalesceKey FROM sync_outbox_records WHERE messageId = 'msg-1'")
        try {
            org.junit.Assert.assertTrue(cursor.moveToFirst())
            org.junit.Assert.assertEquals(2, cursor.getInt(cursor.getColumnIndexOrThrow("priority")))
            org.junit.Assert.assertTrue(cursor.isNull(cursor.getColumnIndexOrThrow("coalesceKey")))
        } finally {
            cursor.close()
            migrated.close()
        }
    }

    private companion object {
        const val TEST_DB_NAME = "pca_local_migration_test.db"
    }
}
