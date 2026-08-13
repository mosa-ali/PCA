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
}
