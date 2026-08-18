package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.DeviceEnrollmentState
import org.pca.app.persistence.entity.DeviceEntity
import org.pca.app.persistence.entity.DevicePlatform
import org.pca.app.persistence.entity.DeviceTrustState
import org.pca.app.persistence.entity.FamilyMemberEntity
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus
import org.pca.app.persistence.entity.ParentActionAuditEntity
import org.pca.app.persistence.entity.ParentActionType
import org.pca.app.persistence.entity.TamperEventEntity
import org.pca.app.persistence.export.AuditRecordExportService
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AuditRecordExportServiceTest {
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
    fun `export contains chronological action and tamper records only for requested family`() = runTest {
        db.familyMemberDao().upsert(
            FamilyMemberEntity("member-a", "family-a", FamilyMemberRole.OWNER, "enc", "iv", FamilyMemberStatus.ACTIVE, "PARENT", 1L),
        )
        db.familyMemberDao().upsert(
            FamilyMemberEntity("member-b", "family-b", FamilyMemberRole.OWNER, "enc", "iv", FamilyMemberStatus.ACTIVE, "PARENT", 1L),
        )
        db.deviceDao().upsert(
            DeviceEntity("device-a", "member-a", DevicePlatform.ANDROID, "35", "1", "signing", "encryption", 1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 3L, "{}"),
        )
        db.deviceDao().upsert(
            DeviceEntity("device-b", "member-b", DevicePlatform.ANDROID, "35", "1", "signing", "encryption", 1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 4L, "{}"),
        )
        db.parentActionAuditDao().upsert(
            ParentActionAuditEntity("action-a", "member-a", ParentActionType.POLICY_EDIT, "policy-1", 20L, "encrypted-reason", "iv"),
        )
        db.tamperEventDao().upsert(TamperEventEntity("tamper-a", "device-a", "ROOT_DETECTED", 30L, null))
        db.parentActionAuditDao().upsert(
            ParentActionAuditEntity("action-b", "member-b", ParentActionType.DELETION, "policy-2", 40L, null, null),
        )
        db.tamperEventDao().upsert(TamperEventEntity("tamper-b", "device-b", "CLOCK_ROLLBACK", 50L, null))

        val export = JSONObject(AuditRecordExportService(db).exportFamily("family-a", 100L))
        val records = export.getJSONArray("records")

        assertEquals("pca-family-audit-export-v1", export.getString("schema"))
        assertEquals("family-a", export.getString("familyId"))
        assertEquals(100L, export.getLong("generatedAtEpochMillis"))
        assertEquals(2, records.length())
        assertEquals("TAMPER_EVENT", records.getJSONObject(0).getString("recordType"))
        assertEquals("PARENT_ACTION", records.getJSONObject(1).getString("recordType"))
        assertTrue(records.getJSONObject(1).getBoolean("reasonPresent"))
        assertFalse(export.toString().contains("encrypted-reason"))
        assertFalse(export.toString().contains("action-b"))
        assertFalse(export.toString().contains("tamper-b"))
    }
}
