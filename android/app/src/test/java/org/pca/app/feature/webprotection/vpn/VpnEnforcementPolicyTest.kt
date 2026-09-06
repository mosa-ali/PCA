package org.pca.app.feature.webprotection.vpn

import org.junit.Assert.assertFalse
import org.junit.Test

class VpnEnforcementPolicyTest {

    @Test
    fun `defaultVpnEnforcementPolicy is always dormant (ownerApproved = false)`() {
        assertFalse(defaultVpnEnforcementPolicy().ownerApproved)
    }

    @Test
    fun `VpnEnforcementPolicy's own default constructor value is also dormant`() {
        // Confirms the data class's own parameter default matches
        // defaultVpnEnforcementPolicy() -- the two are not allowed to drift
        // apart into two different "safe defaults".
        assertFalse(VpnEnforcementPolicy().ownerApproved)
    }
}
