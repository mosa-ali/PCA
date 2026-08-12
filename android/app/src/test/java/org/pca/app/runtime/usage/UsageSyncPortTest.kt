package org.pca.app.runtime.usage

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.repository.UsageSessionRepository
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class UsageSyncPortTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repository: UsageSessionRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        repository = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `pending sessions surface the decrypted, still-opaque app token and honest fields for the sync layer`() = runTest {
        repository.record(
            id = "session-1",
            deviceId = "device-1",
            appOrCategoryToken = "abcd1234abcd1234",
            startedAtEpochMillis = 1_000L,
            endedAtEpochMillis = 61_000L,
            durationMillis = 60_000L,
            sourceConfidence = SourceConfidence.PLATFORM_API,
        )

        val port: UsageSyncPayloadSource = RepositoryBackedUsageSyncPayloadSource(repository)
        val payload = port.pendingSessionsForSync("device-1").single()

        assertEquals("session-1", payload.sessionId)
        assertEquals("abcd1234abcd1234", payload.appOrCategoryToken)
        assertEquals(60_000L, payload.durationMillis)
        assertEquals(SourceConfidence.PLATFORM_API, payload.sourceConfidence)
    }
}
