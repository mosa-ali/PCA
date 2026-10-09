package org.pca.app.runtime.location.geofence

import org.pca.app.platform.LocationSample

/**
 * PCA-FR-063 orchestrator: evaluates one fresh [LocationSample] against every parent-defined
 * [GeofenceZone], persists each zone's updated [GeofenceZoneState], and delivers a local alert
 * ([GeofenceAlertPort]) for every confirmed transition. Pure coordination only -- all of the actual
 * entry/exit judgment lives in [GeofenceEngine]; this class never itself decides membership.
 *
 * Deliberately takes a single already-obtained [LocationSample] rather than reading location
 * itself: the caller (the existing ingestion cycle -- see
 * [org.pca.app.runtime.graph.PcaAppGraph.runUsageLocationIngestionCycle]) already owns exactly when
 * a sample is fetched, respecting the same permission/background/battery constraints
 * [org.pca.app.runtime.location.LocationSampleRecorder] does; this class adds no new location
 * access path of its own.
 */
class GeofenceMonitor(
    private val zoneStore: GeofenceZoneStore,
    private val zoneStateStore: GeofenceZoneStateStore,
    private val alertPort: GeofenceAlertPort,
    private val config: GeofenceConfig = GeofenceConfig(),
) {
    /** Returns every confirmed transition produced by this sample (usually empty). Safe to call
     * repeatedly and with stale/duplicate samples -- see [GeofenceEngine]'s own doc. */
    fun evaluateSample(sample: LocationSample, nowMonotonicNanos: Long): List<GeofenceEvent> {
        // The zone file's shared lock covers zone snapshot, state load/save, and
        // alert decision. A policy delivery takes the same lock while clearing
        // old state before replacing geometry in its separate backing file.
        return zoneStore.withPolicyLock { evaluateSampleUnderPolicyLock(sample, nowMonotonicNanos) }
    }

    private fun evaluateSampleUnderPolicyLock(sample: LocationSample, nowMonotonicNanos: Long): List<GeofenceEvent> {
        val snapshot = try {
            zoneStore.loadScopedZones()
        } catch (_: CorruptGeofenceZoneStoreException) {
            // Never partially enforce a snapshot whose record set cannot be authenticated by
            // strict local decoding. The receiver and authoring path also refuse to overwrite it.
            return emptyList()
        } ?: return emptyList()
        val scope = snapshot.scope
        val zones = snapshot.zones
        if (zones.isEmpty()) return emptyList()
        // The scope provider can change while a location tick is running
        // (for example after enrollment is cleared/replaced). A stale zone
        // snapshot must not be evaluated as the new family's policy.
        if (!zoneStore.isCurrentScope(scope)) return emptyList()

        val events = mutableListOf<GeofenceEvent>()
        for (zone in zones) {
            if (!zoneStore.isCurrentScope(scope)) return events
            val storedState = zoneStateStore.load(scope, zone.zoneId)
            // A completed streak is never persisted by the reducer; it would
            // otherwise confirm a transition from one sample after corruption.
            val priorState = storedState?.takeIf {
                it.candidateStreak == 0 || it.candidateStreak < config.requiredConsecutiveSamplesToConfirm
            } ?: GeofenceZoneState(zoneId = zone.zoneId)
            val evaluation = GeofenceEngine.evaluate(zone, priorState, sample, nowMonotonicNanos, config)
            zoneStateStore.save(scope, evaluation.newState)

            val transition = evaluation.transition ?: continue
            if (!zoneStore.isCurrentScope(scope)) return events
            val event = GeofenceEvent(
                zoneId = zone.zoneId,
                zoneLabel = zone.label,
                transitionType = transition,
                nowMonotonicNanos = nowMonotonicNanos,
                distanceMeters = evaluation.distanceMeters,
            )
            events += event
            alertPort.deliver(event)
        }
        return events
    }
}
