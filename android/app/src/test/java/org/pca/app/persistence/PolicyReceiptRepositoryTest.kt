package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.repository.PolicyReceiptRepository
import org.robolectric.RobolectricTestRunner

/** PCA-RUNTIME-PERSIST-1 Section 9: duplicate-safe policy application receipts. */
@RunWith(RobolectricTestRunner::class)
class PolicyReceiptRepositoryTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repo: PolicyReceiptRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        repo = PolicyReceiptRepository(db.policyReceiptDao())
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `recording the same device-version receipt twice after a process restart is a no-op`() = runTest {
        val first = repo.record("r1", "device-1", "policy-1", 1L, 1000L, 1000L, "sk")
        val second = repo.record("r2", "device-1", "policy-1", 1L, 2000L, 2000L, "sk")

        assertTrue(first)
        assertFalse(second)
        assertEquals(1, repo.getForDevice("device-1").size)
    }

    @Test
    fun `receipts are retrievable by device and version for reconnect status reporting`() = runTest {
        repo.record("r1", "device-1", "policy-1", 1L, 1000L, 1000L, "sk")
        repo.record("r2", "device-1", "policy-2", 2L, 2000L, 2000L, "sk")

        assertEquals(2, repo.getForDevice("device-1").size)
        assertEquals(2L, repo.getForDeviceAndVersion("device-1", 2L)?.policyVersion)
    }
}
