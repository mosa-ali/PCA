package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.repository.PolicySnapshotRepository
import org.pca.app.persistence.repository.SavePolicyResult
import org.robolectric.RobolectricTestRunner

/**
 * PCA-RUNTIME-PERSIST-1 Sections 4/5/9: the last-accepted-policy adapter
 * (reused as the schedule cache) must let an offline, rebooted child device
 * recover its last accepted policy, and must never let a stale/rollback
 * policy version silently become (or overwrite) that latest state.
 */
@RunWith(RobolectricTestRunner::class)
class PolicySnapshotRepositoryTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repo: PolicySnapshotRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        repo = PolicySnapshotRepository(db.policySnapshotDao(), PersistenceTestSupport.testCipher())
    }

    @After
    fun tearDown() {
        db.close()
    }

    private suspend fun accept(version: Long, payload: String = "policy-payload-v$version") =
        repo.save("policy-$version", "device-1", version, 1000L, null, payload, 1L, 1L, "sk", 1000L, 1000L)

    @Test
    fun `accepted policy round-trips through the local-at-rest cipher`() = runTest {
        accept(1L, payload = "plaintext-policy-json")

        val raw = db.policySnapshotDao().getLatestValid("device-1")!!
        assertTrue(raw.encryptedPayloadEnc != "plaintext-policy-json")
        assertEquals("plaintext-policy-json", repo.loadLatestAccepted("device-1")!!.payload)
    }

    @Test
    fun `a higher version becomes latest and the previous version is superseded`() = runTest {
        accept(1L)
        val result = accept(2L)

        assertTrue(result is SavePolicyResult.Accepted)
        assertEquals(2L, repo.loadLatestAccepted("device-1")!!.version)
        assertEquals(2L, repo.currentRevision("device-1"))
    }

    @Test
    fun `a rollback attempt after a higher version is already applied is rejected, not silently applied`() = runTest {
        accept(1L)
        accept(2L)

        val rollback = accept(1L, payload = "attacker-or-stale-payload")

        assertEquals(SavePolicyResult.RolledBackRejected(attemptedVersion = 1L, currentVersion = 2L), rollback)
        assertEquals(2L, repo.loadLatestAccepted("device-1")!!.version)
    }

    @Test
    fun `an exact duplicate of the current version is a no-op, not a second history row`() = runTest {
        accept(1L)
        val historyBefore = db.policySnapshotDao().getHistory("device-1").size

        val duplicate = accept(1L)

        assertEquals(SavePolicyResult.DuplicateIgnored(1L), duplicate)
        assertEquals(historyBefore, db.policySnapshotDao().getHistory("device-1").size)
    }

    @Test
    fun `stale-epoch rejection is persisted as non-latest history for reconnect reporting`() = runTest {
        accept(1L)

        repo.recordRejectedOrStaleAttempt(
            "policy-stale", "device-1", 5L, 1000L, null, "stale-payload", 1L, 1L, "sk", 2000L, "STALE_EPOCH_REJECTED",
        )

        assertEquals(1L, repo.loadLatestAccepted("device-1")!!.version) // latest is unchanged
        val staleRow = db.policySnapshotDao().getHistory("device-1").first { it.version == 5L }
        assertEquals("STALE_EPOCH_REJECTED", staleRow.applicationResult)
        assertEquals(false, staleRow.isLatestValid)
    }

    @Test
    fun `an offline reboot recovers the last accepted policy from a freshly opened database`() = runTest {
        val cipher = PersistenceTestSupport.testCipher()
        val fileName = "policy-reboot-test.db"
        PersistenceTestSupport.context().deleteDatabase(fileName)

        val firstInstance = PersistenceTestSupport.fileBackedDb(fileName)
        PolicySnapshotRepository(firstInstance.policySnapshotDao(), cipher)
            .save("policy-1", "device-1", 1L, 1000L, null, "accepted-policy-payload", 1L, 1L, "sk", 1000L, 1000L)
        firstInstance.close()

        val secondInstance = PersistenceTestSupport.fileBackedDb(fileName)
        try {
            val recovered = PolicySnapshotRepository(secondInstance.policySnapshotDao(), cipher).loadLatestAccepted("device-1")
            assertEquals("accepted-policy-payload", recovered?.payload)
        } finally {
            secondInstance.close()
            PersistenceTestSupport.context().deleteDatabase(fileName)
        }
    }

    @Test
    fun `schedule cache aliases operate on the same PolicySnapshot authority, not a second table`() = runTest {
        repo.saveAcceptedSchedulePolicy("sched-1", "device-1", 1L, 1000L, null, "schedule-payload", 1L, 1L, "sk", 1000L, 1000L)

        assertEquals("schedule-payload", repo.loadLatestAcceptedSchedulePolicy("device-1")!!.payload)
        assertEquals("schedule-payload", repo.loadLatestAccepted("device-1")!!.payload) // same authority

        repo.deleteSchedulePolicy("device-1")
        assertNull(repo.loadLatestAccepted("device-1"))
    }
}
