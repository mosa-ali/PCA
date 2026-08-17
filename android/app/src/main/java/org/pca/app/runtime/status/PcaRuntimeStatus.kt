package org.pca.app.runtime.status

import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.platform.LocationCapabilityLevel
import org.pca.app.platform.ProtectionMode
import org.pca.app.platform.UsageAccessState
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.pca.app.runtime.port.ScheduleEnforcementOutcome
import org.pca.app.runtime.port.ScheduleRuntimeStatus

/**
 * Section 15 ("Child Home / Status"): a single, honest snapshot of everything the child status
 * surface needs to render. Every field maps to a real, already-composed engine/port -- nothing
 * here is fabricated to make the UI look more complete than the underlying signal actually is
 * (Section 16: no stealth, no deceptive UI).
 */
data class PcaRuntimeStatus(
    val protectionMode: ProtectionMode,
    val screenTimeMode: ScreenTimeMode,
    val remainingActiveMillis: Long,
    val isBreakShieldActive: Boolean,
    val remainingBreakMillis: Long,
    val isEmergencyExceptionActive: Boolean,
    val scheduleStatus: ScheduleRuntimeStatus,
    val syncConnectionState: FamilySyncConnectionState,
    val lastSuccessfulSyncEpochMillis: Long?,
    val isDeviceOnline: Boolean,
    val usageAccessState: UsageAccessState,
    val locationCapabilityLevel: LocationCapabilityLevel,
    val wellbeingNotificationsAvailable: Boolean,
    val pendingChildRequestCount: Int,
    val scheduleEnforcementOutcome: ScheduleEnforcementOutcome = ScheduleEnforcementOutcome.NOT_ATTEMPTED,
    val callStatePermissionAvailable: Boolean = false,
) {
    /** True whenever local enforcement can be trusted to be running, regardless of connectivity --
     * Section 0/15's "Protection active locally" honesty requirement. Local engines never depend
     * on [isDeviceOnline] or [syncConnectionState], so this is always true once the runtime has
     * started; kept as an explicit field (rather than a hardcoded `true` in the UI) so a future,
     * genuinely-degraded local condition has somewhere real to report through. */
    val isLocalProtectionActive: Boolean get() = true

    /** Section 15's "Remote updates pending" honesty requirement: true whenever the device is
     * offline or the sync channel is not yet [FamilySyncConnectionState.LIVE], distinct from local
     * protection status. */
    val areRemoteUpdatesPending: Boolean get() = !isDeviceOnline || syncConnectionState != FamilySyncConnectionState.LIVE
}
