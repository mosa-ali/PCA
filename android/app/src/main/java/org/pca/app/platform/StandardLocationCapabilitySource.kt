package org.pca.app.platform

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * Standard Mode / general implementation using the platform LocationManager
 * directly (no Play Services / FusedLocationProvider dependency, keeping
 * this foundation layer dependency-light -- PCA-7 may layer a
 * higher-accuracy provider on top of this contract later without this
 * interface needing to change).
 */
class StandardLocationCapabilitySource(private val context: Context) : LocationCapabilitySource {

    override fun currentCapability(): LocationCapabilitySnapshot = LocationCapabilitySnapshot(
        permissionState = permissionState(),
        servicesState = servicesState(),
        providerAvailability = providerAvailability(),
        backgroundExecutionUnrestricted = backgroundExecutionUnrestricted(),
    )

    private fun permissionState(): LocationPermissionState = when {
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ->
            LocationPermissionState.FINE
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ->
            LocationPermissionState.COARSE_ONLY
        else -> LocationPermissionState.DENIED
    }

    private fun servicesState(): LocationServicesState {
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return LocationServicesState.DISABLED
        val enabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            locationManager.isLocationEnabled
        } else {
            @Suppress("DEPRECATION")
            Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_OFF) != Settings.Secure.LOCATION_MODE_OFF
        }
        return if (enabled) LocationServicesState.ENABLED else LocationServicesState.DISABLED
    }

    private fun providerAvailability(): LocationProviderAvailability {
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return LocationProviderAvailability(gpsProviderEnabled = false, networkProviderEnabled = false)
        return LocationProviderAvailability(
            gpsProviderEnabled = isProviderEnabledSafely(locationManager, LocationManager.GPS_PROVIDER),
            networkProviderEnabled = isProviderEnabledSafely(locationManager, LocationManager.NETWORK_PROVIDER),
        )
    }

    private fun isProviderEnabledSafely(locationManager: LocationManager, provider: String): Boolean = try {
        locationManager.isProviderEnabled(provider)
    } catch (_: IllegalArgumentException) {
        // Thrown if the named provider does not exist on this device at all
        // (e.g. no GPS hardware) -- structurally distinct from "exists but
        // disabled," but this adapter reports both as unavailable since
        // this interface only distinguishes usable vs not.
        false
    }

    private fun backgroundExecutionUnrestricted(): Boolean {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            powerManager.isIgnoringBatteryOptimizations(context.packageName)
        } else {
            // Battery optimization / Doze did not exist before API 23 --
            // there is nothing to be restricted BY, so this is honestly
            // "unrestricted" on those platform versions, not an unknown.
            true
        }
    }

    override fun lastKnownLocation(): LocationSample? {
        if (permissionState() == LocationPermissionState.DENIED) return null
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
        val nowElapsed = SystemClock.elapsedRealtime()
        var best: android.location.Location? = null
        for (provider in locationManager.allProviders) {
            @Suppress("MissingPermission") // guarded by the permissionState() check above
            val candidate = try {
                locationManager.getLastKnownLocation(provider)
            } catch (_: SecurityException) {
                null
            } ?: continue
            if (best == null || candidate.time > best.time) best = candidate
        }
        val location = best ?: return null
        val elapsedAtFix = nowElapsed - (System.currentTimeMillis() - location.time)
        return LocationSample(
            latitude = location.latitude,
            longitude = location.longitude,
            accuracyMeters = location.accuracy,
            elapsedRealtimeMillis = elapsedAtFix,
        )
    }
}
