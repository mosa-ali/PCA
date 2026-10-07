package org.pca.app.platform

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.ContextWrapper
import android.os.Process
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.runtime.FakeMonotonicTimeSource
import org.pca.app.runtime.FakeWallClockTimeSource
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 33])
class StandardUsageObservationSourceTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private val elapsed = FakeMonotonicTimeSource(1_000_000_000L)
    private val wall = FakeWallClockTimeSource(11_000L)

    private fun permission(mode: Int) {
        val manager = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        shadowOf(manager).setMode("android:get_usage_stats", Process.myUid(), context.packageName, mode)
    }

    @Before fun grantPermission() = permission(AppOpsManager.MODE_ALLOWED)

    @Suppress("DEPRECATION")
    private fun addEvent(timestamp: Long, type: Int = UsageEvents.Event.MOVE_TO_FOREGROUND) {
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        shadowOf(manager).addEvent("test.app", timestamp, type)
    }

    @Test fun `platform wall timestamps survive one checked projection with explicit query bounds`() {
        addEvent(10_100L)
        val batch = StandardUsageObservationSource(context, elapsed, wall).queryObservationBatchSince(0L)
        assertEquals(UsageQueryStatus.OBSERVED, batch.status)
        assertEquals(10_000L, batch.queryStartWallMillis)
        assertEquals(UsageClockSample(1_000L, 11_000L), batch.beforeQuery)
        assertEquals(batch.beforeQuery, batch.afterQuery)
        assertEquals(10_100L, batch.events.single().epochMillis)
        assertEquals(100L, batch.events.single().event.elapsedRealtimeMillis)
    }

    @Test fun `denied access and successful empty observation remain distinct`() {
        val source = StandardUsageObservationSource(context, elapsed, wall)
        assertEquals(UsageQueryStatus.OBSERVED, source.queryObservationBatchSince(0L).status)
        permission(AppOpsManager.MODE_IGNORED)
        val batch = source.queryObservationBatchSince(0L)
        assertEquals(UsageQueryStatus.ACCESS_UNAVAILABLE, batch.status)
        assertEquals(UsageAccessState.DENIED, batch.accessState)
        assertTrue(batch.events.isEmpty())
    }

    @Test fun `forward and backward wall jumps during query discard events`() {
        addEvent(10_100L)
        for (after in listOf(13_000L, 9_000L)) {
            var samples = 0
            val changingClock = object : WallClockTimeSource {
                override fun currentTimeMillis() = if (samples++ == 0) 11_000L else after
            }
            val batch = StandardUsageObservationSource(context, elapsed, changingClock).queryObservationBatchSince(0L)
            assertEquals(UsageQueryStatus.CLOCK_DISCONTINUITY, batch.status)
            assertTrue(batch.events.isEmpty())
        }
    }

    @Test fun `more than bounded platform scan discards the entire query without partial credit`() {
        elapsed.nowNanos = 20_000_000_000L
        wall.nowMillis = 30_000L
        for (index in 1..4_097) addEvent(10_000L + index)
        val batch = StandardUsageObservationSource(context, elapsed, wall).queryObservationBatchSince(0L)
        assertEquals(UsageQueryStatus.QUERY_FAILED, batch.status)
        assertTrue(batch.events.isEmpty())
    }

    @Test fun `exact scan bound succeeds and irrelevant event types count toward the bound`() {
        elapsed.nowNanos = 20_000_000_000L
        wall.nowMillis = 30_000L
        for (index in 1..4_096) addEvent(10_000L + index, UsageEvents.Event.CONFIGURATION_CHANGE)
        val source = StandardUsageObservationSource(context, elapsed, wall)
        val bounded = source.queryObservationBatchSince(0L)
        assertEquals(UsageQueryStatus.OBSERVED, bounded.status)
        assertTrue(bounded.events.isEmpty())
        addEvent(14_097L, UsageEvents.Event.CONFIGURATION_CHANGE)
        assertEquals(UsageQueryStatus.QUERY_FAILED, source.queryObservationBatchSince(0L).status)
    }

    @Test fun `missing usage service is explicit rather than a successful empty query`() {
        val withoutService = object : ContextWrapper(context) {
            override fun getSystemService(name: String): Any? =
                if (name == Context.USAGE_STATS_SERVICE) null else super.getSystemService(name)
        }
        assertEquals(UsageQueryStatus.SERVICE_UNAVAILABLE,
            StandardUsageObservationSource(withoutService, elapsed, wall).queryObservationBatchSince(0L).status)
    }

    @Test fun `permission revoked before final sample discards collected events`() {
        addEvent(10_100L)
        var samples = 0
        val revokingClock = object : WallClockTimeSource {
            override fun currentTimeMillis(): Long {
                if (++samples == 2) permission(AppOpsManager.MODE_IGNORED)
                return 11_000L
            }
        }
        val batch = StandardUsageObservationSource(context, elapsed, revokingClock).queryObservationBatchSince(0L)
        assertEquals(UsageQueryStatus.ACCESS_UNAVAILABLE, batch.status)
        assertTrue(batch.events.isEmpty())
    }

    @Test fun `future and invalid cursors fail closed before projection`() {
        val source = StandardUsageObservationSource(context, elapsed, wall)
        for (cursor in listOf(-2L, 1_001L, Long.MAX_VALUE)) {
            assertEquals(UsageQueryStatus.CLOCK_DISCONTINUITY, source.queryObservationBatchSince(cursor).status)
        }
    }
}
