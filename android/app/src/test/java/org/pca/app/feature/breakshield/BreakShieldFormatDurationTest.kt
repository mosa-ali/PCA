package org.pca.app.feature.breakshield

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * doc 20 Section 4: locale-aware digit presentation must not change the underlying duration
 * value -- only how it is rendered. Both assertions below derive from the SAME `Duration` input;
 * only the rendering locale differs.
 */
class BreakShieldFormatDurationTest {
    @Test
    fun `English locale renders Western (Latin) digits`() {
        assertEquals("18:30", formatDuration(18.minutes + 30.seconds, Locale.ENGLISH))
    }

    @Test
    fun `Arabic locale renders Arabic-Indic digits for the same underlying duration`() {
        val arabic = Locale.forLanguageTag("ar")
        // ١٨:٣٠ -- Arabic-Indic digits for 18:30, produced by java.util.Formatter honoring the
        // locale's own DecimalFormatSymbols zero-digit, not a hand-built lookup table.
        assertEquals("١٨:٣٠", formatDuration(18.minutes + 30.seconds, arabic))
    }

    @Test
    fun `seconds and minutes are always two digits, zero-padded`() {
        assertEquals("00:05", formatDuration(5.seconds, Locale.ENGLISH))
        assertEquals("05:00", formatDuration(5.minutes, Locale.ENGLISH))
    }

    @Test
    fun `a negative-clamped duration never renders a negative or malformed string`() {
        assertEquals("00:00", formatDuration((-5).seconds, Locale.ENGLISH))
    }
}
