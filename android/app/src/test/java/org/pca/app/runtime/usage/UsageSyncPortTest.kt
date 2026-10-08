package org.pca.app.runtime.usage

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.dao.UsageSessionDao
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.entity.UsageSessionEntity
import org.pca.app.persistence.repository.UsageSessionRepository
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class UsageSyncPortTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repository: UsageSessionRepository
    private lateinit var cipher: LocalRecordCipher

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        cipher = PersistenceTestSupport.testCipher()
        repository = UsageSessionRepository(db.usageSessionDao(), cipher)
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `available sessions are device-scoped retained history with repeatable reads and token fields`() = runTest {
        repository.record(
            id = "session-1",
            deviceId = "device-1",
            appOrCategoryToken = "abcd1234abcd1234",
            startedAtEpochMillis = 1_000L,
            endedAtEpochMillis = 61_000L,
            durationMillis = 60_000L,
            sourceConfidence = SourceConfidence.PLATFORM_API,
        )
        repository.record(
            id = "session-2",
            deviceId = "device-2",
            appOrCategoryToken = "feed5678feed5678",
            startedAtEpochMillis = 2_000L,
            endedAtEpochMillis = 32_000L,
            durationMillis = 30_000L,
            sourceConfidence = SourceConfidence.HEURISTIC,
        )

        val port: UsageSyncPayloadSource = RepositoryBackedUsageSyncPayloadSource(repository)
        val firstRead = port.availableSessionsForSync("device-1")
        val secondRead = port.availableSessionsForSync("device-1")
        val payload = firstRead.single()

        assertEquals(firstRead, secondRead)
        assertEquals("session-1", payload.sessionId)
        assertEquals("device-1", payload.deviceId)
        assertEquals("abcd1234abcd1234", payload.appOrCategoryToken)
        assertEquals(1_000L, payload.startedAtEpochMillis)
        assertEquals(61_000L, payload.endedAtEpochMillis)
        assertEquals(60_000L, payload.durationMillis)
        assertEquals(SourceConfidence.PLATFORM_API, payload.sourceConfidence)
        assertEquals(1, repository.getForDevice("device-1").size)
        assertEquals("session-2", port.availableSessionsForSync("device-2").single().sessionId)
    }

    @Test
    fun `repository row outside requested device scope fails closed`() = runTest {
        repository.record(
            id = "session-2",
            deviceId = "device-2",
            appOrCategoryToken = "feed5678feed5678",
            startedAtEpochMillis = 2_000L,
            endedAtEpochMillis = 32_000L,
            durationMillis = 30_000L,
            sourceConfidence = SourceConfidence.HEURISTIC,
        )

        val delegate = db.usageSessionDao()
        val misScopedDao = object : UsageSessionDao by delegate {
            override suspend fun getForDevice(deviceId: String): List<UsageSessionEntity> =
                if (deviceId == "device-1") delegate.getForDevice("device-2")
                else delegate.getForDevice(deviceId)
        }
        val port = RepositoryBackedUsageSyncPayloadSource(
            UsageSessionRepository(misScopedDao, cipher),
        )

        var failure: IllegalStateException? = null
        try {
            port.availableSessionsForSync("device-1")
        } catch (caught: IllegalStateException) {
            failure = caught
        }
        assertEquals(
            "Usage session repository returned a row outside the requested device scope",
            failure?.message,
        )
    }
}
