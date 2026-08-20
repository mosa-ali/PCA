package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.EnrollmentLifecycleAuditEntity
import org.pca.app.persistence.repository.EnrollmentLifecycleAuditRepository
import org.robolectric.RobolectricTestRunner

/** PCA-FR-140: durable local storage for enrollment lifecycle audit records. */
@RunWith(RobolectricTestRunner::class)
class EnrollmentLifecycleAuditRepositoryTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repo: EnrollmentLifecycleAuditRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        repo = EnrollmentLifecycleAuditRepository(db.enrollmentLifecycleAuditDao())
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `a record survives insert and is retrievable by device, most recent first`() = runTest {
        repo.insert(
            EnrollmentLifecycleAuditEntity(
                id = "e1",
                familyId = null,
                deviceId = "device-1",
                actorId = "actor-1",
                fromState = null,
                toState = "PAIRING_PENDING",
                reason = "first enrollment",
                occurredAtEpochMillis = 1000L,
            ),
        )
        repo.insert(
            EnrollmentLifecycleAuditEntity(
                id = "e2",
                familyId = "family-1",
                deviceId = "device-1",
                actorId = "actor-1",
                fromState = "PAIRING_PENDING",
                toState = "PAIRED",
                reason = "confirmed",
                occurredAtEpochMillis = 2000L,
            ),
        )

        val records = repo.getForDevice("device-1")
        assertEquals(2, records.size)
        assertEquals("e2", records[0].id)
        assertEquals("e1", records[1].id)
        assertNull(records[1].familyId)
        assertNull(records[1].fromState)
    }

    @Test
    fun `insert is idempotent on id, matching the sink's replay-safe append contract`() = runTest {
        val entity = EnrollmentLifecycleAuditEntity(
            id = "e1",
            familyId = null,
            deviceId = "device-1",
            actorId = "actor-1",
            fromState = null,
            toState = "PAIRING_PENDING",
            reason = "first enrollment",
            occurredAtEpochMillis = 1000L,
        )
        repo.insert(entity)
        repo.insert(entity)

        assertEquals(1, repo.count())
    }
}
