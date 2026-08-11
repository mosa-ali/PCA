package org.pca.app.feature.screentime.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

class ParentOverrideEngineTest {

    private val config = ScreenTimeConfig(activeThreshold = 60.minutes, breakDuration = 30.minutes)

    private fun tick(state: ScreenTimeState, nowNanos: Long): ScreenTimeState =
        ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(nowNanos), config)

    private fun authorization(
        scope: ParentOverrideScope,
        boundedDuration: Duration = 30.minutes,
        issuedAtEpochMillis: Long = 0L,
        expiresAtEpochMillis: Long = 60_000L,
    ) = ParentAuthorization(
        approverId = "parent-1",
        scope = scope,
        boundedDuration = boundedDuration,
        issuedAtEpochMillis = issuedAtEpochMillis,
        expiresAtEpochMillis = expiresAtEpochMillis,
        auditId = "audit-42",
    )

    // ---- skip break ---------------------------------------------------------

    @Test
    fun `a valid skip-break request is applied and carries the audit id`() {
        val inBreak = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)

        val result = ParentOverrideEngine.applySkipBreakRequest(
            inBreak,
            SkipBreakRequest(60.minutes.inWholeNanoseconds, nowWallClockMillis = 1_000L, authorization = authorization(ParentOverrideScope.SKIP_BREAK)),
            config,
        )

        val applied = result as ParentOverrideResult.Applied
        assertEquals(ScreenTimeMode.ACTIVE, applied.state.mode)
        assertEquals(0L, applied.state.activeElapsedNanos)
        assertEquals(1, applied.state.overriddenBreakCount)
        assertEquals("audit-42", applied.auditId)
    }

    @Test
    fun `a skip-break request while still ACTIVE is explicitly rejected, not silently ignored`() {
        val active = ScreenTimeState.initial(0L)

        val result = ParentOverrideEngine.applySkipBreakRequest(
            active,
            SkipBreakRequest(0L, nowWallClockMillis = 1_000L, authorization = authorization(ParentOverrideScope.SKIP_BREAK)),
            config,
        )

        val rejected = result as ParentOverrideResult.Rejected
        assertEquals(ParentOverrideRejectionReason.NOT_IN_BREAK_SHIELD, rejected.reason)
        assertEquals(active.mode, rejected.state.mode) // state is unchanged, but the caller is told why
        assertEquals("audit-42", rejected.auditId)
    }

    @Test
    fun `an expired skip-break authorization is rejected even while BREAK_SHIELD is active`() {
        val inBreak = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)

        val result = ParentOverrideEngine.applySkipBreakRequest(
            inBreak,
            SkipBreakRequest(
                60.minutes.inWholeNanoseconds,
                nowWallClockMillis = 70_000L,
                authorization = authorization(ParentOverrideScope.SKIP_BREAK, expiresAtEpochMillis = 60_000L),
            ),
            config,
        )

        val rejected = result as ParentOverrideResult.Rejected
        assertEquals(ParentOverrideRejectionReason.EXPIRED, rejected.reason)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, rejected.state.mode) // the shield stays up
    }

    @Test
    fun `a not-yet-valid authorization is rejected`() {
        val inBreak = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)

        val result = ParentOverrideEngine.applySkipBreakRequest(
            inBreak,
            SkipBreakRequest(
                60.minutes.inWholeNanoseconds,
                nowWallClockMillis = 500L,
                authorization = authorization(ParentOverrideScope.SKIP_BREAK, issuedAtEpochMillis = 1_000L),
            ),
            config,
        )

        assertEquals(ParentOverrideRejectionReason.NOT_YET_VALID, (result as ParentOverrideResult.Rejected).reason)
    }

    @Test
    fun `a grant-time authorization cannot be used to skip a break`() {
        val inBreak = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)

        val result = ParentOverrideEngine.applySkipBreakRequest(
            inBreak,
            SkipBreakRequest(60.minutes.inWholeNanoseconds, nowWallClockMillis = 1_000L, authorization = authorization(ParentOverrideScope.GRANT_TIME)),
            config,
        )

        assertEquals(ParentOverrideRejectionReason.WRONG_SCOPE, (result as ParentOverrideResult.Rejected).reason)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, result.state.mode)
    }

    // ---- grant time -----------------------------------------------------------

    @Test
    fun `a valid grant-time request is applied and bounded by the authorization`() {
        val active = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds)

        val result = ParentOverrideEngine.applyGrantTimeRequest(
            active,
            GrantTimeRequest(
                55.minutes.inWholeNanoseconds,
                nowWallClockMillis = 1_000L,
                authorization = authorization(ParentOverrideScope.GRANT_TIME, boundedDuration = 30.minutes),
                extra = 15.minutes,
            ),
            config,
        )

        val applied = result as ParentOverrideResult.Applied
        assertEquals(20.minutes.inWholeNanoseconds, ScreenTimeEngine.remainingActiveNanos(applied.state, config))
    }

    @Test
    fun `a grant-time request exceeding its authorized bound is rejected, not clamped silently`() {
        val active = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds)

        val result = ParentOverrideEngine.applyGrantTimeRequest(
            active,
            GrantTimeRequest(
                55.minutes.inWholeNanoseconds,
                nowWallClockMillis = 1_000L,
                authorization = authorization(ParentOverrideScope.GRANT_TIME, boundedDuration = 10.minutes),
                extra = 15.minutes,
            ),
            config,
        )

        val rejected = result as ParentOverrideResult.Rejected
        assertEquals(ParentOverrideRejectionReason.EXTRA_DURATION_EXCEEDS_BOUND, rejected.reason)
        // the streak must be exactly as it was before the rejected request — no partial grant.
        assertEquals(55.minutes.inWholeNanoseconds, rejected.state.activeElapsedNanos)
    }

    @Test
    fun `a grant-time request while BREAK_SHIELD is active is explicitly rejected, not a silent no-op`() {
        val inBreak = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)

        val result = ParentOverrideEngine.applyGrantTimeRequest(
            inBreak,
            GrantTimeRequest(
                60.minutes.inWholeNanoseconds,
                nowWallClockMillis = 1_000L,
                authorization = authorization(ParentOverrideScope.GRANT_TIME),
                extra = 10.minutes,
            ),
            config,
        )

        val rejected = result as ParentOverrideResult.Rejected
        assertEquals(ParentOverrideRejectionReason.NOT_ACTIVE, rejected.reason)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, rejected.state.mode)
        assertTrue(result is ParentOverrideResult.Rejected) // typed, not a bare unchanged ScreenTimeState
    }

    @Test
    fun `authorization construction rejects a blank approver or audit id`() {
        try {
            authorization(ParentOverrideScope.GRANT_TIME).copy(approverId = "")
            org.junit.Assert.fail("expected IllegalArgumentException")
        } catch (expected: IllegalArgumentException) {
            // expected: init block validates approverId
        }
    }
}
