package org.pca.app.runtime.boot

import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
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
    fun `ordinary platform read failures resolve to Unknown`() {
        val source = AndroidBootInstanceSource { throw SecurityException("settings unavailable") }

        assertEquals(BootInstanceResult.Unknown, source.currentBootInstance())
    }

    @Test
    fun `fatal JVM errors propagate instead of being converted to Unknown`() {
        val fatal = AssertionError("fatal reader failure")
        val source = AndroidBootInstanceSource { throw fatal }

        assertEquals(fatal, assertThrows(AssertionError::class.java) { source.currentBootInstance() })
    }

    @Test
    fun `asNullableId converts Known to its id and Unknown to null`() {
        assertEquals("boot-7", BootInstanceResult.Known("boot-7").asNullableId())
        assertNull(BootInstanceResult.Unknown.asNullableId())
    }
}
