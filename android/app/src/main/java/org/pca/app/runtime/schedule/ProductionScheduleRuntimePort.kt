package org.pca.app.runtime.schedule

import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.runtime.connectivity.NetworkConnectivityObserver
import org.pca.app.runtime.port.ScheduleRuntimePort
import org.pca.app.runtime.port.ScheduleRuntimeStatus
import java.time.Instant

/**
 * Coordinator integration glue: the real [ScheduleRuntimePort] binding, delegating every decision
 * to Agent 10's [ScheduleRuntime] -- this class adds no policy logic of its own, only maps
 * [ScheduleRuntimeState] onto the narrower [ScheduleRuntimeStatus] this runtime-composition layer
 * consumes. [currentStatus] deliberately uses a wildcard app token: it reports whether a schedule
 * is currently trustworthy at all, not a per-app enforcement verdict (that remains
 * [ScheduleRuntime.evaluate]'s job, called per-app by the actual enforcement path once wired).
 */
class ProductionScheduleRuntimePort(
    private val scheduleRuntime: ScheduleRuntime,
    private val wallClockTimeSource: WallClockTimeSource,
    private val connectivityObserver: NetworkConnectivityObserver,
) : ScheduleRuntimePort {

    override fun currentStatus(): ScheduleRuntimeStatus {
        val nowUtc = Instant.ofEpochMilli(wallClockTimeSource.currentTimeMillis())
        val connectivity = if (connectivityObserver.isCurrentlyOnline()) Connectivity.ONLINE else Connectivity.OFFLINE
        val result = scheduleRuntime.evaluate(
            nowUtc = nowUtc,
            appToken = STATUS_PROBE_APP_TOKEN,
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = connectivity,
        )
        return when (result.runtimeState) {
            ScheduleRuntimeState.CURRENT, ScheduleRuntimeState.STALE_REMOTE -> ScheduleRuntimeStatus.AVAILABLE
            ScheduleRuntimeState.EPOCH_STALE -> ScheduleRuntimeStatus.EPOCH_STALE
            ScheduleRuntimeState.NO_ACCEPTED_POLICY, ScheduleRuntimeState.INVALID -> ScheduleRuntimeStatus.NOT_READY
        }
    }

    private companion object {
        /** Not a real app -- [currentStatus] only needs [ScheduleRuntime.Result.runtimeState],
         * which is app-token-independent, never the per-app [ScheduleRuntime.Result.decision]. */
        const val STATUS_PROBE_APP_TOKEN = "org.pca.app.runtime.schedule.status-probe"
    }
}
