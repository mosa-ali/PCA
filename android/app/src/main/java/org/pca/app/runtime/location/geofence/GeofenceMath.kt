package org.pca.app.runtime.location.geofence

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * PCA-FR-063: pure distance math backing geofence membership decisions. Uses the standard
 * haversine great-circle formula -- accurate enough for the residential/school/park-scale radii
 * (tens of meters to a few kilometers) this feature targets; no external geodesy library needed.
 */
object GeofenceMath {
    private const val EARTH_RADIUS_METERS = 6_371_000.0

    /** Great-circle distance in meters between two lat/lon points (degrees). */
    fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val phi1 = Math.toRadians(lat1)
        val phi2 = Math.toRadians(lat2)
        val deltaPhi = Math.toRadians(lat2 - lat1)
        val deltaLambda = Math.toRadians(lon2 - lon1)

        val a = sin(deltaPhi / 2) * sin(deltaPhi / 2) +
            cos(phi1) * cos(phi2) * sin(deltaLambda / 2) * sin(deltaLambda / 2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return EARTH_RADIUS_METERS * c
    }
}
