package org.pca.app.runtime.location.geofence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.enrollment.AgeUxTier
import org.pca.app.enrollment.InitialPolicyProfile
import org.pca.app.enrollment.PairingState
import org.pca.app.runtime.identity.DeviceIdentityProvider
import org.pca.app.runtime.identity.DeviceIdentityState
import org.pca.app.runtime.identity.PersistentDeviceIdentityProvider
import org.pca.app.storage.CorruptLocalFamilyStateException
import org.pca.app.storage.FamilyStateStore
import org.pca.app.storage.LocalFamilyState
import org.pca.app.storage.PersistentFamilyStateStore
import org.pca.app.foundation.InMemoryPersistentStateStore

class PersistentGeofenceStorageScopeProviderTest {
    private class MutableFamilyStore(var current: LocalFamilyState? = null) : FamilyStateStore {
        var corrupt = false
        override fun currentState(): LocalFamilyState? {
            if (corrupt) throw CorruptLocalFamilyStateException()
            return current
        }
        override fun save(state: LocalFamilyState) { current = state }
        override fun clear() { current = null }
    }

    private class FixedIdentity(var state: DeviceIdentityState) : DeviceIdentityProvider {
        override fun currentIdentity(): DeviceIdentityState = state
    }

    private fun family(status: PairingState = PairingState.PAIRED, familyId: String = "family-a", deviceId: String = "device-a") =
        LocalFamilyState(
            familyId = familyId,
            deviceId = deviceId,
            pairingState = status,
            trustSetEpoch = 1,
            keyEpoch = 1,
            ageUxTier = AgeUxTier.YOUNG_CHILD,
            initialPolicyProfile = InitialPolicyProfile.BALANCED,
        )

    @Test
    fun `only a current paired or active matching identity opens a storage scope`() {
        val familyStore = MutableFamilyStore(family())
        val identity = FixedIdentity(DeviceIdentityState.Enrolled("device-a"))
        val provider = PersistentGeofenceStorageScopeProvider(familyStore, identity)

        assertEquals(GeofenceStorageScope("family-a", "device-a"), provider())
        familyStore.current = family(status = PairingState.ACTIVE)
        assertEquals(GeofenceStorageScope("family-a", "device-a"), provider())

        familyStore.current = family(status = PairingState.PAIRING_PENDING)
        assertNull(provider())
        familyStore.current = family(status = PairingState.REVOKED)
        assertNull(provider())
    }

    @Test
    fun `missing corrupt blank and mismatched identity fail closed`() {
        val familyStore = MutableFamilyStore()
        val identity = FixedIdentity(DeviceIdentityState.NotEnrolled)
        val provider = PersistentGeofenceStorageScopeProvider(familyStore, identity)
        assertNull(provider())

        familyStore.current = family(familyId = " ")
        identity.state = DeviceIdentityState.Enrolled("device-a")
        assertNull(provider())

        familyStore.current = family()
        identity.state = DeviceIdentityState.Enrolled("different-device")
        assertNull(provider())

        identity.state = DeviceIdentityState.Unavailable
        assertNull(provider())

        familyStore.corrupt = true
        identity.state = DeviceIdentityState.Enrolled("device-a")
        assertNull(provider())
    }

    @Test
    fun `real persisted v2 identity and clear tombstone control scope without legacy resurrection`() {
        val backing = InMemoryPersistentStateStore()
        backing.putString("family_state_v1", "family-a|device-a|ACTIVE|1|1")
        val familyStore = PersistentFamilyStateStore(backing)
        val identity = PersistentDeviceIdentityProvider(familyStore)
        val provider = PersistentGeofenceStorageScopeProvider(familyStore, identity)

        // A valid legacy record remains readable during migration.
        assertEquals(GeofenceStorageScope("family-a", "device-a"), provider())

        // The versioned JSON record is the authority once saved.
        familyStore.save(family())
        assertEquals(GeofenceStorageScope("family-a", "device-a"), provider())
        assertTrue(backing.getString("family_state_v1.v2")!!.startsWith("{"))

        // Clear leaves the old v1 bytes in storage, but its v2 tombstone closes
        // the scope and prevents the legacy identity from being resurrected.
        familyStore.clear()
        assertNull(provider())
        assertEquals(DeviceIdentityState.NotEnrolled, identity.currentIdentity())
        assertEquals("family-a|device-a|ACTIVE|1|1", backing.getString("family_state_v1"))
    }

    @Test
    fun `corrupt v2 identity is unavailable even when a valid legacy row remains`() {
        val backing = InMemoryPersistentStateStore()
        backing.putString("family_state_v1", "family-a|device-a|ACTIVE|1|1")
        backing.putString("family_state_v1.v2", "{\"version\":2}")
        val familyStore = PersistentFamilyStateStore(backing)
        val identity = PersistentDeviceIdentityProvider(familyStore)
        val provider = PersistentGeofenceStorageScopeProvider(familyStore, identity)

        assertNull(provider())
        assertEquals(DeviceIdentityState.Unavailable, identity.currentIdentity())
    }
}
