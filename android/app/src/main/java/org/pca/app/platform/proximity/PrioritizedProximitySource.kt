package org.pca.app.platform.proximity

/**
 * Composes the sensor hierarchy in strict priority order (doc 13 Section 4): the first source in
 * [sources] that reports [ProximitySourceAvailability.AVAILABLE] is used exclusively for the
 * current observation. A lower-priority source is never consulted while a higher-priority one is
 * available, and this class never fabricates a reading when every source is unavailable -- it
 * reports [ProximityReading.UNKNOWN] with [ProximitySourceAvailability.UNAVAILABLE] instead.
 *
 * Typical construction order: [HardwareProximitySource] first, [CameraProximitySource] second.
 * A future depth-capable source would be added after camera only once a real public API backs
 * it (doc 13 Section 4, tier 3) -- none exists in this codebase yet.
 */
class PrioritizedProximitySource(private val sources: List<ProximitySource>) : ProximitySource {

    init {
        require(sources.isNotEmpty()) { "PrioritizedProximitySource requires at least one source" }
    }

    override val sourceClass: ProximitySourceClass
        get() = activeSource()?.sourceClass ?: sources.first().sourceClass

    override fun availability(): ProximitySourceAvailability =
        activeSource()?.availability() ?: sources.first().availability()

    override fun currentObservation(): ProximityObservation {
        val active = activeSource()
        return active?.currentObservation() ?: ProximityObservation(
            reading = ProximityReading.UNKNOWN,
            sourceClass = sources.first().sourceClass,
            confidence = ProximityConfidence.NONE,
            availability = ProximitySourceAvailability.UNAVAILABLE,
            elapsedRealtimeNanos = sources.first().currentObservation().elapsedRealtimeNanos,
            degraded = false,
        )
    }

    private fun activeSource(): ProximitySource? =
        sources.firstOrNull { it.availability() == ProximitySourceAvailability.AVAILABLE }
}
