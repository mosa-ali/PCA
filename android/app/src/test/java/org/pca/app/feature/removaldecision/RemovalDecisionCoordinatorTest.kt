package org.pca.app.feature.removaldecision

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.dao.TamperEventDao
import org.pca.app.persistence.entity.TamperEventEntity
import org.pca.app.persistence.repository.TamperEventRepository

private class FakeWallClock(var nowMillis: Long) : WallClockTimeSource {
    override fun currentTimeMillis(): Long = nowMillis
}

/** Minimal in-memory fake of the DAO -- enough for [TamperEventRepository] (a real, unmodified production class) to exercise real upsert/read behavior against, without a real Room database. */
private class FakeTamperEventDao : TamperEventDao {
    val rows = mutableMapOf<String, TamperEventEntity>()
    override suspend fun upsert(entity: TamperEventEntity) { rows[entity.id] = entity }
    override suspend fun getForDevice(deviceId: String): List<TamperEventEntity> =
        rows.values.filter { it.deviceId == deviceId }.sortedByDescending { it.detectedAtEpochMillis }
    override suspend fun deleteOlderThanAuditFloor(auditFloorCutoffEpochMillis: Long): Int = 0
    override suspend fun countOlderThanAuditFloor(auditFloorCutoffEpochMillis: Long): Int = 0
    override suspend fun deleteAllForDevice(deviceId: String): Int = 0
    override suspend fun deleteAllForFamily(familyId: String): Int = 0
    override suspend fun count(): Int = rows.size
    override suspend fun deleteAll(): Int { rows.clear(); return 0 }
}

class RemovalDecisionCoordinatorTest {
    private val t0 = 10_000_000L

    private fun newCoordinator(
        dao: FakeTamperEventDao = FakeTamperEventDao(),
        wallClock: FakeWallClock = FakeWallClock(t0),
        deviceId: String? = "device-under-test",
    ): Triple<RemovalDecisionCoordinator, FakeTamperEventDao, FakeWallClock> {
        val coordinator = RemovalDecisionCoordinator(
            repository = InMemoryRemovalDecisionRepository(),
            stateMachine = RemovalDecisionStateMachine(),
            auditRecorder = RemovalDecisionAuditRecorder(TamperEventRepository(dao)),
            wallClock = wallClock,
            deviceIdProvider = { deviceId },
        )
        return Triple(coordinator, dao, wallClock)
    }

    @Test
    fun `currentRecord starts as KEEP_ACTIVE`() {
        val (coordinator, _, _) = newCoordinator()
        assertEquals(RemovalDecisionState.KEEP_ACTIVE, coordinator.currentRecord().state)
    }

    @Test
    fun `requestReview moves to PARENT_APPROVAL_REQUIRED`() {
        val (coordinator, _, _) = newCoordinator()
        val outcome = coordinator.requestReview()
        assertTrue(outcome is RemovalDecisionOutcome.Applied)
        assertEquals(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, coordinator.currentRecord().state)
    }

    @Test
    fun `decideKeepActive without authentication is refused`() {
        val (coordinator, _, _) = newCoordinator()
        coordinator.requestReview()
        val outcome = coordinator.decideKeepActive(isAuthenticated = false)
        assertTrue(outcome is RemovalDecisionOutcome.AuthenticationRequired)
        // Confirms it is a REAL refusal, not merely an ignored return value -- the underlying
        // record must still show the pending state, not KEEP_ACTIVE.
        assertEquals(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, coordinator.currentRecord().state)
    }

    @Test
    fun `decideKeepActive with authentication after a review request succeeds`() {
        val (coordinator, _, _) = newCoordinator()
        coordinator.requestReview()
        val outcome = coordinator.decideKeepActive(isAuthenticated = true)
        assertTrue(outcome is RemovalDecisionOutcome.Applied)
        assertEquals(RemovalDecisionState.KEEP_ACTIVE, coordinator.currentRecord().state)
    }

    @Test
    fun `decideKeepActive without a prior review request is rejected as an invalid transition`() {
        val (coordinator, _, _) = newCoordinator()
        val outcome = coordinator.decideKeepActive(isAuthenticated = true)
        assertTrue(outcome is RemovalDecisionOutcome.Rejected)
    }

    @Test
    fun `decideAllowRemoval writes an audit record via the real TamperEventRepository`() = runTest {
        val (coordinator, dao, wallClock) = newCoordinator()
        coordinator.requestReview()
        val outcome = coordinator.decideAllowRemoval(isAuthenticated = true)
        assertTrue(outcome is RemovalDecisionOutcome.Applied)
        assertEquals(RemovalDecisionState.ALLOW_REMOVAL, coordinator.currentRecord().state)

        val events = TamperEventRepository(dao).getForDevice("device-under-test")
        assertEquals(1, events.size)
        assertEquals(RemovalDecisionAuditRecorder.CONDITION_TYPE_ALLOW_REMOVAL, events.single().conditionType)
        assertEquals(wallClock.currentTimeMillis(), events.single().detectedAtEpochMillis)
    }

    @Test
    fun `decideAllowRemoval without authentication writes no audit record`() = runTest {
        val (coordinator, dao, _) = newCoordinator()
        coordinator.requestReview()
        val outcome = coordinator.decideAllowRemoval(isAuthenticated = false)
        assertTrue(outcome is RemovalDecisionOutcome.AuthenticationRequired)
        assertTrue(dao.rows.isEmpty())
    }

    @Test
    fun `decideAllowRemoval with no known device id applies the decision but cannot write an audit record`() = runTest {
        val (coordinator, dao, _) = newCoordinator(deviceId = null)
        coordinator.requestReview()
        val outcome = coordinator.decideAllowRemoval(isAuthenticated = true)
        assertTrue(outcome is RemovalDecisionOutcome.Applied)
        assertTrue(dao.rows.isEmpty())
    }

    @Test
    fun `decideTemporarilyDisable then an expired-window review request cycles back through PARENT_APPROVAL_REQUIRED`() {
        val (coordinator, _, wallClock) = newCoordinator()
        coordinator.requestReview()
        val disableOutcome = coordinator.decideTemporarilyDisable(isAuthenticated = true, untilEpochMillis = t0 + 60_000)
        assertTrue(disableOutcome is RemovalDecisionOutcome.Applied)

        wallClock.nowMillis = t0 + 60_001
        // currentRecord() auto-resolves the expired window back to KEEP_ACTIVE first.
        assertEquals(RemovalDecisionState.KEEP_ACTIVE, coordinator.currentRecord().state)

        val secondReview = coordinator.requestReview()
        assertTrue(secondReview is RemovalDecisionOutcome.Applied)
        assertEquals(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, coordinator.currentRecord().state)
    }

    @Test
    fun `ALLOW_REMOVAL is terminal -- a further review request is rejected`() = runTest {
        val (coordinator, _, _) = newCoordinator()
        coordinator.requestReview()
        coordinator.decideAllowRemoval(isAuthenticated = true)
        val outcome = coordinator.requestReview()
        assertTrue(outcome is RemovalDecisionOutcome.Rejected)
    }
}
