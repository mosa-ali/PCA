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
    fun `an enrolled device with no delivered family roster runs the LOCAL_DEVICE_UNPAIRED cycle instead of skipping`() = runTest {
        // The bootstrap DTO never discloses familyId to the device (EnrollmentCoordinator's
        // documented KNOWN_GAP) and the roster only arrives through the crypto-gated sync path, so a
        // real enrolled device spends its whole pre-pairing life with a blank family id. Until
        // 2026-09-08 this test asserted the cycle SKIPPED in that state -- which meant every locally
        // captured row lived forever on an unpaired device. The local-scope cycle now runs.
        seedEnrolledDevice(familyId = "")
        val webVisitRepo = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())
        val now = Instant.parse("2026-08-12T00:00:00Z")
        webVisitRepo.record("device-1", "old.example", null, null, "cat", "v1", WebVisitAction.ALLOWED, now.minusSeconds(15L * 24 * 60 * 60).toEpochMilli(), id = "old")
        webVisitRepo.record("device-1", "recent.example", null, null, "cat", "v1", WebVisitAction.ALLOWED, now.minusSeconds(24 * 60 * 60).toEpochMilli(), id = "recent")

        executeRetentionMaintenanceCycle(engine = engine, familyId = null, deviceId = "device-1", zoneId = zone, nowUtc = now)

        assertEquals(listOf("recent.example"), webVisitRepo.getForDevice("device-1").map { it.domain })
        val receipts = db.retentionDeletionReceiptDao().getForFamily(RetentionEngine.LOCAL_DEVICE_SCOPE)
        assertTrue(receipts.any { it.entityCategory == "WebVisit" && it.deletedCount == 1 && it.deviceId == "device-1" })
        assertTrue(db.retentionDeletionReceiptDao().getForFamily("family-1").isEmpty())
    }

    @Test
    fun `the local-scope cycle never touches another device's rows`() = runTest {
        seedEnrolledDevice(familyId = "")
        db.familyMemberDao().upsert(
            FamilyMemberEntity("member-2", "", FamilyMemberRole.CHILD, "enc", "iv", FamilyMemberStatus.ACTIVE, "8-12", 1L),
        )
        db.deviceDao().upsert(
            DeviceEntity(
                "device-2", "member-2", DevicePlatform.ANDROID, "35", "1", "signing", "encryption",
                1L, 1L, DeviceTrustState.ACTIVE, DeviceEnrollmentState.ACTIVE, 1L, "{}",
            ),
        )
        val webVisitRepo = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())
        val now = Instant.parse("2026-08-12T00:00:00Z")
        val old = now.minusSeconds(15L * 24 * 60 * 60).toEpochMilli()
        webVisitRepo.record("device-1", "old-1.example", null, null, "cat", "v1", WebVisitAction.ALLOWED, old, id = "old-1")
        webVisitRepo.record("device-2", "old-2.example", null, null, "cat", "v1", WebVisitAction.ALLOWED, old, id = "old-2")

        executeRetentionMaintenanceCycle(engine = engine, familyId = "", deviceId = "device-1", zoneId = zone, nowUtc = now)

        assertEquals(0, webVisitRepo.getForDevice("device-1").size)
        assertEquals(1, webVisitRepo.getForDevice("device-2").size)
    }

    @Test
    fun `a rolled-back wall clock cannot postpone expiry -- the cycle judges against the trusted-time floor`() = runTest {
        seedEnrolledDevice()
        val webVisitRepo = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())
        val realNow = Instant.parse("2026-08-12T00:00:00Z")
        webVisitRepo.record("device-1", "old.example", null, null, "cat", "v1", WebVisitAction.ALLOWED, realNow.minusSeconds(15L * 24 * 60 * 60).toEpochMilli(), id = "old")
        val rolledBack = realNow.minusSeconds(30L * 24 * 60 * 60)

        // Without a floor the rolled-back clock makes the 15-day-old row look 15 days in the future.
        executeRetentionMaintenanceCycle(engine = engine, familyId = "family-1", deviceId = "device-1", zoneId = zone, nowUtc = rolledBack)
        assertEquals(1, webVisitRepo.getForDevice("device-1").size)

        // With the tamper layer's high-water mark as the floor, expiry is judged against real time.
        executeRetentionMaintenanceCycle(
            engine = engine, familyId = "family-1", deviceId = "device-1", zoneId = zone,
            nowUtc = rolledBack, trustedTimeFloorMillis = realNow.toEpochMilli(),
        )
        assertEquals(0, webVisitRepo.getForDevice("device-1").size)
    }

    @Test
    fun `clampToTrustedTimeFloor only ever moves time forward`() {
        val t = Instant.parse("2026-08-12T00:00:00Z")
        assertEquals(t, clampToTrustedTimeFloor(t, null))
        assertEquals(t, clampToTrustedTimeFloor(t, t.toEpochMilli() - 1))
        assertEquals(t, clampToTrustedTimeFloor(t, t.toEpochMilli()))
        assertEquals(Instant.ofEpochMilli(t.toEpochMilli() + 5), clampToTrustedTimeFloor(t, t.toEpochMilli() + 5))
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
