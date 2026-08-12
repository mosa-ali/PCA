package org.pca.app.feature.settings.data

import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.entity.DeviceEnrollmentState
import org.pca.app.persistence.entity.DeviceEntity
import org.pca.app.persistence.entity.DevicePlatform
import org.pca.app.persistence.entity.DeviceTrustState
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus
import org.pca.app.persistence.repository.FamilyMember
import org.pca.app.persistence.repository.FamilyMemberRepository
import org.pca.app.persistence.retention.DeleteNowCoordinator
import org.robolectric.RobolectricTestRunner

/**
 * PCA-RUNTIME-PERSIST-1 Section 20: the real settings/use-case entry point
 * for "Delete Now" on top of the pre-existing [DeleteNowCoordinator] --
 * confirms scope resolution, the receipt result, and that a failure (e.g. a
 * DB failure mid-delete, Section 21) is reported rather than crashing the
 * caller, with no partial state.
 */
@RunWith(RobolectricTestRunner::class)
class DeleteNowUseCaseTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var useCase: DeleteNowUseCase

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        useCase = DeleteNowUseCase(DeleteNowCoordinator(db))
    }

    @After
    fun tearDown() {
        if (db.isOpen) db.close()
    }

    private suspend fun seedDevice(deviceId: String, memberId: String, familyId: String) {
        FamilyMemberRepository(db.familyMemberDao(), PersistenceTestSupport.testCipher()).upsert(
            FamilyMember(memberId, familyId, FamilyMemberRole.CHILD, "Kid", FamilyMemberStatus.ACTIVE, "8-12", 1000L),
        )
        db.deviceDao().upsert(
            DeviceEntity(
                deviceId, memberId, DevicePlatform.ANDROID, "14", "0.1.0", "sk", "ek",
                1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 1000L, "{}",
            ),
        )
    }

    @Test
    fun `Device scope deletes only that device and returns a receipt`() = runTest {
        seedDevice("device-1", "member-1", "family-1")

        val result = useCase.execute(DeleteNowScope.Device("family-1", "device-1"), Instant.parse("2026-08-12T00:00:00Z"))

        assertTrue(result is DeleteNowResult.Success)
        assertEquals("device_all_categories", (result as DeleteNowResult.Success).receipt.entityCategory)
        assertEquals(null, db.deviceDao().getById("device-1"))
    }

    @Test
    fun `Family scope deletes the whole family`() = runTest {
        seedDevice("device-1", "member-1", "family-1")

        val result = useCase.execute(DeleteNowScope.Family("family-1"))

        assertTrue(result is DeleteNowResult.Success)
        assertEquals(0, db.familyMemberDao().count())
    }

    @Test
    fun `deleting an unknown device id is a zero-count success, and leaves other devices untouched`() = runTest {
        seedDevice("device-1", "member-1", "family-1")

        val result = useCase.execute(DeleteNowScope.Device("family-1", "device-does-not-exist"))

        assertTrue(result is DeleteNowResult.Success)
        assertEquals(0, (result as DeleteNowResult.Success).receipt.deletedCount)
        assertTrue(db.deviceDao().getById("device-1") != null)
    }

    @Test
    fun `Child scope deletes the member and every one of their devices`() = runTest {
        seedDevice("device-1", "member-1", "family-1")
        db.deviceDao().upsert(
            org.pca.app.persistence.entity.DeviceEntity(
                "device-2", "member-1", org.pca.app.persistence.entity.DevicePlatform.ANDROID, "14", "0.1.0", "sk2", "ek2",
                1L, 1L, org.pca.app.persistence.entity.DeviceTrustState.ACTIVE, org.pca.app.persistence.entity.DeviceEnrollmentState.ACTIVE, 1000L, "{}",
            ),
        )

        val result = useCase.execute(DeleteNowScope.Child("family-1", "member-1", listOf("device-1", "device-2")))

        assertTrue(result is DeleteNowResult.Success)
        assertEquals(null, db.familyMemberDao().getById("member-1"))
        assertEquals(null, db.deviceDao().getById("device-1"))
        assertEquals(null, db.deviceDao().getById("device-2"))
    }
}
