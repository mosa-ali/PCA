package org.pca.app.runtime.boot

import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class BootInstanceSourceTest {

    @Test
    fun `known boot count is reported as Known with the value stringified`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 101)

        val result = AndroidBootInstanceSource(context).currentBootInstance()

        assertEquals(BootInstanceResult.Known("101"), result)
    }

    @Test
    fun `a real device reboot changes the reported boot instance`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 100)
        val source = AndroidBootInstanceSource(context)
        val beforeReboot = source.currentBootInstance()

        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 101)
        val afterReboot = source.currentBootInstance()

        assert(beforeReboot != afterReboot)
        assertEquals(BootInstanceResult.Known("100"), beforeReboot)
        assertEquals(BootInstanceResult.Known("101"), afterReboot)
    }

    @Test
    fun `an ordinary process restart with no reboot reports the identical boot instance`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 42)

        // Two independent source instances, simulating two separate process lifetimes reading
        // the same persisted platform setting -- this is the "process restart, same boot" case.
        val first = AndroidBootInstanceSource(context).currentBootInstance()
        val second = AndroidBootInstanceSource(context).currentBootInstance()

        assertEquals(first, second)
    }

    @Test
    fun `reading boot state never throws -- always resolves to one of the two well-defined outcomes`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        // BOOT_COUNT is not written in this test; on this JVM/Robolectric environment the read
        // may or may not succeed with a default -- the contract under test is that
        // currentBootInstance() never lets an exception escape and never fabricates a value it
        // cannot back up, only ever returning Known(realValue) or Unknown.
        val result = AndroidBootInstanceSource(context).currentBootInstance()

        when (result) {
            is BootInstanceResult.Known -> assert(result.bootInstanceId.isNotBlank())
            BootInstanceResult.Unknown -> Unit
        }
    }

    @Test
    fun `asNullableId converts Known to its id and Unknown to null`() {
        assertEquals("boot-7", BootInstanceResult.Known("boot-7").asNullableId())
        assertNull(BootInstanceResult.Unknown.asNullableId())
    }
}
