package org.pca.app.runtime.location

import org.pca.app.foundation.MonotonicTimeSource
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.repository.LocationPointRepository
import org.pca.app.platform.LocationCapabilitySource

/** Outcome of one [LocationSampleRecorder.captureSample] call. [recorded] is false whenever
 * [status] means no sample could honestly be persisted -- permission missing, services off, no
 * provider, or the platform simply had no last-known fix to offer at this instant. */
data class LocationCaptureResult(
    val status: LocationSampleStatus,
    val recorded: Boolean,
)

/**
 * PCA-ANDROID-USAGE-LOCATION-1: the real, permitted-sample-to-encrypted-local-persistence flow
 * for location, connecting [LocationCapabilitySource] (already-accepted `LocationManager`-backed
 * platform adapter -- no continuous background polling loop lives here, this class only samples
 * when [captureSample] is explicitly called by a caller that itself respects platform
 * battery/background limits) to Agent-12's [LocationPointRepository], which already encrypts
 * latitude/longitude at rest (PCA-LOCAL-DB-1 Section 14) and already enforces
 * [RetentionPolicy.LATEST_ONLY] rolling retention in the same transaction as the insert.
 * Time-windowed retention policies (14 days / 1/3/6/9 months) are enforced by the existing
 * [org.pca.app.persistence.retention.RetentionEngine] cycle -- this recorder's only retention
 * responsibility is to record [RetentionPolicy] honestly on every point, which it does by taking
 * it as an explicit parameter (never guessing or hardcoding a default the caller didn't choose).
 *
 * Never fabricates a location: if [LocationCapabilitySource.lastKnownLocation] returns null (no
 * fix available), nothing is persisted and [LocationCaptureResult.recorded] is false.
 *
 * Never reports exact coordinates under approximate-only permission: when
 * [LocationSampleStatus.APPROXIMATE_ONLY] is resolved, the coordinates are additionally
 * grid-rounded (see [roundApproximate]) before being persisted, in DEFENSE-IN-DEPTH on top of
 * Android's own coarse-location obfuscation -- this adapter's own guarantee does not depend on the
 * platform having applied one.
 */
class LocationSampleRecorder(
    private val locationCapabilitySource: LocationCapabilitySource,
    private val locationPointRepository: LocationPointRepository,
    private val monotonicTimeSource: MonotonicTimeSource,
    private val wallClockTimeSource: WallClockTimeSource,
) {
    suspend fun captureSample(deviceId: String, retentionPolicy: RetentionPolicy): LocationCaptureResult {
        val snapshot = locationCapabilitySource.currentCapability()
        val status = LocationSampleStatusResolver.resolve(snapshot)

        if (status == LocationSampleStatus.PERMISSION_REQUIRED ||
            status == LocationSampleStatus.LOCATION_DISABLED ||
            status == LocationSampleStatus.UNAVAILABLE
        ) {
            return LocationCaptureResult(status = status, recorded = false)
        }

        val sample = locationCapabilitySource.lastKnownLocation()
            ?: return LocationCaptureResult(status = LocationSampleStatus.UNAVAILABLE, recorded = false)

        // Single bridge sample, same anti-drift technique UsageSessionRecorder uses: project the
        // platform's monotonic fix timestamp onto wall-clock at one consistent instant.
        val nowElapsed = monotonicTimeSource.elapsedRealtimeMillis()
        val nowEpoch = wallClockTimeSource.currentTimeMillis()
        val timestampEpochMillis = nowEpoch - (nowElapsed - sample.elapsedRealtimeMillis)

        val approximate = status == LocationSampleStatus.APPROXIMATE_ONLY
        val latitude = if (approximate) roundApproximate(sample.latitude) else sample.latitude
        val longitude = if (approximate) roundApproximate(sample.longitude) else sample.longitude
        val accuracyMeters = if (approximate) maxOf(sample.accuracyMeters, MIN_APPROXIMATE_ACCURACY_METERS) else sample.accuracyMeters

        locationPointRepository.record(
            deviceId = deviceId,
            timestampEpochMillis = timestampEpochMillis,
            latitude = latitude,
            longitude = longitude,
            accuracyMeters = accuracyMeters,
            source = if (approximate) SOURCE_APPROXIMATE else SOURCE_PLATFORM_FIX,
            retentionPolicy = retentionPolicy,
        )

        return LocationCaptureResult(status = status, recorded = true)
    }

    /** Floors to a ~0.01-degree grid (roughly 1.1km at the equator) -- coarser than any real
     * COARSE-permission fix Android itself would hand back, so this is a floor this adapter
     * enforces itself rather than a claim about what the platform already guarantees. */
    private fun roundApproximate(value: Double): Double {
        val factor = APPROXIMATE_GRID_FACTOR
        return Math.floor(value * factor) / factor
    }

    companion object {
        const val SOURCE_PLATFORM_FIX = "PLATFORM_FIX"
        const val SOURCE_APPROXIMATE = "NETWORK_APPROXIMATE"
        private const val APPROXIMATE_GRID_FACTOR = 100.0
        private const val MIN_APPROXIMATE_ACCURACY_METERS = 1000f
    }
}
