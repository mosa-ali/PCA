package org.pca.app.platform

/**
 * Real, observable location PERMISSION state this app itself holds (doc 06
 * requires REQUIRES_USER_PERMISSION in both modes). Reports exactly what
 * `ContextCompat.checkSelfPermission` tells this app about itself --
 * Android provides no distinct "revoked" vs "never granted" signal at
 * this layer (same limitation as [UsageAccessState]) -- a caller detects
 * a revocation transition by diffing successive snapshots over time.
 */
enum class LocationPermissionState {
    /** ACCESS_FINE_LOCATION granted -- high-accuracy (GPS-capable) fixes available. */
    FINE,
    /** Only ACCESS_COARSE_LOCATION granted -- approximate (network/cell-based) fixes only, never GPS-tier accuracy. */
    COARSE_ONLY,
    /** Neither permission granted. */
    DENIED,
}

/**
 * Real, SYSTEM-WIDE location-services state, independent of this app's
 * own permission grant -- a user can grant this app location permission
 * while Location itself is off system-wide (the Quick Settings toggle),
 * or the reverse. Backed by `LocationManager.isLocationEnabled()`
 * (API 28+) / the pre-28 `Settings.Secure.LOCATION_MODE` equivalent.
 */
enum class LocationServicesState { ENABLED, DISABLED }

/** Real, per-provider availability (`LocationManager.isProviderEnabled`) -- a specific provider (e.g. GPS) can be disabled while another (network) remains enabled. */
data class LocationProviderAvailability(
    val gpsProviderEnabled: Boolean,
    val networkProviderEnabled: Boolean,
)

/**
 * A full, honest snapshot of this device's location CAPABILITY -- every
 * field maps to a real, independently-observable Android API. Deliberately
 * does NOT collapse these into one boolean, and does NOT invent a state
 * Android cannot actually report: there is no fabricated "DEGRADED" enum
 * value here -- battery/background restriction is exposed as its own
 * real, separately-observable signal ([backgroundExecutionUnrestricted])
 * rather than guessed at from indirect symptoms.
 */
data class LocationCapabilitySnapshot(
    val permissionState: LocationPermissionState,
    val servicesState: LocationServicesState,
    val providerAvailability: LocationProviderAvailability,
    /**
     * `PowerManager.isIgnoringBatteryOptimizations` -- false means the OS
     * may restrict this app's background execution, including background
     * location updates. This is the real, observable platform-level proxy
     * for "background/battery restriction" -- Android exposes no
     * location-specific battery-restriction API more granular than this.
     */
    val backgroundExecutionUnrestricted: Boolean,
)

/** A location sample, opaque to policy logic here -- reports what the platform reports, never interprets/geocodes/labels it (a later feature-phase, doc 16, concern). `accuracyMeters` is the platform-reported figure verbatim -- this module never estimates or upgrades a precision claim beyond what the fix itself reports. */
data class LocationSample(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val elapsedRealtimeMillis: Long,
)

/**
 * Adapter over the platform's location capability. This is the generic
 * capability foundation (permission/services/provider/background-
 * restriction snapshot + last-known-location read) -- continuous
 * tracking, geofencing, and any location-history feature policy are
 * PCA-7 (Location and last-seen) scope, built on top of this contract.
 */
interface LocationCapabilitySource {
    /** Re-queries every underlying platform signal live -- never a cached flag, same anti-caching discipline as every other capability adapter in this package. */
    fun currentCapability(): LocationCapabilitySnapshot
    fun lastKnownLocation(): LocationSample?
}
