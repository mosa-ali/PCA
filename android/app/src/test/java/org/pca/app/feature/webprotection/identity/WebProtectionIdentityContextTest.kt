package org.pca.app.feature.webprotection.identity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.enrollment.PairingState
import org.pca.app.runtime.identity.PersistentDeviceIdentityProvider
import org.pca.app.storage.InMemoryFamilyStateStore
import org.pca.app.storage.LocalFamilyState

class WebProtectionIdentityContextTest {

    @Test
    fun `not enrolled reports TrustedFamilyContextUnavailable, never a blank identity`() {
        val familyStateStore = InMemoryFamilyStateStore()
        val provider = RealWebProtectionIdentityContextProvider(familyStateStore, PersistentDeviceIdentityProvider(familyStateStore))

        val identity = provider.current()

        assertEquals(WebProtectionIdentity.TrustedFamilyContextUnavailable, identity)
    }

    @Test
    fun `an enrolled device reports its real family and device id, never a fabricated one`() {
        val familyStateStore = InMemoryFamilyStateStore()
        familyStateStore.save(LocalFamilyState("family-42", "device-42", PairingState.PAIRED, trustSetEpoch = 1, keyEpoch = 1))
        val provider = RealWebProtectionIdentityContextProvider(familyStateStore, PersistentDeviceIdentityProvider(familyStateStore))

        val identity = provider.current()

        assertTrue(identity is WebProtectionIdentity.Trusted)
        val trusted = identity as WebProtectionIdentity.Trusted
        assertEquals("family-42", trusted.familyId)
        assertEquals("device-42", trusted.deviceId)
        assertEquals("device-42", trusted.profileId)
    }

    /**
     * Coordinator correction: `EnrollmentCoordinator.persistSuccess()` currently persists
     * `familyId = ""` as an explicitly documented placeholder -- a non-null [LocalFamilyState]
     * therefore does NOT by itself mean a trusted family identity exists. Reproduces exactly the
     * state a real, successfully-enrolled device is in today.
     */
    @Test
    fun `a persisted empty-string familyId (the current real enrollment placeholder) is never trusted authority`() {
        val familyStateStore = InMemoryFamilyStateStore()
        familyStateStore.save(LocalFamilyState(familyId = "", deviceId = "device-42", pairingState = PairingState.PAIRED, trustSetEpoch = 1, keyEpoch = 1))
        val provider = RealWebProtectionIdentityContextProvider(familyStateStore, PersistentDeviceIdentityProvider(familyStateStore))

        val identity = provider.current()

        assertEquals(WebProtectionIdentity.TrustedFamilyContextUnavailable, identity)
        assertTrue(identity !is WebProtectionIdentity.Trusted)
    }

    @Test
    fun `a whitespace-only familyId is never trusted authority`() {
        val familyStateStore = InMemoryFamilyStateStore()
        familyStateStore.save(LocalFamilyState(familyId = "   ", deviceId = "device-42", pairingState = PairingState.PAIRED, trustSetEpoch = 1, keyEpoch = 1))
        val provider = RealWebProtectionIdentityContextProvider(familyStateStore, PersistentDeviceIdentityProvider(familyStateStore))

        val identity = provider.current()

        assertEquals(WebProtectionIdentity.TrustedFamilyContextUnavailable, identity)
    }
}
