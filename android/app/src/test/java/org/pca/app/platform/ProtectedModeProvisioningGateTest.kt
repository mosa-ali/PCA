package org.pca.app.platform

import org.junit.Assert.assertEquals
import org.junit.Test

class ProtectedModeProvisioningGateTest {
    @Test
    fun `baseline gate always reports PENDING_OWNER_DECISION -- PCA-DEC-002-014-015 remain unresolved`() {
        val gate = UnresolvedProtectedModeProvisioningGate()
        assertEquals(ProtectedModeFeasibility.PENDING_OWNER_DECISION, gate.feasibility())
    }
}
