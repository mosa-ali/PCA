package org.pca.app.platform

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.SystemClock
import androidx.core.content.ContextCompat

/**
 * Standard Mode / general implementation using the platform LocationManager
 * directly (no Play Services / FusedLocationProvider dependency, keeping
 * this foundation layer dependency-light -- PCA-7 may layer a
 * higher-accuracy provider on top of this contract later without this
 * interface needing to change).
 */
class StandardLocationCapabilitySource(private val context: Context) : LocationCapabilitySource {

    override fun isPermissionGranted(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun lastKnownLocation(): LocationSample? {
        if (!isPermissionGranted()) return null
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
        val nowElapsed = SystemClock.elapsedRealtime()
        var best: android.location.Location? = null
        for (provider in locationManager.allProviders) {
            @Suppress("MissingPermission") // guarded by isPermissionGranted() above
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
