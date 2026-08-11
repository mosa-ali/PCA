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

    override fun isAccessGranted(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
        // unsafeCheckOpNoThrow requires API 29+; checkOpNoThrow (deprecated in
        // favor of it, but the only option below API 29) is required for this
        // module's actual floor, minSdk 26.
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow("android:get_usage_stats", Process.myUid(), context.packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow("android:get_usage_stats", Process.myUid(), context.packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    override fun queryEventsSince(elapsedRealtimeMillis: Long): List<UsageEvent> {
        if (!isAccessGranted()) return emptyList()
        val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return emptyList()

        // UsageStatsManager.queryEvents is wall-clock-timestamp-based
        // (System.currentTimeMillis epoch), not elapsed-realtime. Bridge the
        // two timelines at a single instant so every timestamp this method
        // RETURNS stays on the monotonic timeline the interface promises,
        // per this interface's own anti-clock-rollback contract.
        val nowElapsed = monotonicTimeSource.elapsedRealtimeMillis()
        val nowWallClock = wallClockTimeSource.currentTimeMillis()
        val elapsedSinceOrigin = (nowElapsed - elapsedRealtimeMillis).coerceAtLeast(0)
        val wallClockOrigin = nowWallClock - elapsedSinceOrigin

        val events = usageStatsManager.queryEvents(wallClockOrigin, nowWallClock)
        val result = mutableListOf<UsageEvent>()
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val type = classifyEventType(event.eventType) ?: continue
            val eventElapsed = event.timeStamp - wallClockOrigin + elapsedRealtimeMillis
            result.add(UsageEvent(event.packageName, type, eventElapsed))
        }
        return result
    }

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
