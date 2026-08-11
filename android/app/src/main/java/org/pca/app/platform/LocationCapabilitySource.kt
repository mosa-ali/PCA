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
 * NF-001: real, observable BACKGROUND location authorization state,
 * distinct from foreground [LocationPermissionState]. Backed by
 * `ACCESS_BACKGROUND_LOCATION` (a separate runtime permission since API
 * 29/Q) -- fails closed on every path, never fabricates a background
 * capability the platform hasn't actually confirmed.
 */
enum class BackgroundLocationState {
    /** Foreground location permission itself is not granted, so background authorization is moot -- there is nothing to grant background access on top of. Distinguishing this from [NOT_GRANTED] matters: a caller must not report "background denied" as the headline problem when the real blocker is foreground permission. */
    NOT_APPLICABLE_FOREGROUND_DENIED,
    /** ACCESS_BACKGROUND_LOCATION explicitly granted (API 29+) -- this app may receive location updates while not in the foreground. */
    GRANTED,
    /** Foreground permission IS granted, but ACCESS_BACKGROUND_LOCATION is not (API 29+). This is the concrete "BACKGROUND_NOT_GRANTED" signal NF-001 requires -- a real, live-requeried platform fact, not an inference. */
    NOT_GRANTED,
    /**
     * Below API 29, Android has no separate background-location
     * permission at all -- a foreground grant implicitly covers background
     * access too. This is the platform's own genuine answer for those
     * versions, not a gap in this adapter's knowledge, so it is reported
     * as its own distinct value rather than collapsed into [GRANTED] (which
     * would imply the user made an explicit background-specific choice
     * they never had the opportunity to make) or [NOT_GRANTED] (which
     * would falsely suggest background access is actually blocked).
     */
    IMPLICIT_VIA_FOREGROUND_PRE_Q,
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
 * A caller-facing SUMMARY of location usability, DERIVED entirely from
 * the real granular signals in [LocationCapabilitySnapshot] -- never an
 * independently-guessed classification. Exists so a caller (PCA-7) that
 * only needs a coarse "can I get a location right now" answer does not
 * have to re-derive this logic itself, while the granular fields remain
 * available for any caller that needs to know exactly WHY.
 */
enum class LocationCapabilityLevel {
    /** Foreground-capable, services on, at least one provider enabled -- a fresh fix can be expected. */
    USABLE,
    /** A real, attributable limitation exists (COARSE-only accuracy, a disabled provider, or background access unavailable) but a foreground fix is still obtainable. Inspect the individual snapshot fields for which. */
    LIMITED,
    /** No usable path to a location fix right now (permission denied outright, services disabled, or no provider enabled). */
    UNUSABLE,
}

/**
 * A full, honest snapshot of this device's location CAPABILITY -- every
 * field maps to a real, independently-observable Android API. Deliberately
 * does NOT collapse these into one boolean, and does NOT invent a state
 * Android cannot actually report.
 */
data class LocationCapabilitySnapshot(
    val permissionState: LocationPermissionState,
    val backgroundState: BackgroundLocationState,
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
) {
    /**
     * Pure derivation over this snapshot's own fields -- see
     * [LocationCapabilityLevel]'s doc for why this is safe (never adds
     * information the fields don't already contain).
     */
    val overallLevel: LocationCapabilityLevel
        get() = when {
            permissionState == LocationPermissionState.DENIED -> LocationCapabilityLevel.UNUSABLE
            servicesState == LocationServicesState.DISABLED -> LocationCapabilityLevel.UNUSABLE
            !providerAvailability.gpsProviderEnabled && !providerAvailability.networkProviderEnabled -> LocationCapabilityLevel.UNUSABLE
            permissionState == LocationPermissionState.COARSE_ONLY -> LocationCapabilityLevel.LIMITED
            !providerAvailability.gpsProviderEnabled || !providerAvailability.networkProviderEnabled -> LocationCapabilityLevel.LIMITED
            backgroundState == BackgroundLocationState.NOT_GRANTED -> LocationCapabilityLevel.LIMITED
            !backgroundExecutionUnrestricted -> LocationCapabilityLevel.LIMITED
            else -> LocationCapabilityLevel.USABLE
        }
}

/** A location sample, opaque to policy logic here -- reports what the platform reports, never interprets/geocodes/labels it (a later feature-phase, doc 16, concern). `accuracyMeters` is the platform-reported figure verbatim -- this module never estimates or upgrades a precision claim beyond what the fix itself reports. */
data class LocationSample(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val elapsedRealtimeMillis: Long,
)

/**
 * Adapter over the platform's location capability. This is the generic
 * capability foundation (permission/background/services/provider/
 * battery-restriction snapshot + last-known-location read) -- continuous
 * tracking, geofencing, and any location-history feature policy are
 * PCA-7 (Location and last-seen) scope, built on top of this contract.
 */
interface LocationCapabilitySource {
    /** Re-queries every underlying platform signal live -- never a cached flag, same anti-caching discipline as every other capability adapter in this package. */
    fun currentCapability(): LocationCapabilitySnapshot
    fun lastKnownLocation(): LocationSample?
}
