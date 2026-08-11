package org.pca.app.platform

/** A location sample, opaque to policy logic here -- reports what the platform reports, never interprets/geocodes/labels it (that is a later feature-phase, doc 16, concern). */
data class LocationSample(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val elapsedRealtimeMillis: Long,
)

/**
 * Adapter over the platform's location capability. Doc 06: location
 * REQUIRES_USER_PERMISSION in both Standard and Protected Mode. This is
 * the generic capability foundation (permission + last-known-location
 * read) -- continuous tracking, geofencing, and any location-history
 * feature policy are PCA-7 (Location and last-seen) scope, built on top
 * of this contract.
 */
interface LocationCapabilitySource {
    /** Re-queries platform permission state live -- never a cached flag. */
    fun isPermissionGranted(): Boolean
    fun lastKnownLocation(): LocationSample?
}
