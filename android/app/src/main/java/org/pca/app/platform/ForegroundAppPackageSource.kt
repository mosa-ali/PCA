package org.pca.app.platform

import org.pca.app.foundation.MonotonicTimeSource

/** Local-only foreground package signal used to hand the current app to schedule enforcement. */
interface ForegroundAppPackageSource {
    fun currentForegroundPackage(): String?
}

object NoOpForegroundAppPackageSource : ForegroundAppPackageSource {
    override fun currentForegroundPackage(): String? = null
}

/**
 * Reconstructs only the latest foreground package from the existing UsageStats observation port.
 * No package name is persisted or sent anywhere by this adapter. Missing usage access or an
 * incomplete event window returns null, never a guessed package.
 */
class UsageForegroundAppPackageSource(
    private val usageObservationSource: UsageObservationSource,
    private val monotonicTimeSource: MonotonicTimeSource,
) : ForegroundAppPackageSource {
    override fun currentForegroundPackage(): String? {
        val nowMillis = monotonicTimeSource.elapsedRealtimeMillis()
        val events = runCatching {
            usageObservationSource.queryEventsSince((nowMillis - LOOKBACK_MILLIS).coerceAtLeast(0L))
        }.getOrDefault(emptyList())

        var currentPackage: String? = null
        for (event in events.sortedBy { it.elapsedRealtimeMillis }) {
            when (event.eventType) {
                UsageEventType.FOREGROUND -> currentPackage = event.packageName
                UsageEventType.BACKGROUND -> if (currentPackage == event.packageName) currentPackage = null
            }
        }
        return currentPackage
    }

    private companion object {
        const val LOOKBACK_MILLIS = 60_000L
    }
}
