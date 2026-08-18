package org.pca.app.persistence

import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.ParentActionType
import org.pca.app.persistence.entity.ParentActionAuditEntity
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.entity.TamperEventEntity
import org.pca.app.persistence.entity.TombstoneRecordEntity
import org.pca.app.persistence.entity.WebVisitAction
import org.pca.app.persistence.repository.WebVisitRepository
import org.pca.app.persistence.retention.DeviceRetentionContext
import org.pca.app.persistence.retention.RetentionEngine
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class RetentionEngineTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var engine: RetentionEngine
    private val zone = ZoneId.of("UTC")

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        engine = RetentionEngine(db)
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `general cycle deletes only records older than the device's window and receipts the count`() = runTest {
        val webVisitRepo = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())
        val now = Instant.parse("2026-08-12T00:00:00Z")
        val fifteenDaysAgo = now.minusSeconds(15L * 24 * 60 * 60).toEpochMilli()
        val oneDayAgo = now.minusSeconds(24 * 60 * 60).toEpochMilli()

        webVisitRepo.record("device-1", "old.example", null, null, "cat", "v1", WebVisitAction.ALLOWED, fifteenDaysAgo, id = "old")
        webVisitRepo.record("device-1", "recent.example", null, null, "cat", "v1", WebVisitAction.ALLOWED, oneDayAgo, id = "recent")

        val ctx = DeviceRetentionContext("device-1", RetentionPolicy.FOURTEEN_DAYS, RetentionPolicy.FOURTEEN_DAYS, zone)
        val receipts = engine.runGeneralCycle("family-1", now, listOf(ctx))

        assertEquals(1, webVisitRepo.getForDevice("device-1").size)
        assertEquals("recent.example", webVisitRepo.getForDevice("device-1").single().domain)
        assertTrue(receipts.any { it.entityCategory == "WebVisit" && it.deletedCount == 1 })
        assertEquals(1, db.retentionDeletionReceiptDao().getForFamily("family-1").size)
    }

    @Test
    fun `general cycle never touches TamperEvent or ParentActionAudit`() = runTest {
        val ancientMillis = Instant.parse("2000-01-01T00:00:00Z").toEpochMilli()
        db.tamperEventDao().upsert(TamperEventEntity("t1", "device-1", "ROOT_DETECTED", ancientMillis, null))
        db.parentActionAuditDao().upsert(
            ParentActionAuditEntity("a1", "member-1", ParentActionType.POLICY_EDIT, "Policy:p1", ancientMillis, null, null),
        )

        val ctx = DeviceRetentionContext("device-1", RetentionPolicy.FOURTEEN_DAYS, RetentionPolicy.FOURTEEN_DAYS, zone)
        engine.runGeneralCycle("family-1", Instant.parse("2026-08-12T00:00:00Z"), listOf(ctx))

        assertEquals(1, db.tamperEventDao().count())
        assertEquals(1, db.parentActionAuditDao().count())
    }

    @Test
    fun `audit floor cycle deletes tamper and audit rows only past the 12-month floor`() = runTest {
        val now = Instant.parse("2026-08-12T00:00:00Z")
        val thirteenMonthsAgo = now.atZone(zone).minusMonths(13).toInstant().toEpochMilli()
        val sixMonthsAgo = now.atZone(zone).minusMonths(6).toInstant().toEpochMilli()

        db.tamperEventDao().upsert(TamperEventEntity("old", "device-1", "ROOT_DETECTED", thirteenMonthsAgo, null))
        db.tamperEventDao().upsert(TamperEventEntity("recent", "device-1", "ROOT_DETECTED", sixMonthsAgo, null))
        db.parentActionAuditDao().upsert(
            ParentActionAuditEntity("old-audit", "member-1", ParentActionType.POLICY_EDIT, "Policy:old", thirteenMonthsAgo, null, null),
        )
        db.parentActionAuditDao().upsert(
            ParentActionAuditEntity("recent-audit", "member-1", ParentActionType.POLICY_EDIT, "Policy:recent", sixMonthsAgo, null, null),
        )

        val receipts = engine.runAuditFloorCycle("family-1", now, RetentionPolicy.FOURTEEN_DAYS, zone)

        val remaining = db.tamperEventDao().getForDevice("device-1")
        assertEquals(1, remaining.size)
        assertEquals("recent", remaining.single().id)
        val remainingAudits = db.parentActionAuditDao().getForActor("member-1")
        assertEquals(1, remainingAudits.size)
        assertEquals("recent-audit", remainingAudits.single().id)
        assertTrue(receipts.any { it.entityCategory == "TamperEvent" && it.deletedCount == 1 })
        assertTrue(receipts.any { it.entityCategory == "ParentActionAudit" && it.deletedCount == 1 })
    }

    // ---- PCA-DATA-026: tombstone bounded-lifetime pruning ----

    @Test
    fun `pruneTombstones deletes only tombstones past the fixed six-month floor`() = runTest {
        val now = Instant.parse("2026-08-12T00:00:00Z")
        val sevenMonthsAgo = now.atZone(zone).minusMonths(7).toInstant().toEpochMilli()
        val oneMonthAgo = now.atZone(zone).minusMonths(1).toInstant().toEpochMilli()

        db.tombstoneRecordDao().insert(TombstoneRecordEntity("old", "family-1", "device-1", "Device", sevenMonthsAgo))
        db.tombstoneRecordDao().insert(TombstoneRecordEntity("recent", "family-1", "device-2", "Device", oneMonthAgo))

        val deleted = engine.pruneTombstones(now, zone)

        assertEquals(1, deleted)
        val remaining = db.tombstoneRecordDao().getForFamily("family-1")
        assertEquals(1, remaining.size)
        assertEquals("recent", remaining.single().id)
    }

    @Test
    fun `pruneTombstones never touches a tombstone still within its six-month floor`() = runTest {
        val now = Instant.parse("2026-08-12T00:00:00Z")
        val fiveMonthsAgo = now.atZone(zone).minusMonths(5).toInstant().toEpochMilli()
        db.tombstoneRecordDao().insert(TombstoneRecordEntity("t1", "family-1", "device-1", "Device", fiveMonthsAgo))

        val deleted = engine.pruneTombstones(now, zone)

        assertEquals(0, deleted)
        assertEquals(1, db.tombstoneRecordDao().count())
    }

    @Test
    fun `LATEST_ONLY location devices collapse to one row during a general cycle`() = runTest {
        // Bypass the repository's own write-time collapse (LocationPointRepository.record)
        // so this test exercises the retention ENGINE's own LATEST_ONLY convergence path,
        // e.g. after a policy change to LATEST_ONLY leaves stale multi-row history behind.
        db.locationPointDao().upsert(
            org.pca.app.persistence.entity.LocationPointEntity(
                "p-old", "device-1", 1000L, "enc", "iv", "enc", "iv", 5f, "GPS", RetentionPolicy.THREE_MONTHS,
            ),
        )
        db.locationPointDao().upsert(
            org.pca.app.persistence.entity.LocationPointEntity(
                "p-new", "device-1", 2000L, "enc", "iv", "enc", "iv", 5f, "GPS", RetentionPolicy.LATEST_ONLY,
            ),
        )

        val ctx = DeviceRetentionContext("device-1", RetentionPolicy.THREE_MONTHS, RetentionPolicy.LATEST_ONLY, zone)
        engine.runGeneralCycle("family-1", Instant.parse("2026-08-12T00:00:00Z"), listOf(ctx))

        val remaining = db.locationPointDao().getForDevice("device-1")
        assertEquals(1, remaining.size)
        assertEquals("p-new", remaining.single().id)
    }
}
