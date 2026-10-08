package org.pca.app.runtime.usage

import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.dao.UsageSessionDao
import org.pca.app.persistence.entity.UsageSessionEntity
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.platform.UsageClockSample
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class UsageProvenanceRepositoryTest {
    private val value = UsageSessionProvenance("generation", "boot", 100, 200,
        UsageClockSample(0, 10000), UsageClockSample(400, 10400), UsageClockSample(410, 10410))

    @Test fun provenanceSurvivesDatabaseReopenAndDuplicateUpsert() = runTest {
        val name = "usage-provenance-${java.util.UUID.randomUUID()}.db"
        val cipher = PersistenceTestSupport.testCipher()
        try {
            PersistenceTestSupport.fileBackedDb(name).useDatabase { db ->
                val repo = UsageSessionRepository(db.usageSessionDao(), cipher)
                repeat(2) { repo.record("one", "device", "token", 10100, 10200, 100, SourceConfidence.PLATFORM_API, value) }
            }
            PersistenceTestSupport.fileBackedDb(name).useDatabase { db ->
                val page = UsageSessionRepository(db.usageSessionDao(), cipher).getRecentObservations("device", 1)
                assertFalse(page.truncated)
                assertEquals(value, page.sessions.single().observationProvenance)
                assertEquals(1, db.usageSessionDao().count())
            }
        } finally { PersistenceTestSupport.context().deleteDatabase(name) }
    }
    @Test fun encryptedRoundTripLegacyBoundsAndDeletion() = runTest {
        PersistenceTestSupport.inMemoryDb().useDatabase { db ->
            val repo = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
            repo.record("one", "device", "token", 10100, 10200, 100, SourceConfidence.PLATFORM_API, value)
            repo.record("two", "device", "token", 10100, 10200, 100, SourceConfidence.PLATFORM_API)
            repo.record("other", "other-device", "token", 10100, 10200, 100, SourceConfidence.PLATFORM_API, value)
            val raw = db.usageSessionDao().getForDevice("device").first { it.id == "one" }
            assertNotNull(raw.observationProvenanceEnc)
            assertFalse(raw.observationProvenanceEnc!!.contains("generation"))
            val page = repo.getRecentObservations("device", 1)
            assertTrue(page.truncated)
            assertEquals("two", page.sessions.single().id)
            assertNull(page.sessions.single().observationProvenance)
            val all = repo.getRecentObservations("device", 2)
            assertFalse(all.truncated)
            assertEquals(value, all.sessions.first { it.id == "one" }.observationProvenance)
            val outbound = RepositoryBackedUsageSyncPayloadSource(repo).availableSessionsForSync("device").first { it.sessionId == "one" }
            assertFalse(outbound.toString().contains("generation"))
            assertFalse(outbound.toString().contains("boot"))
            assertEquals(setOf("sessionId", "deviceId", "appOrCategoryToken", "startedAtEpochMillis", "endedAtEpochMillis", "durationMillis", "sourceConfidence"), outbound.javaClass.declaredFields.filterNot { java.lang.reflect.Modifier.isStatic(it.modifiers) }.map { it.name }.toSet())
            assertEquals(2, db.usageSessionDao().deleteAllForDevice("device"))
            assertTrue(repo.getRecentObservations("device", 1).sessions.isEmpty())
            assertEquals(1, repo.getRecentObservations("other-device", 1).sessions.size)
        }
    }
    @Test fun invalidBoundsAndDaoScopeAreRejected() = runTest {
        PersistenceTestSupport.inMemoryDb().useDatabase { db ->
            val cipher = PersistenceTestSupport.testCipher()
            val repo = UsageSessionRepository(db.usageSessionDao(), cipher)
            for (limit in listOf(0, 257)) {
                try { repo.getRecentObservations("device", limit); fail("Invalid limit accepted") }
                catch (_: IllegalArgumentException) { }
            }
            repo.record("one", "other", "token", 10100, 10200, 100, SourceConfidence.PLATFORM_API)
            val row = db.usageSessionDao().getForDevice("other").single()
            val wrongDao = object : UsageSessionDao by db.usageSessionDao() {
                override suspend fun getRecentForDevice(deviceId: String, rowLimit: Int): List<UsageSessionEntity> = listOf(row)
            }
            try { UsageSessionRepository(wrongDao, cipher).getRecentObservations("device", 1); fail("Wrong scope accepted") }
            catch (_: IllegalStateException) { }
            val excessiveDao = object : UsageSessionDao by db.usageSessionDao() {
                override suspend fun getRecentForDevice(deviceId: String, rowLimit: Int): List<UsageSessionEntity> = List(rowLimit + 1) { row.copy(deviceId = deviceId) }
            }
            try { UsageSessionRepository(excessiveDao, cipher).getRecentObservations("device", 1); fail("Excess rows accepted") }
            catch (_: IllegalStateException) { }
        }
    }
    @Test fun tamperedCiphertextIsRejected() = runTest {
        PersistenceTestSupport.inMemoryDb().useDatabase { db ->
            val repo = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
            repo.record("one", "device", "token", 10100, 10200, 100, SourceConfidence.PLATFORM_API, value)
            val raw = db.usageSessionDao().getForDevice("device").single()
            val bytes = android.util.Base64.decode(raw.observationProvenanceEnc, android.util.Base64.NO_WRAP)
            bytes[0] = (bytes[0].toInt() xor 1).toByte()
            db.usageSessionDao().upsert(raw.copy(observationProvenanceEnc = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)))
            var rejected = false
            try { repo.getRecentObservations("device", 1) } catch (_: Exception) { rejected = true }
            assertTrue("Authenticated corruption must reject the read", rejected)
        }
    }
    @Test fun substitutionAndHalfPresentMetadataFailClosed() = runTest {
        PersistenceTestSupport.inMemoryDb().useDatabase { db ->
            val repo = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
            repo.record("one", "device", "token", 10100, 10200, 100, SourceConfidence.PLATFORM_API, value)
            val raw = db.usageSessionDao().getForDevice("device").single()
            db.usageSessionDao().upsert(raw.copy(id = "swapped"))
            try { repo.getRecentObservations("device", 2); fail("Substitution accepted") }
            catch (_: IllegalArgumentException) { }
            db.usageSessionDao().deleteAllForDevice("device")
            db.usageSessionDao().upsert(raw.copy(sourceConfidence = SourceConfidence.HEURISTIC))
            try { repo.getRecentObservations("device", 1); fail("Wrong confidence accepted") }
            catch (_: IllegalStateException) { }
            db.usageSessionDao().upsert(raw.copy(observationProvenanceIv = null))
            try { repo.getRecentObservations("device", 1); fail("Partial metadata accepted") }
            catch (_: IllegalStateException) { }
        }
    }
}

internal inline fun <T> org.pca.app.persistence.PcaLocalDatabase.useDatabase(block: (org.pca.app.persistence.PcaLocalDatabase) -> T): T = try { block(this) } finally { close() }
