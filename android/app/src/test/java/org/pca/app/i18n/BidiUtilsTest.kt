package org.pca.app.i18n

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BidiUtilsTest {
    @Test
    fun `isolateLtr wraps a token in FSI and PDI, never an override`() {
        val isolated = BidiUtils.isolateLtr("example.com")
        assertEquals("⁦example.com⁩", isolated)
        assertFalse(isolated.contains('‭')) // LRO
        assertFalse(isolated.contains('‮')) // RLO
    }

    @Test
    fun `isolateLtr round-trips an email address unchanged aside from the wrapping isolates`() {
        val email = "parent@example.com"
        assertEquals("⁦$email⁩", BidiUtils.isolateLtr(email))
    }

    @Test
    fun `sanitizeBidiControls strips a hostile RLO override character`() {
        val hostile = "safe‮dnuoccadesab-fdp.exe" // classic RLO filename-spoofing pattern
        val sanitized = BidiUtils.sanitizeBidiControls(hostile)
        assertFalse(sanitized.contains('‮'))
        assertEquals("safednuoccadesab-fdp.exe", sanitized)
    }

    @Test
    fun `sanitizeBidiControls strips every known bidi control character`() {
        val allControls = "‎‏‪‫‬‭‮⁦⁧⁨⁩"
        val sanitized = BidiUtils.sanitizeBidiControls("a${allControls}b")
        assertEquals("ab", sanitized)
    }

    @Test
    fun `sanitizeBidiControls preserves ordinary Arabic and Latin text untouched`() {
        val text = "تم حظر example.com في 2026-08-10"
        assertEquals(text, BidiUtils.sanitizeBidiControls(text))
    }

    @Test
    fun `sanitize then isolate is safe for a hostile user-supplied name embedded in an Arabic sentence`() {
        val hostileName = "Ali‮evil"
        val safeName = BidiUtils.sanitizeBidiControls(hostileName)
        val embedded = "الاسم: ${BidiUtils.isolateLtr(safeName)}"
        assertFalse(embedded.contains('‮'))
        assertTrue(embedded.contains(safeName))
    }
}
