package org.pca.app.feature.prayer.location

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import org.pca.app.foundation.PersistentStateStore

/**
 * PCA-FR-074A: remembers only an encrypted-local offline travel anchor and whether the
 * resulting notice was delivered. It never exports coordinates, and it never changes prayer
 * calculation policy; it only prevents cached times from being presented without a warning after
 * a materially large offline move.
 */
class PrayerLocationStalenessDetector(private val stateStore: PersistentStateStore) {
    /** Returns true when a notice should be surfaced for this offline travel episode. */
    fun shouldNotify(deviceId: String, latitude: Double, longitude: Double, isOnline: Boolean): Boolean {
        val key = keyFor(deviceId)
        val state = decode(stateStore.getString(key))
        if (isOnline) {
            stateStore.remove(key)
            return false
        }

        if (state == null) {
            stateStore.putString(key, encode(TravelState(latitude, longitude, false)))
            return false
        }
        val anchor = state.anchor
        if (state.noticeDelivered || distanceMeters(anchor.latitude, anchor.longitude, latitude, longitude) <= MATERIAL_TRAVEL_METERS) {
            return false
        }
        return true
    }

    /** Marks the notice as delivered; a later online observation starts a fresh episode. */
    fun markDelivered(deviceId: String) {
        val key = keyFor(deviceId)
        val state = decode(stateStore.getString(key)) ?: return
        stateStore.putString(key, encode(state.copy(noticeDelivered = true)))
    }

    private data class Anchor(val latitude: Double, val longitude: Double)
    private data class TravelState(val latitude: Double, val longitude: Double, val noticeDelivered: Boolean) {
        val anchor: Anchor get() = Anchor(latitude, longitude)
    }

    private fun encode(state: TravelState): String =
        "${state.latitude}|${state.longitude}|${if (state.noticeDelivered) 1 else 0}"

    private fun decode(raw: String?): TravelState? {
        val parts = raw?.split('|') ?: return null
        if (parts.size != 3) return null
        val latitude = parts[0].toDoubleOrNull() ?: return null
        val longitude = parts[1].toDoubleOrNull() ?: return null
        val delivered = when (parts[2]) {
            "0" -> false
            "1" -> true
            else -> return null
        }
        return TravelState(latitude, longitude, delivered)
    }

    private fun keyFor(deviceId: String): String = "$STATE_KEY_PREFIX$deviceId"

    companion object {
        const val MATERIAL_TRAVEL_METERS = 50_000.0
        private const val STATE_KEY_PREFIX = "pca_prayer_location_staleness_v1:"

        private fun distanceMeters(latitude1: Double, longitude1: Double, latitude2: Double, longitude2: Double): Double {
            val earthRadiusMeters = 6_371_000.0
            val latitudeDelta = Math.toRadians(latitude2 - latitude1)
            val longitudeDelta = Math.toRadians(longitude2 - longitude1)
            val haversine = sin(latitudeDelta / 2) * sin(latitudeDelta / 2) +
                cos(Math.toRadians(latitude1)) * cos(Math.toRadians(latitude2)) *
                sin(longitudeDelta / 2) * sin(longitudeDelta / 2)
            return earthRadiusMeters * 2 * atan2(sqrt(haversine), sqrt(1 - haversine))
        }
    }
}
