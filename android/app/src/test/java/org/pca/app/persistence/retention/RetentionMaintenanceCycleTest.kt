package org.pca.app.persistence.retention

import java.time.Instant
import java.time.ZoneId
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
import org.pca.app.persistence.entity.FamilyMemberEntity
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.entity.WebVisitAction
import org.pca.app.persistence.repository.WebVisitRepository
import org.robolectric.RobolectricTestRunner

/**
 * PCA-DATA-024/PCA-FR-105 closure evidence: proves [executeRetentionMaintenanceCycle] -- the
 * shared production logic [org.pca.app.runtime.graph.PcaAppGraph.runRetentionMaintenanceCycle]
 * delegates to -- actually deletes expired rows through a real [RetentionEngine], not a fake or a
 * mock. Reuses `RetentionEngineTest`'s exact in-memory-Room-database setup
 * ([PersistenceTestSupport.inMemoryDb]) rather than the full [org.pca.app.runtime.graph.PcaAppGraph]
 * composition root, since that root's production persistence
 * ([org.pca.app.persistence.PcaLocalPersistence.getInstance]) is backed by `AndroidKeyStore`-gated
 * stores that are unavailable in this plain-JVM Robolectric unit-test environment (see
 * `PcaAppGraphTest`'s own doc comment for the same constraint).
 */
@RunWith(RobolectricTestRunner::class)
class RetentionMaintenanceCycleTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var engine: RetentionEngine
    private val zone: ZoneId = ZoneId.of("UTC")

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        engine = RetentionEngine(db)
    }

    @After
    fun tearDown() {
        db.close()
    }

    private suspend fun seedEnrolledDevice(familyId: String = "family-1", deviceId: String = "device-1") {
        db.familyMemberDao().upsert(
            FamilyMemberEntity("member-1", familyId, FamilyMemberRole.CHILD, "enc", "iv", FamilyMemberStatus.ACTIVE, "8-12", 1L),
        )
        db.deviceDao().upsert(
            DeviceEntity(
                deviceId, "member-1", DevicePlatform.ANDROID, "35", "1", "signing", "encryption",
                1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 1L, "{}",
            ),
        )
    }

    @Test
    fun `an enrolled family and device really deletes expired rows and inserts a receipt`() = runTest {
        seedEnrolledDevice()
        val webVisitRepo = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())
        val now = Instant.parse("2026-08-12T00:00:00Z")
        val fifteenDaysAgo = now.minusSeconds(15L * 24 * 60 * 60).toEpochMilli()
        val oneDayAgo = now.minusSeconds(24 * 60 * 60).toEpochMilli()
        webVisitRepo.record("device-1", "old.example", null, null, "cat", "v1", WebVisitAction.ALLOWED, fifteenDaysAgo, id = "old")
        webVisitRepo.record("device-1", "recent.example", null, null, "cat", "v1", WebVisitAction.ALLOWED, oneDayAgo, id = "recent")

        executeRetentionMaintenanceCycle(
            engine = engine,
            familyId = "family-1",
            deviceId = "device-1",
            zoneId = zone,
            nowUtc = now,
        )

        assertEquals(1, webVisitRepo.getForDevice("device-1").size)
        assertEquals("recent.example", webVisitRepo.getForDevice("device-1").single().domain)
        assertTrue(db.retentionDeletionReceiptDao().getForFamily("family-1").isNotEmpty())
    }

    @Test
    fun `a null familyId skips the cycle entirely -- no rows touched, no receipt inserted`() = runTest {
        seedEnrolledDevice()
        val webVisitRepo = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())
        val now = Instant.parse("2026-08-12T00:00:00Z")
        webVisitRepo.record(
            "device-1", "old.example", null, null, "cat", "v1", WebVisitAction.ALLOWED,
            now.minusSeconds(15L * 24 * 60 * 60).toEpochMilli(), id = "old",
        )

        executeRetentionMaintenanceCycle(engine = engine, familyId = null, deviceId = "device-1", zoneId = zone, nowUtc = now)

        assertEquals(1, webVisitRepo.getForDevice("device-1").size)
        assertTrue(db.retentionDeletionReceiptDao().getForFamily("family-1").isEmpty())
    }

    @Test
    fun `a null deviceId skips the cycle entirely -- not-enrolled-yet discipline, never a fabricated scope`() = runTest {
        seedEnrolledDevice()
        val webVisitRepo = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())
        val now = Instant.parse("2026-08-12T00:00:00Z")
        webVisitRepo.record(
            "device-1", "old.example", null, null, "cat", "v1", WebVisitAction.ALLOWED,
            now.minusSeconds(15L * 24 * 60 * 60).toEpochMilli(), id = "old",
        )

        executeRetentionMaintenanceCycle(engine = engine, familyId = "family-1", deviceId = null, zoneId = zone, nowUtc = now)

        assertEquals(1, webVisitRepo.getForDevice("device-1").size)
        assertTrue(db.retentionDeletionReceiptDao().getForFamily("family-1").isEmpty())
    }

    @Test
    fun `a device that is not yet a recognized family member never crashes the cycle -- runCatching absorbs the scope failure`() = runTest {
        // Deliberately no seedEnrolledDevice() call -- "device-1" is unknown to this database, so
        // RetentionEngine.runGeneralCycle's own scope validation throws IllegalArgumentException
        // internally. This proves executeRetentionMaintenanceCycle's runCatching guard actually
        // absorbs that failure rather than propagating it to the caller (the same "never crash the
        // caller" contract PcaAppGraph.runUsageLocationIngestionCycle documents).
        executeRetentionMaintenanceCycle(
            engine = engine,
            familyId = "family-1",
            deviceId = "device-1",
            zoneId = zone,
            nowUtc = Instant.parse("2026-08-12T00:00:00Z"),
        )
        // Reaching this line without an uncaught exception is the assertion.
    }

    @Test
    fun `pruneTombstones and the audit floor cycle both still run even when the general cycle's device scope is invalid`() = runTest {
        val ancientMillis = Instant.parse("2000-01-01T00:00:00Z").toEpochMilli()
        db.tamperEventDao().upsert(
            org.pca.app.persistence.entity.TamperEventEntity("t1", "device-1", "ROOT_DETECTED", ancientMillis, null),
        )

        // No seedEnrolledDevice(): the general cycle's own scope validation fails and is absorbed,
        // but the audit-floor cycle keys only on familyId/nowUtc/zoneId, not device scope, so it
        // must still run and delete the ancient tamper row.
        executeRetentionMaintenanceCycle(
            engine = engine,
            familyId = "family-1",
            deviceId = "device-1",
            zoneId = zone,
            nowUtc = Instant.parse("2026-08-12T00:00:00Z"),
        )

        assertEquals(0, db.tamperEventDao().count())
    }
}
