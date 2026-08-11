package org.pca.app.platform.proximity

/**
 * Coarse proximity classification only (doc 13: wellbeing guidance, NOT a medical device, NOT a
 * centimetre-precision vision measurement system). Ordinary hardware proximity sensors and
 * foreground camera estimation both genuinely support only a near/far/unknown judgment on most
 * devices -- no code in this feature invents a numeric distance from either source.
 */
enum class ProximityReading { NEAR, FAR, UNKNOWN }

/** Which tier of the sensor hierarchy (doc 13 Section 4) produced a reading. */
enum class ProximitySourceClass { HARDWARE_PROXIMITY_SENSOR, CAMERA_FACE_GEOMETRY, DEPTH_CAPABLE }

enum class ProximitySourceAvailability { AVAILABLE, UNAVAILABLE, PERMISSION_REQUIRED, PERMISSION_DENIED }

enum class ProximityConfidence { HIGH, MEDIUM, LOW, NONE }

/**
 * A single, self-contained proximity judgment. Deliberately carries no raw sensor sample, camera
 * frame, or landmark data -- only the bounded fields the eye-distance engine and any persisted
 * outcome are allowed to depend on (doc 13 Section 7 / privacy boundary).
 */
data class ProximityObservation(
    val reading: ProximityReading,
    val sourceClass: ProximitySourceClass,
    val confidence: ProximityConfidence,
    val availability: ProximitySourceAvailability,
    val elapsedRealtimeNanos: Long,
    /** True when the source is [ProximitySourceAvailability.AVAILABLE] but the current judgment
     * is known to be unreliable (e.g. camera confidence collapsed mid-session) -- distinct from
     * availability itself, which only says whether the source exists and is permitted to run. */
    val degraded: Boolean,
)

/** A single tier of the proximity sensor hierarchy. */
interface ProximitySource {
    val sourceClass: ProximitySourceClass
    fun availability(): ProximitySourceAvailability
    fun currentObservation(): ProximityObservation
}
