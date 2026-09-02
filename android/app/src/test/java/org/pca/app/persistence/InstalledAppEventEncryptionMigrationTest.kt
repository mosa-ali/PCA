package org.pca.app.persistence

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * PCA-LOCAL-DB-1 Section 8 / Section 22. The instrumented
 * `PcaLocalDatabaseMigrationTest.migrate5To6...` case validates this migration against the exported
 * schema JSON, but `MigrationTestHelper` needs real instrumentation and so never runs in
 * `testDebugUnitTest` -- this is the JVM-runnable half that actually EXECUTES
 * [Migrations.MIGRATION_5_6]'s SQL against a real SQLite database and asserts its two security
 * properties directly:
 *
 * 1. no row carrying the pre-migration PLAINTEXT `packageName`/`appLabel` survives the upgrade
 *    (the migration cannot encrypt them -- it has no access to the AndroidKeyStore-backed cipher --
 *    and copying them across unencrypted would defeat the fix; see the migration's own doc
 *    comment), and
 * 2. the rebuilt table really has the encrypted column pairs and both of the indices `DROP TABLE`
 *    would otherwise have taken with it.
 */
@RunWith(RobolectricTestRunner::class)
class InstalledAppEventEncryptionMigrationTest {
    private lateinit var db: PcaLocalDatabase

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `migration 5 to 6 discards plaintext rows and rebuilds the encrypted schema with its indices`() {
        val sqlite = db.openHelper.writableDatabase

        // Recreate the exact pre-migration (version 5) shape of the table, then seed the plaintext
        // row this migration exists to make impossible.
        sqlite.execSQL("DROP TABLE IF EXISTS `installed_app_events`")
        sqlite.execSQL(
            "CREATE TABLE `installed_app_events` (" +
                "`id` TEXT NOT NULL, `deviceId` TEXT NOT NULL, `packageName` TEXT NOT NULL, " +
                "`appLabel` TEXT, `installedAtEpochMillis` INTEGER NOT NULL, " +
                "`observedAtEpochMillis` INTEGER NOT NULL, PRIMARY KEY(`id`))",
        )
        sqlite.execSQL(
            "INSERT INTO installed_app_events (id, deviceId, packageName, appLabel, installedAtEpochMillis, observedAtEpochMillis) " +
                "VALUES ('i-old', 'device-1', 'com.example.plaintext', 'Plaintext App', 1000, 1500)",
        )

        Migrations.MIGRATION_5_6.migrate(sqlite)

        sqlite.query("SELECT COUNT(*) FROM installed_app_events").use { cursor ->
            assertTrue(cursor.moveToFirst())
            assertEquals("no plaintext installed-app row may survive the encryption migration", 0, cursor.getInt(0))
        }

        // The rebuilt table accepts the encrypted column pairs (and only those).
        sqlite.execSQL(
            "INSERT INTO installed_app_events (id, deviceId, packageNameEnc, packageNameIv, appLabelEnc, appLabelIv, " +
                "installedAtEpochMillis, observedAtEpochMillis) " +
                "VALUES ('i-new', 'device-1', 'cipher-b64', 'iv-b64', NULL, NULL, 2000, 2500)",
        )
        sqlite.query("SELECT packageNameEnc, packageNameIv, appLabelEnc FROM installed_app_events WHERE id = 'i-new'").use { cursor ->
            assertTrue(cursor.moveToFirst())
            assertEquals("cipher-b64", cursor.getString(0))
            assertEquals("iv-b64", cursor.getString(1))
            assertTrue(cursor.isNull(2))
        }

        val indexNames = mutableSetOf<String>()
        sqlite.query("PRAGMA index_list(`installed_app_events`)").use { cursor ->
            val nameColumn = cursor.getColumnIndex("name")
            while (cursor.moveToNext()) indexNames += cursor.getString(nameColumn)
        }
        assertTrue(
            "DROP TABLE also drops the table's indices -- the migration must recreate both; found $indexNames",
            indexNames.containsAll(
                setOf(
                    "index_installed_app_events_deviceId",
                    "index_installed_app_events_installedAtEpochMillis",
                ),
            ),
        )
    }

    /**
     * Section 4/22: no `fallbackToDestructiveMigration()` anywhere, so an unbroken 1..VERSION chain
     * is what stands between a schema bump and a loud `IllegalStateException` on a real device's
     * existing family data. Fails the moment a version is bumped without registering its migration.
     */
    @Test
    fun `every database version step has a registered migration`() {
        val steps = Migrations.ALL.map { it.startVersion to it.endVersion }.toSet()
        val expected = (1 until PcaLocalDatabase.VERSION).map { it to it + 1 }.toSet()
        assertEquals(expected, steps)
    }
}
