package org.pca.app.platform

import android.content.Context
import android.os.PowerManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * PCA-NFR-034: proves [StandardPowerSaveModeSource] reads the REAL, documented
 * `PowerManager.isPowerSaveMode` signal (via Robolectric's [org.robolectric.shadows.ShadowPowerManager],
 * not a hand-rolled fake), in both directions -- see [PowerSaveModeSource]'s own doc comment for
 * why this is the one signal this app's non-safety-critical background work backs off on.
 */
@RunWith(RobolectricTestRunner::class)
class StandardPowerSaveModeSourceTest {

    @Test
    fun `reports false when the OS is not in power-save mode`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        shadowOf(powerManager).setIsPowerSaveMode(false)

        val source = StandardPowerSaveModeSource(context)

        assertFalse(source.isPowerSaveMode())
    }

    @Test
    fun `reports true when the OS reports Battery Saver active`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        shadowOf(powerManager).setIsPowerSaveMode(true)

        val source = StandardPowerSaveModeSource(context)

        assertTrue(source.isPowerSaveMode())
    }
}
