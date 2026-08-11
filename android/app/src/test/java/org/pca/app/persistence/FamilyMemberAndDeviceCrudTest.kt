package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.DeviceEnrollmentState
import org.pca.app.persistence.entity.DevicePlatform
import org.pca.app.persistence.entity.DeviceTrustState
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus
import org.pca.app.persistence.repository.FamilyMember
import org.pca.app.persistence.repository.FamilyMemberRepository
import org.robolectric.RobolectricTestRunner
import org.pca.app.persistence.entity.DeviceEntity

@RunWith(RobolectricTestRunner::class)
class FamilyMemberAndDeviceCrudTest {
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
    fun `family member display name is stored encrypted, not as plaintext`() = runTest {
        val repo = FamilyMemberRepository(db.familyMemberDao(), PersistenceTestSupport.testCipher())
        val member = FamilyMember(
            memberId = "member-1",
            familyId = "family-1",
            role = FamilyMemberRole.CHILD,
            displayName = "Amina",
            status = FamilyMemberStatus.ACTIVE,
            ageTier = "8-12",
            updatedAtEpochMillis = 1000L,
        )

        repo.upsert(member)

        val rawRow = db.familyMemberDao().getById("member-1")!!
        assertNotEquals("Amina", rawRow.displayNameEnc)

        val roundTripped = repo.getById("member-1")
        assertEquals(member, roundTripped)
    }

    @Test
    fun `device CRUD persists all doc 10 Section 3_3 fields`() = runTest {
        val device = DeviceEntity(
            deviceId = "device-1",
            memberId = "member-1",
            platform = DevicePlatform.ANDROID,
            platformVersion = "14",
            appVersion = "0.1.0",
            signingKeyId = "sk-1",
            encryptionKeyId = "ek-1",
            trustSetEpoch = 1L,
            keyEpoch = 1L,
            trustState = DeviceTrustState.ACTIVE,
            enrollmentState = DeviceEnrollmentState.ACTIVE,
            lastSeenAtEpochMillis = 5000L,
            capabilityProfileJson = "{\"usageAccess\":true}",
        )

        db.deviceDao().upsert(device)

        assertEquals(device, db.deviceDao().getById("device-1"))
    }

    @Test
    fun `deleting a family removes all its members`() = runTest {
        val repo = FamilyMemberRepository(db.familyMemberDao(), PersistenceTestSupport.testCipher())
        repo.upsert(FamilyMember("m1", "family-x", FamilyMemberRole.OWNER, "Owner", FamilyMemberStatus.ACTIVE, "adult", 1L))
        repo.upsert(FamilyMember("m2", "family-x", FamilyMemberRole.CHILD, "Child", FamilyMemberStatus.ACTIVE, "8-12", 1L))

        db.familyMemberDao().deleteAllForFamily("family-x")

        assertNull(db.familyMemberDao().getById("m1"))
        assertNull(db.familyMemberDao().getById("m2"))
    }
}
