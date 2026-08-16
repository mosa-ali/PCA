package org.pca.app.runtime.location.geofence

import org.pca.app.platform.LocationSample

/**
 * PCA-FR-063: pure, deterministic geofence entry/exit reducer -- same discipline as
 * [org.pca.app.feature.eyedistance.engine.EyeDistanceEngine]: no I/O, no clock reads, every
 * decision derived only from its explicit inputs, and safe to call repeatedly/out-of-order (a
 * stale or duplicate sample can only ever re-confirm or fail to confirm a candidate streak, never
 * corrupt state).
 *
 * Two independent defenses against a false alert from a single noisy fix, matching this codebase's
 * "trust feature" framing (PCA-FR-135: an opt-in alert, not silent continuous tracking, so a false
 * alert has a real cost to trust):
 *  - HYSTERESIS: once a zone is confirmed INSIDE, exiting requires clearing
 *    `radius + [GeofenceConfig.hysteresisMeters]`, not just the plain radius -- a device sitting on
 *    the boundary line does not flap every sample.
 *  - DEBOUNCE: even a sample that crosses the (possibly hysteresis-widened) boundary only becomes a
 *    confirmed transition after [GeofenceConfig.requiredConsecutiveSamplesToConfirm] consecutive
 *    samples agree; any sample that disagrees along the way resets the candidate streak to 1.
 *
 * Cold start (confirmed membership [GeofenceMembership.UNKNOWN]) never itself emits a transition:
 * this engine has no way to know whether the device just arrived or was already there before the
 * app/process started, and fabricating an ENTRY alert in that case would be exactly the kind of
 * dishonest signal this codebase's other engines refuse to produce. The first confirmation from
 * UNKNOWN silently establishes a baseline; only a LATER, genuine crossing away from that baseline
 * produces an alert.
 */
object GeofenceEngine {

    fun evaluate(
        zone: GeofenceZone,
        state: GeofenceZoneState,
        sample: LocationSample,
        nowMonotonicNanos: Long,
        config: GeofenceConfig = GeofenceConfig(),
    ): GeofenceEvaluation {
        require(zone.zoneId == state.zoneId) {
            "zone/state id mismatch: zone=${zone.zoneId} state=${state.zoneId}"
        }

        val distanceMeters = GeofenceMath.haversineMeters(
            zone.centerLatitude, zone.centerLongitude, sample.latitude, sample.longitude,
        )

        val rawMembership = rawMembershipFor(zone, state.confirmedMembership, distanceMeters, config)

        if (rawMembership == state.confirmedMembership) {
            // Agrees with the already-confirmed state: nothing pending, reset any stale candidate.
            return GeofenceEvaluation(
                newState = state.copy(
                    candidateMembership = state.confirmedMembership,
                    candidateStreak = 0,
                    lastEvaluatedMonotonicNanos = nowMonotonicNanos,
                ),
                transition = null,
                distanceMeters = distanceMeters,
            )
        }

        // Disagrees with the confirmed state -- accumulate (or restart) the debounce streak.
        val streak = if (state.candidateMembership == rawMembership) state.candidateStreak + 1 else 1

        if (streak < config.requiredConsecutiveSamplesToConfirm) {
            return GeofenceEvaluation(
                newState = state.copy(
                    candidateMembership = rawMembership,
                    candidateStreak = streak,
                    lastEvaluatedMonotonicNanos = nowMonotonicNanos,
                ),
                transition = null,
                distanceMeters = distanceMeters,
            )
        }

        // Debounce satisfied: confirm the new membership. Only emit a transition when the PREVIOUS
        // confirmed state was itself known -- see class doc on cold start.
        val wasKnown = state.confirmedMembership != GeofenceMembership.UNKNOWN
        val transition = if (wasKnown) {
            if (rawMembership == GeofenceMembership.INSIDE) GeofenceTransitionType.ENTRY else GeofenceTransitionType.EXIT
        } else {
            null
        }
        return GeofenceEvaluation(
            newState = GeofenceZoneState(
                zoneId = zone.zoneId,
                confirmedMembership = rawMembership,
                candidateMembership = rawMembership,
                candidateStreak = 0,
                lastEvaluatedMonotonicNanos = nowMonotonicNanos,
            ),
            transition = transition,
            distanceMeters = distanceMeters,
        )
    }

    private fun rawMembershipFor(
        zone: GeofenceZone,
        confirmed: GeofenceMembership,
        distanceMeters: Double,
        config: GeofenceConfig,
    ): GeofenceMembership = when (confirmed) {
        GeofenceMembership.INSIDE ->
            if (distanceMeters > zone.radiusMeters + config.hysteresisMeters) GeofenceMembership.OUTSIDE else GeofenceMembership.INSIDE
        GeofenceMembership.OUTSIDE, GeofenceMembership.UNKNOWN ->
            if (distanceMeters <= zone.radiusMeters) GeofenceMembership.INSIDE else GeofenceMembership.OUTSIDE
    }
}
