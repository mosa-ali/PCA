package org.pca.app.platform

import android.app.AppOpsManager
import org.junit.Assert.assertEquals
import org.junit.Test

class MapAppOpsModeTest {
    @Test
    fun `MODE_ALLOWED maps to GRANTED`() {
        assertEquals(UsageAccessState.GRANTED, mapAppOpsMode(AppOpsManager.MODE_ALLOWED))
    }

    @Test
    fun `MODE_DEFAULT maps to NOT_CONFIGURED, distinct from an explicit denial`() {
        assertEquals(UsageAccessState.NOT_CONFIGURED, mapAppOpsMode(AppOpsManager.MODE_DEFAULT))
    }

    @Test
    fun `MODE_IGNORED maps to DENIED`() {
        assertEquals(UsageAccessState.DENIED, mapAppOpsMode(AppOpsManager.MODE_IGNORED))
    }

    @Test
    fun `MODE_ERRORED maps to DENIED`() {
        assertEquals(UsageAccessState.DENIED, mapAppOpsMode(AppOpsManager.MODE_ERRORED))
    }

    @Test
    fun `an unrecognized mode value falls closed to DENIED, never GRANTED`() {
        assertEquals(UsageAccessState.DENIED, mapAppOpsMode(-1))
        assertEquals(UsageAccessState.DENIED, mapAppOpsMode(999))
    }
}
