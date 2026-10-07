package org.pca.app.platform

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import org.pca.app.foundation.MonotonicTimeSource
import org.pca.app.foundation.WallClockTimeSource

/**
 * Standard Mode / general implementation over UsageStatsManager. Requires
 * the user-granted PACKAGE_USAGE_STATS special access (doc 06: usage
 * stats REQUIRES_USER_PERMISSION in both Standard and Protected Mode --
 * this is not a Protected-Mode-only capability).
 */
class StandardUsageObservationSource(
    private val context: Context,
    private val monotonicTimeSource: MonotonicTimeSource,
    private val wallClockTimeSource: WallClockTimeSource,
) : UsageObservationSource {

    override fun accessState(): UsageAccessState {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
            ?: return UsageAccessState.UNAVAILABLE
        // unsafeCheckOpNoThrow requires API 29+; checkOpNoThrow (deprecated in
        // favor of it, but the only option below API 29) is required for this
        // module's actual floor, minSdk 26.
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow("android:get_usage_stats", Process.myUid(), context.packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow("android:get_usage_stats", Process.myUid(), context.packageName)
        }
        return mapAppOpsMode(mode)
    }

    override fun queryEventsSince(elapsedRealtimeMillis: Long): List<UsageEvent> {
        val batch = queryObservationBatchSince(elapsedRealtimeMillis)
        return if (batch.status == UsageQueryStatus.OBSERVED) batch.events.map { it.event } else emptyList()
    }

    override fun queryObservationBatchSince(elapsedRealtimeMillis: Long): UsageObservationBatch {
        val before = clockSample()
        val access = accessState()
        fun unavailable(status: UsageQueryStatus, actualAccess: UsageAccessState = access) =
            UsageObservationBatch(emptyList(), before, clockSample(), null, actualAccess, status)
        if (access != UsageAccessState.GRANTED) return unavailable(UsageQueryStatus.ACCESS_UNAVAILABLE)
        if (elapsedRealtimeMillis < -1L || !UsageClockBridge.valid(before))
            return unavailable(UsageQueryStatus.CLOCK_DISCONTINUITY)
        val queryStart = UsageClockBridge.wallAtElapsed(elapsedRealtimeMillis.coerceAtLeast(0L), before)
            ?: return unavailable(UsageQueryStatus.CLOCK_DISCONTINUITY)
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return unavailable(UsageQueryStatus.SERVICE_UNAVAILABLE)
        return try {
            val platformEvents = manager.queryEvents(queryStart, before.wallMillis)
                ?: return unavailable(UsageQueryStatus.SERVICE_UNAVAILABLE)
            val observed = mutableListOf<UsageObservedEvent>()
            val event = UsageEvents.Event()
            var scannedEvents = 0
            while (platformEvents.hasNextEvent()) {
                // Bound application iteration/materialization, including irrelevant event types.
                // The framework query's own internal allocation is outside this bound.
                if (++scannedEvents > 4_096) return unavailable(UsageQueryStatus.QUERY_FAILED)
                platformEvents.getNextEvent(event)
                val type = classifyEventType(event.eventType) ?: continue
                if (event.timeStamp < queryStart || event.timeStamp > before.wallMillis)
                    return unavailable(UsageQueryStatus.CLOCK_DISCONTINUITY)
                val elapsed = UsageClockBridge.elapsedAtWall(event.timeStamp, before)
                    ?: return unavailable(UsageQueryStatus.CLOCK_DISCONTINUITY)
                observed.add(UsageObservedEvent(UsageEvent(event.packageName, type, elapsed), event.timeStamp))
            }
            val after = clockSample()
            val finalAccess = accessState()
            val status = when {
                finalAccess != UsageAccessState.GRANTED -> UsageQueryStatus.ACCESS_UNAVAILABLE
                !UsageClockBridge.continuous(before, after) -> UsageQueryStatus.CLOCK_DISCONTINUITY
                else -> UsageQueryStatus.OBSERVED
            }
            UsageObservationBatch(if (status == UsageQueryStatus.OBSERVED) observed else emptyList(),
                before, after, queryStart, finalAccess, status)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            unavailable(UsageQueryStatus.QUERY_FAILED)
        }
    }

    private fun clockSample() = UsageClockSample(
        monotonicTimeSource.elapsedRealtimeMillis(), wallClockTimeSource.currentTimeMillis())

    /**
     * ACTIVITY_RESUMED/ACTIVITY_PAUSED (API 29+) are the non-deprecated
     * successors to MOVE_TO_FOREGROUND/MOVE_TO_BACKGROUND, which remain
     * deprecated-but-functional and are the only option below minSdk 26's
     * actual floor for this API (29). Branching keeps both the modern and
     * legacy platform ranges correctly classified without triggering a
     * deprecation lint finding on the branch that's actually reachable on
     * a given device.
     */
    @Suppress("DEPRECATION")
    private fun classifyEventType(eventType: Int): UsageEventType? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        when (eventType) {
            UsageEvents.Event.ACTIVITY_RESUMED -> UsageEventType.FOREGROUND
            UsageEvents.Event.ACTIVITY_PAUSED -> UsageEventType.BACKGROUND
            else -> null
        }
    } else {
        when (eventType) {
            UsageEvents.Event.MOVE_TO_FOREGROUND -> UsageEventType.FOREGROUND
            UsageEvents.Event.MOVE_TO_BACKGROUND -> UsageEventType.BACKGROUND
            else -> null
        }
    }
}

/**
 * Maps a real `android.app.AppOpsManager` MODE_* constant to
 * [UsageAccessState] -- any mode not explicitly recognized falls closed to
 * DENIED, never GRANTED. A top-level, package-visible pure function
 * (rather than a private class member) specifically so this mapping is
 * directly unit-testable against the real AppOpsManager constants without
 * needing to mock the Android framework -- `MODE_*` are compile-time
 * constant fields, referencing them does not invoke any stubbed platform
 * method body.
 */
internal fun mapAppOpsMode(mode: Int): UsageAccessState = when (mode) {
    AppOpsManager.MODE_ALLOWED -> UsageAccessState.GRANTED
    AppOpsManager.MODE_DEFAULT -> UsageAccessState.NOT_CONFIGURED
    AppOpsManager.MODE_IGNORED, AppOpsManager.MODE_ERRORED -> UsageAccessState.DENIED
    else -> UsageAccessState.DENIED
}
