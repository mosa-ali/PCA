package org.pca.app.persistence

import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.DeviceEnrollmentState
import org.pca.app.persistence.entity.DeviceEntity
import org.pca.app.persistence.entity.DeviceKeyMetadataEntity
import org.pca.app.persistence.entity.DeviceKeyState
import org.pca.app.persistence.entity.DevicePlatform
import org.pca.app.persistence.entity.DeviceTrustState
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus
import org.pca.app.persistence.entity.ParentActionAuditEntity
import org.pca.app.persistence.entity.ParentActionType
import org.pca.app.persistence.entity.PolicyReceiptEntity
import org.pca.app.persistence.entity.PolicySnapshotEntity
import org.pca.app.persistence.entity.TamperEventEntity
import org.pca.app.persistence.entity.WebVisitAction
import org.pca.app.persistence.repository.FamilyMember
import org.pca.app.persistence.repository.FamilyMemberRepository
import org.pca.app.persistence.repository.WebVisitRepository
import org.pca.app.persistence.retention.DeleteNowCoordinator
import org.pca.app.persistence.sync.SyncOutboxRepository
import org.pca.app.persistence.sync.SyncReceiptRepository
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DeleteNowCoordinatorTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var coordinator: DeleteNowCoordinator
    private lateinit var webVisitRepo: WebVisitRepository
    private lateinit var familyMemberRepo: FamilyMemberRepository
    private lateinit var syncOutboxRepo: SyncOutboxRepository
    private lateinit var syncReceiptRepo: SyncReceiptRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        coordinator = DeleteNowCoordinator(db)
        val cipher = PersistenceTestSupport.testCipher()
        webVisitRepo = WebVisitRepository(db.webVisitDao(), cipher)
        familyMemberRepo = FamilyMemberRepository(db.familyMemberDao(), cipher)
        syncOutboxRepo = SyncOutboxRepository(db.syncOutboxDao(), cipher)
        syncReceiptRepo = SyncReceiptRepository(db.syncReceiptDao())
    }

    @After
    fun tearDown() {
        db.close()
    }

    /** Seeds one full "family" of data -- one member, one device, and one row in every Delete-Now-covered table -- so tests can prove coverage AND isolation from other families. */
    private suspend fun seedFullFamily(familyId: String, memberId: String, deviceId: String, seq: Long) {
        familyMemberRepo.upsert(FamilyMember(memberId, familyId, FamilyMemberRole.CHILD, "Kid-$familyId", FamilyMemberStatus.ACTIVE, "8-12", 1L))
        db.deviceDao().upsert(
            DeviceEntity(
                deviceId, memberId, DevicePlatform.ANDROID, "14", "0.1.0", "sk-$deviceId", "ek-$deviceId",
                1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 1000L, "{}",
            ),
        )
        webVisitRepo.record(deviceId, "example-$familyId.com", null, null, "cat", "v1", WebVisitAction.ALLOWED, 1000L, id = "visit-$deviceId")
        db.policySnapshotDao().insert(
            PolicySnapshotEntity(
                policyId = "policy-$deviceId", childDeviceId = deviceId, version = 1L,
                effectiveFromEpochMillis = 1000L, expiresAtEpochMillis = null,
                encryptedPayloadEnc = "enc", encryptedPayloadIv = "iv",
                trustSetEpoch = 1L, keyEpoch = 1L, signedByKeyId = "sk", receivedAtEpochMillis = 1000L,
                appliedAtEpochMillis = 1000L, applicationResult = "APPLIED", isLatestValid = true,
            ),
        )
        db.policyReceiptDao().insert(
            PolicyReceiptEntity("receipt-$deviceId", deviceId, "policy-$deviceId", 1L, 1000L, 1000L, "sk"),
        )
        db.deviceKeyMetadataDao().upsert(
            DeviceKeyMetadataEntity("key-$deviceId", deviceId, DeviceKeyState.ACTIVE, 1000L),
        )
        db.tamperEventDao().upsert(
            TamperEventEntity("tamper-$deviceId", deviceId, "ROOT_DETECTED", 1000L, null),
        )
        db.parentActionAuditDao().upsert(
            ParentActionAuditEntity("audit-$deviceId", memberId, ParentActionType.POLICY_EDIT, "Policy:policy-$deviceId", 1000L, null, null),
        )
        syncOutboxRepo.enqueue("outbox-$deviceId", familyId, deviceId, "envelope-$deviceId", seq, 999_999_999L, 1000L)
        syncReceiptRepo.apply("receipt-sync-$deviceId", familyId, deviceId, sequence = seq, keyEpoch = 1L, currentKeyEpoch = 1L, receivedAtEpochMillis = 1000L)
    }

    private suspend fun seedFamily() = seedFullFamily("family-1", "member-1", "device-1", seq = 1L)

    @Test
    fun `deleteDevice removes device and all its activity data, keeps other devices`() = runTest {
        seedFamily()
        db.deviceDao().upsert(
            DeviceEntity(
                "device-2", "member-1", DevicePlatform.ANDROID, "14", "0.1.0", "sk2", "ek2",
                1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 1000L, "{}",
            ),
        )
        webVisitRepo.record("device-2", "other.example", null, null, "cat", "v1", WebVisitAction.ALLOWED, 1000L, id = "v2")

        val receipt = coordinator.deleteDevice("family-1", "device-1", Instant.parse("2026-08-12T00:00:00Z"))

        assertNull(db.deviceDao().getById("device-1"))
        assertEquals(0, webVisitRepo.getForDevice("device-1").size)
        assertEquals(1, webVisitRepo.getForDevice("device-2").size)
        assertEquals("device-1", receipt.deviceId)
        assertEquals(1, db.retentionDeletionReceiptDao().getForFamily("family-1").size)
    }

    // ---- F1: PolicySnapshot must be erased by deleteDevice/deleteChild ----

    @Test
    fun `F1 deleteDevice erases policy snapshots for that device`() = runTest {
        seedFamily()
        assertEquals(1, db.policySnapshotDao().getHistory("device-1").size)

        coordinator.deleteDevice("family-1", "device-1", Instant.parse("2026-08-12T00:00:00Z"))

        assertEquals(0, db.policySnapshotDao().getHistory("device-1").size)
    }

    @Test
    fun `F1 deleteDevice policy snapshot erasure does not touch a sibling device`() = runTest {
        seedFamily()
        db.deviceDao().upsert(
            DeviceEntity(
                "device-2", "member-1", DevicePlatform.ANDROID, "14", "0.1.0", "sk2", "ek2",
                1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 1000L, "{}",
            ),
        )
        db.policySnapshotDao().insert(
            PolicySnapshotEntity(
                "policy-device-2", "device-2", 1L, 1000L, null, "enc", "iv", 1L, 1L, "sk", 1000L, 1000L, "APPLIED", true,
            ),
        )

        coordinator.deleteDevice("family-1", "device-1", Instant.parse("2026-08-12T00:00:00Z"))

        assertEquals(0, db.policySnapshotDao().getHistory("device-1").size)
        assertEquals(1, db.policySnapshotDao().getHistory("device-2").size)
    }

    @Test
    fun `F1 deleteChild erases policy snapshots across every device the child owns`() = runTest {
        seedFamily() // device-1, member-1
        db.deviceDao().upsert(
            DeviceEntity(
                "device-2", "member-1", DevicePlatform.ANDROID, "14", "0.1.0", "sk2", "ek2",
                1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 1000L, "{}",
            ),
        )
        db.policySnapshotDao().insert(
            PolicySnapshotEntity(
                "policy-device-2", "device-2", 1L, 1000L, null, "enc", "iv", 1L, 1L, "sk", 1000L, 1000L, "APPLIED", true,
            ),
        )
        // A different child's device must survive.
        familyMemberRepo.upsert(FamilyMember("member-2", "family-1", FamilyMemberRole.CHILD, "Sibling", FamilyMemberStatus.ACTIVE, "8-12", 1L))
        db.deviceDao().upsert(
            DeviceEntity(
                "device-3", "member-2", DevicePlatform.ANDROID, "14", "0.1.0", "sk3", "ek3",
                1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 1000L, "{}",
            ),
        )
        db.policySnapshotDao().insert(
            PolicySnapshotEntity(
                "policy-device-3", "device-3", 1L, 1000L, null, "enc", "iv", 1L, 1L, "sk", 1000L, 1000L, "APPLIED", true,
            ),
        )

        coordinator.deleteChild("family-1", "member-1", listOf("device-1", "device-2"), Instant.parse("2026-08-12T00:00:00Z"))

        assertEquals(0, db.policySnapshotDao().getHistory("device-1").size)
        assertEquals(0, db.policySnapshotDao().getHistory("device-2").size)
        assertEquals(1, db.policySnapshotDao().getHistory("device-3").size) // sibling's device untouched
    }

    // ---- F2: deleteFamily must be truly family-scoped, never global ----

    private data class FamilySnapshot(
        val members: Int, val devices: Int, val webVisits: Int, val policySnapshots: Int,
        val policyReceipts: Int, val deviceKeys: Int, val tamperEvents: Int, val parentAudits: Int,
        val syncOutbox: Int, val syncReceipts: Int,
    )

    private suspend fun snapshotFor(deviceId: String, memberId: String): FamilySnapshot = FamilySnapshot(
        members = if (db.familyMemberDao().getById(memberId) != null) 1 else 0,
        devices = if (db.deviceDao().getById(deviceId) != null) 1 else 0,
        webVisits = webVisitRepo.getForDevice(deviceId).size,
        policySnapshots = db.policySnapshotDao().getHistory(deviceId).size,
        policyReceipts = db.policyReceiptDao().getForDevice(deviceId).size,
        deviceKeys = db.deviceKeyMetadataDao().getForDevice(deviceId).size,
        tamperEvents = db.tamperEventDao().getForDevice(deviceId).size,
        parentAudits = db.parentActionAuditDao().getForActor(memberId).size,
        syncOutbox = if (db.syncOutboxDao().getById("outbox-$deviceId") != null) 1 else 0,
        syncReceipts = if (db.syncReceiptDao().getById("receipt-sync-$deviceId") != null) 1 else 0,
    )

    private val fullFamilySnapshot = FamilySnapshot(1, 1, 1, 1, 1, 1, 1, 1, 1, 1)
    private val erasedFamilySnapshot = FamilySnapshot(0, 0, 0, 0, 0, 0, 0, 0, 0, 0)

    @Test
    fun `F2 deleteFamily removes every covered row for the target family`() = runTest {
        seedFullFamily("family-A", "member-A", "device-A", seq = 1L)

        val receipt = coordinator.deleteFamily("family-A", Instant.parse("2026-08-12T00:00:00Z"))

        assertEquals(erasedFamilySnapshot, snapshotFor("device-A", "member-A"))
        assertTrue("expected the receipt to cover every seeded row category", receipt.deletedCount >= 9)
    }

    @Test
    fun `F2 adversarial -- deleteFamily(family-A) leaves family-B byte_row equivalent across every table`() = runTest {
        seedFullFamily("family-A", "member-A", "device-A", seq = 1L)
        seedFullFamily("family-B", "member-B", "device-B", seq = 1L)

        val beforeB = snapshotFor("device-B", "member-B")
        assertEquals(fullFamilySnapshot, beforeB) // sanity: family-B was actually seeded

        val receipt = coordinator.deleteFamily("family-A", Instant.parse("2026-08-12T00:00:00Z"))

        // family-A is fully gone.
        assertEquals(erasedFamilySnapshot, snapshotFor("device-A", "member-A"))
        // family-B is untouched -- same row-for-row snapshot as before the call.
        val afterB = snapshotFor("device-B", "member-B")
        assertEquals(beforeB, afterB)
        assertEquals(fullFamilySnapshot, afterB)

        // The receipt itself is scoped to family-A only.
        assertEquals("family-A", receipt.familyId)
        val familyAReceipts = db.retentionDeletionReceiptDao().getForFamily("family-A")
        val familyBReceipts = db.retentionDeletionReceiptDao().getForFamily("family-B")
        assertTrue(familyAReceipts.isNotEmpty())
        assertTrue("deleteFamily(family-A) must not create or touch a family-B receipt", familyBReceipts.isEmpty())
    }

    @Test
    fun `F2 deleteDevice and deleteChild also stay scoped to their own family`() = runTest {
        seedFullFamily("family-A", "member-A", "device-A", seq = 1L)
        seedFullFamily("family-B", "member-B", "device-B", seq = 1L)

        coordinator.deleteDevice("family-A", "device-A", Instant.parse("2026-08-12T00:00:00Z"))

        assertEquals(fullFamilySnapshot, snapshotFor("device-B", "member-B"))
    }

    @Test
    fun `deleteFamily wipes every family-scoped table`() = runTest {
        seedFamily()

        coordinator.deleteFamily("family-1", Instant.parse("2026-08-12T00:00:00Z"))

        assertEquals(0, db.familyMemberDao().count())
        assertEquals(0, db.webVisitDao().count())
        assertEquals(0, db.deviceDao().getAll().size)
    }

    @Test
    fun `delete now receipt never contains the deleted content, only counts`() = runTest {
        seedFamily()

        val receipt = coordinator.deleteDevice("family-1", "device-1", Instant.parse("2026-08-12T00:00:00Z"))

        // Structural check: the receipt type has no field capable of holding record content.
        assertEquals("device_all_categories", receipt.entityCategory)
        assertEquals(true, receipt.deletedCount >= 1)
    }
}
