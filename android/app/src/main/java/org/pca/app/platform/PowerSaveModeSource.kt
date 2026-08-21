package org.pca.app.platform

import android.content.Context
import android.os.PowerManager

/**
 * PCA-NFR-034 (EVENT_DRIVEN_BATTERY_BUDGET): the one documented-API signal this app reads to
 * decide whether the OS considers the device to be conserving power right now. Deliberately a
 * single-method read-only port (same shape as every other platform capability source in this
 * package -- [LocationCapabilitySource], [VpnCapabilitySource], [DevicePolicyCapabilitySource])
 * so callers depend on an interface, not a concrete `Context`/`PowerManager`, and tests can supply
 * a fake without Robolectric.
 *
 * Consulted by non-safety-critical background work only (see
 * [org.pca.app.runtime.background.PcaBatteryBudgetPolicy.shouldRunNonCriticalWork]) -- this app's
 * safety-critical protection paths (schedule/active-restriction enforcement in
 * [org.pca.app.runtime.PcaRuntime]'s tick loop, and the tamper/protection-degradation monitors in
 * [org.pca.app.runtime.graph.PcaAppGraph.runUsageLocationIngestionCycle]) never consult this
 * source and must keep running unconditionally regardless of what it reports.
 */
interface PowerSaveModeSource {
    /** True whenever the OS reports Battery Saver / power-save mode currently active. */
    fun isPowerSaveMode(): Boolean
}

/**
 * Standard Mode / general implementation. Always re-queries [PowerManager] live -- never caches --
 * matching this package's other `Standard*Source` adapters' anti-caching discipline (e.g.
 * [StandardDevicePolicyCapabilitySource]'s own doc comment). Fails closed to "not power-saving"
 * (`false`) on any lookup failure, so a transient platform error can never silently suppress
 * non-critical work forever -- the same fail-safe posture [StandardVpnCapabilitySource.isPermissionGranted]
 * already uses for its own `runCatching { ... }.getOrDefault(false)`.
 */
class StandardPowerSaveModeSource(private val context: Context) : PowerSaveModeSource {
    override fun isPowerSaveMode(): Boolean = runCatching {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        powerManager?.isPowerSaveMode ?: false
    }.getOrDefault(false)
}
