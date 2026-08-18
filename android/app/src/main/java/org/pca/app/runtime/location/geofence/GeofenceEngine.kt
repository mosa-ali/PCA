package org.pca.app.runtime.location.geofence

import org.pca.app.platform.LocationSample

/**
 * PCA-FR-063: pure, deterministic geofence entry/exit reducer -- same discipline as
 * [org.pca.app.feature.eyedistance.engine.EyeDistanceEngine]: no I/O, no clock reads, every
 * decision derived only from its explicit inputs, and safe to call repeatedly/out-of-order (a
 * stale, duplicate, or out-of-order sample can only ever be ignored, never corrupt state).
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
        require(nowMonotonicNanos >= 0L) { "nowMonotonicNanos must not be negative" }

        val distanceMeters = GeofenceMath.haversineMeters(
            zone.centerLatitude, zone.centerLongitude, sample.latitude, sample.longitude,
        )

        if (!zone.enabled) {
            // A disabled policy is not an OUTSIDE observation and must not
            // manufacture an EXIT. Reset the local baseline so re-enabling
            // starts conservatively from UNKNOWN and cannot alert on stale
            // state that was captured before the policy was disabled.
            return GeofenceEvaluation(
                newState = state.copy(
                    confirmedMembership = GeofenceMembership.UNKNOWN,
                    candidateMembership = GeofenceMembership.UNKNOWN,
                    candidateStreak = 0,
                ),
                transition = null,
                distanceMeters = distanceMeters,
            )
        }

        val sampleElapsedMillis = sample.elapsedRealtimeMillis
        require(sampleElapsedMillis >= 0L) { "sample elapsedRealtimeMillis must not be negative" }

        // SystemClock.elapsedRealtime() is the source of truth for runtime samples. The zero
        // origin is valid during the first boot instant, but cannot establish ordering; once a
        // positive origin exists, every positive sample must be strictly newer and within the
        // configured freshness window. This also makes delayed last-known fixes fail closed.
        if (sampleElapsedMillis > 0L) {
            val nowElapsedMillis = nowMonotonicNanos / NANOS_PER_MILLISECOND
            val sampleAgeMillis = nowElapsedMillis - sampleElapsedMillis
            if (sampleAgeMillis < 0L || sampleAgeMillis > config.maxSampleAgeMillis) {
                return GeofenceEvaluation(state, transition = null, distanceMeters = distanceMeters)
            }
            val previousAccepted = state.lastAcceptedSampleElapsedRealtimeMillis
            if (previousAccepted != null && sampleElapsedMillis <= previousAccepted) {
                return GeofenceEvaluation(state, transition = null, distanceMeters = distanceMeters)
            }
        } else if (state.lastAcceptedSampleElapsedRealtimeMillis != null && state.lastAcceptedSampleElapsedRealtimeMillis > 0L) {
            // A legacy/boot-zero sample cannot establish ordering after a positive sample has
            // already been accepted; fail closed instead of allowing it to reverse membership.
            return GeofenceEvaluation(state, transition = null, distanceMeters = distanceMeters)
        }
        if (state.lastEvaluatedMonotonicNanos > 0L && nowMonotonicNanos < state.lastEvaluatedMonotonicNanos) {
            return GeofenceEvaluation(state, transition = null, distanceMeters = distanceMeters)
        }

        val acceptedSampleElapsedMillis = if (sampleElapsedMillis == 0L) {
            state.lastAcceptedSampleElapsedRealtimeMillis ?: 0L
        } else {
            sampleElapsedMillis
        }

        val rawMembership = rawMembershipFor(zone, state.confirmedMembership, distanceMeters, config)

        if (rawMembership == state.confirmedMembership) {
            // Agrees with the already-confirmed state: nothing pending, reset any stale candidate.
            return GeofenceEvaluation(
                newState = state.copy(
                    candidateMembership = state.confirmedMembership,
                    candidateStreak = 0,
                    lastEvaluatedMonotonicNanos = nowMonotonicNanos,
                    lastAcceptedSampleElapsedRealtimeMillis = acceptedSampleElapsedMillis,
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
                    lastAcceptedSampleElapsedRealtimeMillis = acceptedSampleElapsedMillis,
                ),
                transition = null,
                distanceMeters = distanceMeters,
            )
        }

        // Debounce satisfied: confirm the new membership. Only emit a transition when the PREVIOUS
        // confirmed state was itself known -- see class doc on cold start.
        val wasKnown = state.confirmedMembership != GeofenceMembership.UNKNOWN
        val transition = if (wasKnown) {
            if (rawMembership == GeofenceMembership.INSIDE) {
                GeofenceTransitionType.ENTRY.takeIf { it in zone.transitionTypes }
            } else {
                GeofenceTransitionType.EXIT.takeIf { it in zone.transitionTypes }
            }
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
                lastAcceptedSampleElapsedRealtimeMillis = acceptedSampleElapsedMillis,
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

    private const val NANOS_PER_MILLISECOND = 1_000_000L
}
