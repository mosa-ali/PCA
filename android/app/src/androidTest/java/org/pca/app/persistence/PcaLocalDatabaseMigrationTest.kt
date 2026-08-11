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
 * There is exactly one schema version today (Section 4 -- no migrations
 * exist yet), so this currently only validates that version 1 creates
 * cleanly against its own exported schema. The next migration added to
 * [Migrations.ALL] MUST add a `helper.runMigrationsAndValidate(...)` case
 * here alongside it -- an unhandled schema change failing this test is the
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

    private companion object {
        const val TEST_DB_NAME = "pca_local_migration_test.db"
    }
}
