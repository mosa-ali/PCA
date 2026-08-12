package org.pca.app.runtime.location

import org.pca.app.platform.BackgroundLocationState
import org.pca.app.platform.LocationCapabilitySnapshot
import org.pca.app.platform.LocationPermissionState
import org.pca.app.platform.LocationServicesState

/**
 * Canonical, caller-facing location-sample status -- the same naming convention as
 * [org.pca.app.platform.LocationCapabilityLevel] and [org.pca.app.platform.UsageAccessState]:
 * every value maps to a real, independently-observable condition in
 * [org.pca.app.platform.LocationCapabilitySnapshot], never an invented or inferred state.
 * Distinct from [org.pca.app.platform.LocationCapabilityLevel] in granularity -- that enum answers
 * "can I get A location right now" (USABLE/LIMITED/UNUSABLE); this one answers "what would the
 * NEXT sample actually look like," which [LocationSampleRecorder] needs to decide both whether to
 * persist a sample at all and how to represent its precision honestly.
 */
enum class LocationSampleStatus {
    /** Fine permission, services on, a provider is enabled, background access is not a blocker --
     * a genuine high-accuracy fix can be attempted. */
    AVAILABLE,
    /** Only COARSE permission is granted -- a fix can still be attempted, but must never be
     * reported or persisted at better than approximate precision (see [LocationSampleRecorder]). */
    APPROXIMATE_ONLY,
    /** Neither FINE nor COARSE permission is granted -- no fix may be attempted at all. */
    PERMISSION_REQUIRED,
    /** Foreground permission is granted but [BackgroundLocationState.NOT_GRANTED] -- a foreground
     * fix is still obtainable, but this device cannot be expected to produce background samples. */
    BACKGROUND_LIMITED,
    /** System-wide location services are switched off -- independent of this app's own permission
     * grant. */
    LOCATION_DISABLED,
    /** Permission and services both allow a fix in principle, but no provider is enabled (or, at
     * capture time, the platform simply had no last-known fix to offer) -- honestly "no data
     * right now," never fabricated. */
    UNAVAILABLE,
}

/**
 * Pure derivation from the real, granular [LocationCapabilitySnapshot] fields -- same "never
 * invents a distinction the platform can't back" discipline as
 * [LocationCapabilitySnapshot.overallLevel]. Precedence (most-blocking first): outright permission
 * denial, then system-wide services being off, then no provider existing at all, then the
 * background-specific limitation, then the coarse-only precision limitation, else AVAILABLE.
 */
object LocationSampleStatusResolver {
    fun resolve(snapshot: LocationCapabilitySnapshot): LocationSampleStatus = when {
        snapshot.permissionState == LocationPermissionState.DENIED -> LocationSampleStatus.PERMISSION_REQUIRED
        snapshot.servicesState == LocationServicesState.DISABLED -> LocationSampleStatus.LOCATION_DISABLED
        !snapshot.providerAvailability.gpsProviderEnabled && !snapshot.providerAvailability.networkProviderEnabled ->
            LocationSampleStatus.UNAVAILABLE
        snapshot.backgroundState == BackgroundLocationState.NOT_GRANTED -> LocationSampleStatus.BACKGROUND_LIMITED
        snapshot.permissionState == LocationPermissionState.COARSE_ONLY -> LocationSampleStatus.APPROXIMATE_ONLY
        else -> LocationSampleStatus.AVAILABLE
    }
}
