package org.pca.app.feature.screentime.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.screentime.persistence.InMemoryUsedAuthorizationStore
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
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
        auditId: String = "audit-42",
    ) = ParentAuthorization(
        approverId = "parent-1",
        scope = scope,
        boundedDuration = boundedDuration,
        issuedAtEpochMillis = issuedAtEpochMillis,
        expiresAtEpochMillis = expiresAtEpochMillis,
        auditId = auditId,
    )

    // ---- skip break ---------------------------------------------------------

    @Test
    fun `a valid skip-break request is applied and carries the audit id`() {
        val inBreak = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)

        val result = ParentOverrideEngine.applySkipBreakRequest(
            inBreak,
            SkipBreakRequest(60.minutes.inWholeNanoseconds, nowWallClockMillis = 1_000L, authorization = authorization(ParentOverrideScope.SKIP_BREAK)),
            InMemoryUsedAuthorizationStore(),
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
            InMemoryUsedAuthorizationStore(),
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
            InMemoryUsedAuthorizationStore(),
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
            InMemoryUsedAuthorizationStore(),
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
            InMemoryUsedAuthorizationStore(),
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
            InMemoryUsedAuthorizationStore(),
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
            InMemoryUsedAuthorizationStore(),
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
            InMemoryUsedAuthorizationStore(),
            config,
        )

        // Typed, not a bare unchanged ScreenTimeState: the cast below is only valid because
        // this is a Rejected, not an Applied that happens to look unchanged.
        val rejected = result as ParentOverrideResult.Rejected
        assertEquals(ParentOverrideRejectionReason.NOT_ACTIVE, rejected.reason)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, rejected.state.mode)
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

    // ---- NEW-002: single-use / replay protection -----------------------------

    @Test
    fun `first legitimate use of a skip-break authorization is accepted`() {
        val inBreak = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        val store = InMemoryUsedAuthorizationStore()

        val result = ParentOverrideEngine.applySkipBreakRequest(
            inBreak,
            SkipBreakRequest(60.minutes.inWholeNanoseconds, nowWallClockMillis = 1_000L, authorization = authorization(ParentOverrideScope.SKIP_BREAK)),
            store,
            config,
        )

        assertTrue(result is ParentOverrideResult.Applied)
        // A second claim attempt for the same id must now fail — it was consumed by the call above.
        assertTrue(!store.claimAuthorization("audit-42"))
    }

    @Test
    fun `exact replay of an already-applied skip-break authorization is rejected as ALREADY_USED`() {
        val store = InMemoryUsedAuthorizationStore()
        val auth = authorization(ParentOverrideScope.SKIP_BREAK)

        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        val first = ParentOverrideEngine.applySkipBreakRequest(
            state,
            SkipBreakRequest(60.minutes.inWholeNanoseconds, nowWallClockMillis = 1_000L, authorization = auth),
            store,
            config,
        )
        state = (first as ParentOverrideResult.Applied).state

        // The child immediately re-enters BREAK_SHIELD, and the same signed authorization is
        // replayed in an attempt to skip it a second time.
        state = tick(state, 120.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)

        val replay = ParentOverrideEngine.applySkipBreakRequest(
            state,
            SkipBreakRequest(120.minutes.inWholeNanoseconds, nowWallClockMillis = 2_000L, authorization = auth),
            store,
            config,
        )

        val rejected = replay as ParentOverrideResult.Rejected
        assertEquals(ParentOverrideRejectionReason.ALREADY_USED, rejected.reason)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, rejected.state.mode) // the second break is not skipped
    }

    @Test
    fun `exact replay of an already-applied grant-time authorization is rejected and grants nothing further`() {
        val store = InMemoryUsedAuthorizationStore()
        val auth = authorization(ParentOverrideScope.GRANT_TIME, boundedDuration = 30.minutes)

        var state = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds)
        val first = ParentOverrideEngine.applyGrantTimeRequest(
            state,
            GrantTimeRequest(55.minutes.inWholeNanoseconds, nowWallClockMillis = 1_000L, authorization = auth, extra = 15.minutes),
            store,
            config,
        )
        state = (first as ParentOverrideResult.Applied).state
        val remainingAfterFirstGrant = ScreenTimeEngine.remainingActiveNanos(state, config)

        val replay = ParentOverrideEngine.applyGrantTimeRequest(
            state,
            GrantTimeRequest(55.minutes.inWholeNanoseconds, nowWallClockMillis = 2_000L, authorization = auth, extra = 15.minutes),
            store,
            config,
        )

        val rejected = replay as ParentOverrideResult.Rejected
        assertEquals(ParentOverrideRejectionReason.ALREADY_USED, rejected.reason)
        // the grant did not stack: remaining time is exactly what the first, legitimate use produced.
        assertEquals(remainingAfterFirstGrant, ScreenTimeEngine.remainingActiveNanos(rejected.state, config))
    }

    @Test
    fun `a different authorization id is evaluated independently of a previously used one`() {
        val store = InMemoryUsedAuthorizationStore()
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)

        val firstAuth = authorization(ParentOverrideScope.SKIP_BREAK, auditId = "audit-1")
        val first = ParentOverrideEngine.applySkipBreakRequest(
            state,
            SkipBreakRequest(60.minutes.inWholeNanoseconds, nowWallClockMillis = 1_000L, authorization = firstAuth),
            store,
            config,
        )
        state = (first as ParentOverrideResult.Applied).state
        state = tick(state, 120.minutes.inWholeNanoseconds) // back into a second break

        val secondAuth = authorization(ParentOverrideScope.SKIP_BREAK, auditId = "audit-2")
        val second = ParentOverrideEngine.applySkipBreakRequest(
            state,
            SkipBreakRequest(120.minutes.inWholeNanoseconds, nowWallClockMillis = 2_000L, authorization = secondAuth),
            store,
            config,
        )

        assertTrue(second is ParentOverrideResult.Applied)
        assertEquals(2, (second as ParentOverrideResult.Applied).state.overriddenBreakCount)
    }

    @Test
    fun `a rejected request does not consume the authorization, so a later legitimate use still succeeds`() {
        val store = InMemoryUsedAuthorizationStore()
        val auth = authorization(ParentOverrideScope.SKIP_BREAK)

        // First attempt arrives too early (still ACTIVE) and is rejected.
        val tooEarly = ParentOverrideEngine.applySkipBreakRequest(
            ScreenTimeState.initial(0L),
            SkipBreakRequest(0L, nowWallClockMillis = 1_000L, authorization = auth),
            store,
            config,
        )
        assertEquals(ParentOverrideRejectionReason.NOT_IN_BREAK_SHIELD, (tooEarly as ParentOverrideResult.Rejected).reason)

        // Once actually in BREAK_SHIELD, the same (still-unused) authorization succeeds — which
        // is itself the proof that the earlier rejected attempt never consumed it; a peek-only
        // "is it used" check is deliberately not part of the store's interface, since exposing
        // one would reintroduce the check-then-act race the atomic claim exists to remove.
        val inBreak = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        val nowValid = ParentOverrideEngine.applySkipBreakRequest(
            inBreak,
            SkipBreakRequest(60.minutes.inWholeNanoseconds, nowWallClockMillis = 1_000L, authorization = auth),
            store,
            config,
        )

        assertTrue(nowValid is ParentOverrideResult.Applied)
    }

    // ---- NF-002: atomic claim under real concurrency --------------------------

    @Test
    fun `two concurrent skip-break requests for the same authorization - exactly one is Applied`() {
        val store = InMemoryUsedAuthorizationStore()
        val auth = authorization(ParentOverrideScope.SKIP_BREAK)
        val inBreak = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)

        val results = raceSkipBreakRequests(inBreak, auth, store, concurrency = 2)

        assertEquals(1, results.count { it is ParentOverrideResult.Applied })
        assertEquals(1, results.count { it is ParentOverrideResult.Rejected && it.reason == ParentOverrideRejectionReason.ALREADY_USED })
    }

    @Test
    fun `N concurrent skip-break requests for the same authorization - exactly one is Applied`() {
        val store = InMemoryUsedAuthorizationStore()
        val auth = authorization(ParentOverrideScope.SKIP_BREAK)
        val inBreak = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)

        val results = raceSkipBreakRequests(inBreak, auth, store, concurrency = 32)

        assertEquals(1, results.count { it is ParentOverrideResult.Applied })
        assertEquals(31, results.count { it is ParentOverrideResult.Rejected && it.reason == ParentOverrideRejectionReason.ALREADY_USED })
    }

    @Test
    fun `N concurrent grant-time requests for the same authorization - exactly one is Applied`() {
        val store = InMemoryUsedAuthorizationStore()
        val auth = authorization(ParentOverrideScope.GRANT_TIME, boundedDuration = 30.minutes)
        val active = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds)

        val pool = Executors.newFixedThreadPool(16)
        val results = try {
            val concurrency = 16
            val barrier = CyclicBarrier(concurrency)
            (1..concurrency).map {
                pool.submit<ParentOverrideResult> {
                    barrier.await(5, TimeUnit.SECONDS)
                    ParentOverrideEngine.applyGrantTimeRequest(
                        active,
                        GrantTimeRequest(55.minutes.inWholeNanoseconds, nowWallClockMillis = 1_000L, authorization = auth, extra = 15.minutes),
                        store,
                        config,
                    )
                }
            }.map { it.get(5, TimeUnit.SECONDS) }
        } finally {
            pool.shutdown()
        }

        assertEquals(1, results.count { it is ParentOverrideResult.Applied })
        assertEquals(15, results.count { it is ParentOverrideResult.Rejected && it.reason == ParentOverrideRejectionReason.ALREADY_USED })
    }

    private fun raceSkipBreakRequests(
        state: ScreenTimeState,
        auth: ParentAuthorization,
        store: InMemoryUsedAuthorizationStore,
        concurrency: Int,
    ): List<ParentOverrideResult> {
        val pool = Executors.newFixedThreadPool(concurrency)
        return try {
            val barrier = CyclicBarrier(concurrency)
            (1..concurrency).map {
                pool.submit<ParentOverrideResult> {
                    barrier.await(5, TimeUnit.SECONDS)
                    ParentOverrideEngine.applySkipBreakRequest(
                        state,
                        SkipBreakRequest(60.minutes.inWholeNanoseconds, nowWallClockMillis = 1_000L, authorization = auth),
                        store,
                        config,
                    )
                }
            }.map { it.get(5, TimeUnit.SECONDS) }
        } finally {
            pool.shutdown()
        }
    }
}
