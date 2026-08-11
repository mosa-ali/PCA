package org.pca.app.platform

import org.junit.Assert.assertEquals
import org.junit.Test

class UsageEventSessionPairerTest {
    @Test
    fun `a matched FOREGROUND-BACKGROUND pair produces one closed session`() {
        val events = listOf(
            UsageEvent("pkg.a", UsageEventType.FOREGROUND, 100),
            UsageEvent("pkg.a", UsageEventType.BACKGROUND, 500),
        )
        val sessions = UsageEventSessionPairer.pairSessions(events)
        assertEquals(listOf(RawUsageObservation("pkg.a", 100, 500)), sessions)
    }

    @Test
    fun `a FOREGROUND with no closing BACKGROUND is reported as an open session, end null, never guessed`() {
        val events = listOf(UsageEvent("pkg.a", UsageEventType.FOREGROUND, 100))
        val sessions = UsageEventSessionPairer.pairSessions(events)
        assertEquals(listOf(RawUsageObservation("pkg.a", 100, null)), sessions)
    }

    @Test
    fun `a BACKGROUND with no matching open session is dropped, never fabricated into a guessed-start session`() {
        val events = listOf(UsageEvent("pkg.a", UsageEventType.BACKGROUND, 500))
        val sessions = UsageEventSessionPairer.pairSessions(events)
        assertEquals(emptyList<RawUsageObservation>(), sessions)
    }

    @Test
    fun `duplicate FOREGROUND events for an already-open session preserve the original start time`() {
        val events = listOf(
            UsageEvent("pkg.a", UsageEventType.FOREGROUND, 100),
            UsageEvent("pkg.a", UsageEventType.FOREGROUND, 200), // spurious duplicate/out-of-order
            UsageEvent("pkg.a", UsageEventType.BACKGROUND, 500),
        )
        val sessions = UsageEventSessionPairer.pairSessions(events)
        assertEquals(listOf(RawUsageObservation("pkg.a", 100, 500)), sessions)
    }

    @Test
    fun `out-of-order events across two packages are paired independently and correctly`() {
        val events = listOf(
            UsageEvent("pkg.a", UsageEventType.FOREGROUND, 100),
            UsageEvent("pkg.b", UsageEventType.FOREGROUND, 150),
            UsageEvent("pkg.a", UsageEventType.BACKGROUND, 300),
            UsageEvent("pkg.b", UsageEventType.BACKGROUND, 400),
        )
        val sessions = UsageEventSessionPairer.pairSessions(events)
        assertEquals(
            listOf(
                RawUsageObservation("pkg.a", 100, 300),
                RawUsageObservation("pkg.b", 150, 400),
            ),
            sessions,
        )
    }

    @Test
    fun `a second FOREGROUND-BACKGROUND cycle for the same package after the first closes produces two independent sessions`() {
        val events = listOf(
            UsageEvent("pkg.a", UsageEventType.FOREGROUND, 100),
            UsageEvent("pkg.a", UsageEventType.BACKGROUND, 200),
            UsageEvent("pkg.a", UsageEventType.FOREGROUND, 300),
            UsageEvent("pkg.a", UsageEventType.BACKGROUND, 400),
        )
        val sessions = UsageEventSessionPairer.pairSessions(events)
        assertEquals(
            listOf(
                RawUsageObservation("pkg.a", 100, 200),
                RawUsageObservation("pkg.a", 300, 400),
            ),
            sessions,
        )
    }

    @Test
    fun `empty input (incomplete or absent evidence) produces zero sessions, never a fabricated one`() {
        assertEquals(emptyList<RawUsageObservation>(), UsageEventSessionPairer.pairSessions(emptyList()))
    }

    @Test
    fun `a stray extra BACKGROUND after a session already closed is dropped, not merged into the prior session`() {
        val events = listOf(
            UsageEvent("pkg.a", UsageEventType.FOREGROUND, 100),
            UsageEvent("pkg.a", UsageEventType.BACKGROUND, 200),
            UsageEvent("pkg.a", UsageEventType.BACKGROUND, 250), // duplicate/out-of-order close, no open session left
        )
        val sessions = UsageEventSessionPairer.pairSessions(events)
        assertEquals(listOf(RawUsageObservation("pkg.a", 100, 200)), sessions)
    }
}
