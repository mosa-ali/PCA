package org.pca.app.runtime.location.geofence

/**
 * PCA-FR-063 / PCA-FR-135: a parent-defined "trust zone" -- distinct from continuous location
 * tracking, this is only ever used to decide whether the child's device has crossed the zone's
 * boundary, never to report or retain a continuous track. [radiusMeters] is the zone's nominal
 * boundary; the actual exit boundary used at runtime also folds in [GeofenceConfig.hysteresisMeters]
 * (see [GeofenceEngine]) so a device sitting exactly on the line does not flap.
 */
data class GeofenceZone(
    val zoneId: String,
    val label: String,
    val centerLatitude: Double,
    val centerLongitude: Double,
    val radiusMeters: Double,
) {
    init {
        require(zoneId.isNotBlank()) { "zoneId must not be blank" }
        require(radiusMeters > 0.0) { "radiusMeters must be positive" }
        require(centerLatitude in -90.0..90.0) { "centerLatitude out of range" }
        require(centerLongitude in -180.0..180.0) { "centerLongitude out of range" }
    }
}

/** Tunables governing how confidently a raw distance sample is trusted before a zone's confirmed
 * membership actually changes -- see [GeofenceEngine]'s doc for the full debounce/hysteresis design. */
data class GeofenceConfig(
    /** Extra distance (beyond [GeofenceZone.radiusMeters]) a device must clear before an EXIT is
     * even considered -- defends against GPS jitter right at the boundary. Entry uses the plain
     * radius (no outward buffer), matching the product intent that entry alerts are conservative
     * about latency but exit alerts are conservative about false positives. */
    val hysteresisMeters: Double = 25.0,
    /** Number of consecutive samples that must agree on the NEW membership before it is confirmed
     * and a transition event is emitted -- defends against a single noisy/rapid boundary-crossing
     * sample producing a spurious alert. */
    val requiredConsecutiveSamplesToConfirm: Int = 2,
    /** Maximum age of a monotonic location sample before it can affect membership. A sample with
     * an elapsed-realtime origin of zero is accepted as the boot-time origin; real recorder samples
     * advance beyond zero and are checked against this bound. */
    val maxSampleAgeMillis: Long = 15 * 60 * 1000L,
) {
    init {
        require(hysteresisMeters >= 0.0) { "hysteresisMeters must not be negative" }
        require(requiredConsecutiveSamplesToConfirm >= 1) { "requiredConsecutiveSamplesToConfirm must be at least 1" }
        require(maxSampleAgeMillis > 0L) { "maxSampleAgeMillis must be positive" }
    }
}

enum class GeofenceMembership { UNKNOWN, INSIDE, OUTSIDE }

enum class GeofenceTransitionType { ENTRY, EXIT }

/** Per-zone bookkeeping carried between evaluations -- entirely derived from real distance samples,
 * never fabricated. [candidateMembership]/[candidateStreak] are the in-progress debounce counters;
 * they are distinct from [confirmedMembership], which is the only value a transition is ever
 * computed relative to. */
data class GeofenceZoneState(
    val zoneId: String,
    val confirmedMembership: GeofenceMembership = GeofenceMembership.UNKNOWN,
    val candidateMembership: GeofenceMembership = GeofenceMembership.UNKNOWN,
    val candidateStreak: Int = 0,
    val lastEvaluatedMonotonicNanos: Long = 0L,
    /** Elapsed-realtime timestamp of the newest accepted sample, used to reject duplicate or
     * out-of-order fixes after process restart. Null preserves compatibility with old state rows. */
    val lastAcceptedSampleElapsedRealtimeMillis: Long? = null,
)

/** Result of one [GeofenceEngine.evaluate] call. [transition] is non-null only on the exact call
 * where a debounced membership change is confirmed -- callers must treat a null transition as "no
 * alert this call," even though [newState] may still have changed (e.g. a candidate streak
 * advancing). */
data class GeofenceEvaluation(
    val newState: GeofenceZoneState,
    val transition: GeofenceTransitionType?,
    val distanceMeters: Double,
)

/** A confirmed, alert-worthy zone boundary crossing. */
data class GeofenceEvent(
    val zoneId: String,
    val zoneLabel: String,
    val transitionType: GeofenceTransitionType,
    val nowMonotonicNanos: Long,
    val distanceMeters: Double,
)
