package org.pca.app.persistence

import android.database.sqlite.SQLiteConstraintException
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.PolicySnapshotEntity
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PolicySnapshotDaoTest {
    private lateinit var db: PcaLocalDatabase

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun snapshot(version: Long, isLatest: Boolean) = PolicySnapshotEntity(
        policyId = "policy-$version",
        childDeviceId = "device-1",
        version = version,
        effectiveFromEpochMillis = 1000L,
        expiresAtEpochMillis = null,
        encryptedPayloadEnc = "enc",
        encryptedPayloadIv = "iv",
        trustSetEpoch = 1L,
        keyEpoch = 1L,
        signedByKeyId = "sk-1",
        receivedAtEpochMillis = 1000L,
        appliedAtEpochMillis = 1000L,
        applicationResult = "APPLIED",
        isLatestValid = isLatest,
    )

    @Test
    fun `a duplicate policyId is rejected at the DB level`() = runTest {
        db.policySnapshotDao().insert(snapshot(1, true))

        assertThrows(SQLiteConstraintException::class.java) {
            kotlinx.coroutines.runBlocking { db.policySnapshotDao().insert(snapshot(1, true).copy(effectiveFromEpochMillis = 9999L)) }
        }
    }

    @Test
    fun `duplicate childDeviceId plus version is rejected -- version monotonicity guard`() = runTest {
        db.policySnapshotDao().insert(snapshot(1, true))

        val duplicateVersionDifferentPolicyId = snapshot(1, false).copy(policyId = "policy-1-dup")
        assertThrows(SQLiteConstraintException::class.java) {
            kotlinx.coroutines.runBlocking { db.policySnapshotDao().insert(duplicateVersionDifferentPolicyId) }
        }
    }

    @Test
    fun `clearing latest flag then inserting a higher version keeps exactly one latest row`() = runTest {
        db.policySnapshotDao().insert(snapshot(1, true))

        db.policySnapshotDao().clearLatestFlag("device-1")
        db.policySnapshotDao().insert(snapshot(2, true))

        assertEquals(2L, db.policySnapshotDao().getLatestValid("device-1")!!.version)
        assertEquals(2L, db.policySnapshotDao().getMaxVersion("device-1"))
        assertEquals(2, db.policySnapshotDao().getHistory("device-1").size)
    }
}
