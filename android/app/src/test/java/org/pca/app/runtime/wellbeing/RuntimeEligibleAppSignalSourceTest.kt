package org.pca.app.runtime.wellbeing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.UsageEvent
import org.pca.app.platform.UsageEventType
import org.pca.app.runtime.FakeMonotonicTimeSource
import org.pca.app.runtime.FakeUsageObservationSource

class RuntimeEligibleAppSignalSourceTest {

    @Test
    fun `no usage access reports no eligible app, never fabricated`() {
        val usage = FakeUsageObservationSource(accessState = UsageAccessState.DENIED)
        val source = RuntimeEligibleAppSignalSource(usage, FakeMonotonicTimeSource()) { setOf("com.example.game") }

        assertNull(source.currentEligibleAppToken())
    }

    @Test
    fun `a foreground event for a non-eligible package reports no eligible app`() {
        val usage = FakeUsageObservationSource(
            events = listOf(UsageEvent("com.example.notEligible", UsageEventType.FOREGROUND, 0L)),
        )
        val source = RuntimeEligibleAppSignalSource(usage, FakeMonotonicTimeSource()) { setOf("com.example.game") }

        assertNull(source.currentEligibleAppToken())
    }

    @Test
    fun `a foreground event for an eligible package reports an opaque, stable, non-identifying token`() {
        val usage = FakeUsageObservationSource(
            events = listOf(UsageEvent("com.example.game", UsageEventType.FOREGROUND, 0L)),
        )
        val source = RuntimeEligibleAppSignalSource(usage, FakeMonotonicTimeSource()) { setOf("com.example.game") }

        val token = source.currentEligibleAppToken()

        assertNotEquals(null, token)
        assertNotEquals("com.example.game", token)
        assertEquals(false, token!!.contains("game"))
    }

    @Test
    fun `a background event for the current foreground package clears the eligible app`() {
        val usage = FakeUsageObservationSource(
            events = listOf(UsageEvent("com.example.game", UsageEventType.FOREGROUND, 0L)),
        )
        val source = RuntimeEligibleAppSignalSource(usage, FakeMonotonicTimeSource()) { setOf("com.example.game") }
        assertNotEquals(null, source.currentEligibleAppToken())

        usage.events = listOf(UsageEvent("com.example.game", UsageEventType.BACKGROUND, 1_000L))

        assertNull(source.currentEligibleAppToken())
    }

    @Test
    fun `the same package always produces the same opaque token`() {
        val usage = FakeUsageObservationSource(
            events = listOf(UsageEvent("com.example.game", UsageEventType.FOREGROUND, 0L)),
        )
        val sourceA = RuntimeEligibleAppSignalSource(usage, FakeMonotonicTimeSource()) { setOf("com.example.game") }
        val sourceB = RuntimeEligibleAppSignalSource(usage, FakeMonotonicTimeSource()) { setOf("com.example.game") }

        assertEquals(sourceA.currentEligibleAppToken(), sourceB.currentEligibleAppToken())
    }
}
