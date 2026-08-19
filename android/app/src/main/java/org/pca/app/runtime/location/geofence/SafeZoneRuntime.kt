package org.pca.app.runtime.location.geofence

import org.pca.app.platform.LocationSample

/**
 * Local Safe Zone runtime composition for PCA-FR-063/PCA-FR-135:
 * accepted encrypted policy -> local zone store -> geofence reducer -> local
 * alert port. No server callback, readable policy relay, or continuous
 * location stream is introduced here. The caller still owns when samples are
 * obtained and the coordinator still supplies the verified family authority
 * and reviewed crypto adapters.
 */
class SafeZoneRuntime(
    private val policyReceiver: SafeZonePolicyReceiver,
    private val geofenceMonitor: GeofenceMonitor,
) {
    suspend fun receivePolicy(
        envelope: SafeZonePolicyEnvelope,
        nowEpochMillis: Long,
    ): SafeZonePolicyReceiveResult = policyReceiver.receive(envelope, nowEpochMillis)

    fun evaluateSample(
        sample: LocationSample,
        nowMonotonicNanos: Long,
    ): List<GeofenceEvent> = geofenceMonitor.evaluateSample(sample, nowMonotonicNanos)
}
