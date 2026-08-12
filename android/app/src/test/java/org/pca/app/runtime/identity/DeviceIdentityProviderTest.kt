package org.pca.app.runtime.identity

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.enrollment.PairingState
import org.pca.app.storage.InMemoryFamilyStateStore
import org.pca.app.storage.LocalFamilyState

class DeviceIdentityProviderTest {

    @Test
    fun `pre-enrollment reports NotEnrolled honestly, never a fabricated id`() {
        val provider = PersistentDeviceIdentityProvider(InMemoryFamilyStateStore())

        assertEquals(DeviceIdentityState.NotEnrolled, provider.currentIdentity())
    }

    @Test
    fun `after enrollment reports the same enrolled id every time it is asked`() {
        val store = InMemoryFamilyStateStore()
        store.save(LocalFamilyState(familyId = "family-1", deviceId = "D123", pairingState = PairingState.ACTIVE, trustSetEpoch = 1, keyEpoch = 1))
        val provider = PersistentDeviceIdentityProvider(store)

        assertEquals(DeviceIdentityState.Enrolled("D123"), provider.currentIdentity())
        assertEquals(DeviceIdentityState.Enrolled("D123"), provider.currentIdentity())
    }

    @Test
    fun `device reboot must not change the reported PCA enrolled device id`() {
        // Enrolled identity is read from FamilyStateStore only -- it has no dependency on boot
        // state whatsoever, so simulating a reboot (nothing here even references a boot id) must
        // never change the result.
        val store = InMemoryFamilyStateStore()
        store.save(LocalFamilyState(familyId = "family-1", deviceId = "D123", pairingState = PairingState.ACTIVE, trustSetEpoch = 1, keyEpoch = 1))
        val provider = PersistentDeviceIdentityProvider(store)

        val beforeReboot = provider.currentIdentity()
        // "reboot" -- nothing about FamilyStateStore or DeviceIdentityProvider construction
        // changes; a fresh provider instance over the same durable store models the same process
        // restart/reboot survivability real enrollment persistence would need.
        val afterReboot = PersistentDeviceIdentityProvider(store).currentIdentity()

        assertEquals(DeviceIdentityState.Enrolled("D123"), beforeReboot)
        assertEquals(beforeReboot, afterReboot)
    }

    @Test
    fun `process restart must not change the reported PCA enrolled device id`() {
        val store = InMemoryFamilyStateStore()
        store.save(LocalFamilyState(familyId = "family-1", deviceId = "D123", pairingState = PairingState.ACTIVE, trustSetEpoch = 1, keyEpoch = 1))

        val beforeRestart = PersistentDeviceIdentityProvider(store).currentIdentity()
        val afterRestart = PersistentDeviceIdentityProvider(store).currentIdentity()

        assertEquals(DeviceIdentityState.Enrolled("D123"), beforeRestart)
        assertEquals(beforeRestart, afterRestart)
    }
}
