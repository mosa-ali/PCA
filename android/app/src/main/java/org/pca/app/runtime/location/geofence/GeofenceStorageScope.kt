package org.pca.app.runtime.location.geofence

import java.util.Base64
import org.pca.app.enrollment.PairingState
import org.pca.app.runtime.identity.DeviceIdentityProvider
import org.pca.app.runtime.identity.DeviceIdentityState
import org.pca.app.storage.CorruptLocalFamilyStateException
import org.pca.app.storage.FamilyStateStore

/**
 * The only local storage namespace in which a Safe Zone policy and its
 * membership state may be read or written. Both identifiers must come from
 * the device's locally persisted enrollment projection, never from a policy
 * payload. This scopes local data; it does not refresh server status or
 * establish fresh revocation state.
 */
data class GeofenceStorageScope(
    val familyId: String,
    val deviceId: String,
) {
    fun isValid(): Boolean = TOKEN.matches(familyId) && TOKEN.matches(deviceId)

    internal fun keyPart(): String = listOf(familyId, deviceId).joinToString(":") { value ->
        Base64.getUrlEncoder().withoutPadding().encodeToString(value.toByteArray(Charsets.UTF_8))
    }

    internal fun zoneStoreKey(prefix: String): String = "$prefix:${keyPart()}"

    internal fun zoneStateStoreKey(prefix: String, zoneId: String): String =
        "$prefix:${keyPart()}:${Base64.getUrlEncoder().withoutPadding().encodeToString(zoneId.toByteArray(Charsets.UTF_8))}"

    private companion object {
        val TOKEN = Regex("^[A-Za-z0-9_-]{1,128}$")
    }
}

/** A point-in-time zone snapshot. The same scope is used for every state read/write in one tick. */
data class ScopedGeofenceZones(
    val scope: GeofenceStorageScope,
    val zones: List<GeofenceZone>,
)

/**
 * Production scope derived from the locally persisted family record and the
 * independent enrolled-device identity provider. Any locally persisted
 * status other than PAIRED or ACTIVE, or a missing, corrupt, blank, or
 * mismatched identity, never exposes stored Safe Zones. This provider does
 * not establish fresh server-side revocation status.
 */
class PersistentGeofenceStorageScopeProvider(
    private val familyStateStore: FamilyStateStore,
    private val deviceIdentityProvider: DeviceIdentityProvider,
) : () -> GeofenceStorageScope? {
    override fun invoke(): GeofenceStorageScope? {
        val family = try {
            familyStateStore.currentState()
        } catch (_: CorruptLocalFamilyStateException) {
            return null
        } catch (_: Exception) {
            return null
        } ?: return null

        if (family.familyId.isBlank() || family.deviceId.isBlank() ||
            family.pairingState != PairingState.PAIRED && family.pairingState != PairingState.ACTIVE
        ) return null

        val enrolledDeviceId = try {
            (deviceIdentityProvider.currentIdentity() as? DeviceIdentityState.Enrolled)?.deviceId
        } catch (_: Exception) {
            return null
        } ?: return null
        if (enrolledDeviceId != family.deviceId) return null

        return GeofenceStorageScope(family.familyId, enrolledDeviceId).takeIf { it.isValid() }
    }
}
