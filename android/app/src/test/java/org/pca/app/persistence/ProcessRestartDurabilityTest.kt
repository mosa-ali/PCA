package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus
import org.pca.app.persistence.repository.FamilyMember
import org.pca.app.persistence.repository.FamilyMemberRepository
import org.robolectric.RobolectricTestRunner

/**
 * PCA-LOCAL-DB-1 Section 23: write, CLOSE the database (simulating process
 * death -- Room holds no state once the object is closed), REOPEN a fresh
 * [PcaLocalDatabase] instance against the same on-disk file, and verify the
 * same data reads back. An in-memory-only test would not exercise this --
 * every other test in this module uses [PersistenceTestSupport.inMemoryDb]
 * deliberately so this is the one place durability is actually proven.
 */
@RunWith(RobolectricTestRunner::class)
class ProcessRestartDurabilityTest {
    private val dbFileName = "process_restart_test.db"

    @Before
    fun setUp() {
        PersistenceTestSupport.context().deleteDatabase(dbFileName)
    }

    @After
    fun tearDown() {
        PersistenceTestSupport.context().deleteDatabase(dbFileName)
    }

    @Test
    fun `data written before close is readable from a freshly opened database instance`() = runTest {
        val cipher = PersistenceTestSupport.testCipher()

        val firstInstance = PersistenceTestSupport.fileBackedDb(dbFileName)
        FamilyMemberRepository(firstInstance.familyMemberDao(), cipher).upsert(
            FamilyMember("member-1", "family-1", FamilyMemberRole.CHILD, "Amina", FamilyMemberStatus.ACTIVE, "8-12", 1000L),
        )
        firstInstance.close() // simulates process death -- no reference to firstInstance survives past this point

        val secondInstance = PersistenceTestSupport.fileBackedDb(dbFileName)
        try {
            val reread = FamilyMemberRepository(secondInstance.familyMemberDao(), cipher).getById("member-1")

            assertEquals("Amina", reread?.displayName)
            assertEquals(FamilyMemberRole.CHILD, reread?.role)
        } finally {
            secondInstance.close()
        }
    }

    @Test
    fun `retention deletion receipts survive a reopen`() = runTest {
        val firstInstance = PersistenceTestSupport.fileBackedDb(dbFileName)
        firstInstance.retentionDeletionReceiptDao().insert(
            org.pca.app.persistence.entity.RetentionDeletionReceiptEntity(
                "receipt-1", "family-1", "device-1", "WebVisit", 5, 1000L, 2000L, "expiry",
            ),
        )
        firstInstance.close()

        val secondInstance = PersistenceTestSupport.fileBackedDb(dbFileName)
        try {
            assertEquals(1, secondInstance.retentionDeletionReceiptDao().getForFamily("family-1").size)
        } finally {
            secondInstance.close()
        }
    }
}
