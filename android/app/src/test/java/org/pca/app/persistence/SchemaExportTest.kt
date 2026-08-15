package org.pca.app.persistence

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM sanity check on the `exportSchema = true` artifact (Section 22)
 * -- catches "someone added an entity but the schema file wasn't
 * regenerated / committed" without needing Robolectric.
 */
class SchemaExportTest {
    private val schemaFile = locateSchemaFile()

    private fun locateSchemaFile(): File {
        val relative = "schemas/org.pca.app.persistence.PcaLocalDatabase/${PcaLocalDatabase.VERSION}.json"
        return listOf(File(relative), File("app/$relative"))
            .firstOrNull { it.exists() }
            ?: File(relative) // fall back so the assertion below reports a clear path, not an NPE
    }

    @Test
    fun `exported schema file exists for the current database version`() {
        assertTrue("Expected exported schema at ${schemaFile.path} (cwd=${File(".").absolutePath}) -- run a KSP build after any entity change", schemaFile.exists())
    }

    @Test
    fun `exported schema declares every entity table this module owns`() {
        val json = JSONObject(schemaFile.readText())
        val entities = json.getJSONObject("database").getJSONArray("entities")
        val tableNames = (0 until entities.length()).map { entities.getJSONObject(it).getString("tableName") }.toSet()

        val expected = setOf(
            "family_members", "devices", "policy_snapshots", "usage_sessions", "web_visits",
            "content_block_events", "location_points", "break_sessions", "proximity_events",
            "prayer_reminder_events", "device_key_metadata", "policy_receipts", "tamper_events",
            "parent_action_audits", "retention_deletion_receipts", "sync_outbox_records", "sync_receipt_records",
            "tombstone_records",
        )

        assertEquals(expected, tableNames)
    }
}
