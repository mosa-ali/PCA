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
        val zones = zoneStore.loadZones()
        if (zones.isEmpty()) return emptyList()

        val events = mutableListOf<GeofenceEvent>()
        for (zone in zones) {
            val priorState = zoneStateStore.load(zone.zoneId) ?: GeofenceZoneState(zoneId = zone.zoneId)
            val evaluation = GeofenceEngine.evaluate(zone, priorState, sample, nowMonotonicNanos, config)
            zoneStateStore.save(evaluation.newState)

            val transition = evaluation.transition ?: continue
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
