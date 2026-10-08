package org.pca.app.runtime.usage

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.Migrations
import org.pca.app.persistence.PersistenceTestSupport
import org.robolectric.RobolectricTestRunner

/** Real SQLite execution complements the separately gated instrumented schema validation. */
@RunWith(RobolectricTestRunner::class)
class UsageProvenanceMigrationTest {
    @Test fun additiveMigrationPreservesHistoricalRowsAndIndices() {
        PersistenceTestSupport.inMemoryDb().useDatabase { db ->
            val sql = db.openHelper.writableDatabase
            sql.execSQL("DROP TABLE usage_sessions")
            sql.execSQL("CREATE TABLE usage_sessions (id TEXT NOT NULL PRIMARY KEY, deviceId TEXT NOT NULL, appOrCategoryTokenEnc TEXT NOT NULL, appOrCategoryTokenIv TEXT NOT NULL, startedAtEpochMillis INTEGER NOT NULL, endedAtEpochMillis INTEGER NOT NULL, durationMillis INTEGER NOT NULL, sourceConfidence TEXT NOT NULL)")
            sql.execSQL("CREATE INDEX index_usage_sessions_deviceId ON usage_sessions(deviceId)")
            sql.execSQL("CREATE INDEX index_usage_sessions_startedAtEpochMillis ON usage_sessions(startedAtEpochMillis)")
            sql.execSQL("INSERT INTO usage_sessions VALUES ('old', 'device', 'cipher', 'iv', 1000, 1200, 200, 'PLATFORM_API')")
            Migrations.MIGRATION_6_7.migrate(sql)
            sql.query("SELECT * FROM usage_sessions").use { row ->
                assertTrue(row.moveToFirst())
                for ((field, expected) in mapOf("id" to "old", "deviceId" to "device", "appOrCategoryTokenEnc" to "cipher", "appOrCategoryTokenIv" to "iv", "sourceConfidence" to "PLATFORM_API"))
                    assertEquals(expected, row.getString(row.getColumnIndexOrThrow(field)))
                for ((field, expected) in mapOf("startedAtEpochMillis" to 1000L, "endedAtEpochMillis" to 1200L, "durationMillis" to 200L))
                    assertEquals(expected, row.getLong(row.getColumnIndexOrThrow(field)))
                assertTrue(row.isNull(row.getColumnIndexOrThrow("observationProvenanceEnc")))
                assertTrue(row.isNull(row.getColumnIndexOrThrow("observationProvenanceIv")))
                assertFalse(row.moveToNext())
            }
            val indices = mutableSetOf<String>()
            sql.query("PRAGMA index_list(usage_sessions)").use { rows ->
                while (rows.moveToNext()) indices += rows.getString(rows.getColumnIndexOrThrow("name"))
            }
            assertTrue(indices.containsAll(setOf("index_usage_sessions_deviceId", "index_usage_sessions_startedAtEpochMillis")))
        }
    }
}
