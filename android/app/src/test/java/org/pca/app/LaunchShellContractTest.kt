package org.pca.app

import org.junit.Assert.assertEquals
import org.junit.Test

class LaunchShellContractTest {
    @Test
    fun `application id remains the inert shell identifier`() {
        assertEquals("org.pca.app", BuildConfig.APPLICATION_ID)
    }
}
