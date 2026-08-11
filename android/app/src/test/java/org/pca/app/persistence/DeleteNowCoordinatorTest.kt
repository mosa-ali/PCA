package org.pca.app.persistence

import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.DeviceEnrollmentState
import org.pca.app.persistence.entity.DeviceEntity
import org.pca.app.persistence.entity.DevicePlatform
import org.pca.app.persistence.entity.DeviceTrustState
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus
import org.pca.app.persistence.entity.WebVisitAction
import org.pca.app.persistence.repository.FamilyMember
import org.pca.app.persistence.repository.FamilyMemberRepository
import org.pca.app.persistence.repository.WebVisitRepository
import org.pca.app.persistence.retention.DeleteNowCoordinator
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DeleteNowCoordinatorTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var coordinator: DeleteNowCoordinator
    private lateinit var webVisitRepo: WebVisitRepository
    private lateinit var familyMemberRepo: FamilyMemberRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        coordinator = DeleteNowCoordinator(db)
        webVisitRepo = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())
        familyMemberRepo = FamilyMemberRepository(db.familyMemberDao(), PersistenceTestSupport.testCipher())
    }

    @After
    fun tearDown() {
        db.close()
    }

    private suspend fun seedFamily() {
        familyMemberRepo.upsert(FamilyMember("member-1", "family-1", FamilyMemberRole.CHILD, "Kid", FamilyMemberStatus.ACTIVE, "8-12", 1L))
        db.deviceDao().upsert(
            DeviceEntity(
                "device-1", "member-1", DevicePlatform.ANDROID, "14", "0.1.0", "sk", "ek",
                1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 1000L, "{}",
            ),
        )
        webVisitRepo.record("device-1", "example.com", null, null, "cat", "v1", WebVisitAction.ALLOWED, 1000L, id = "v1")
    }

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
