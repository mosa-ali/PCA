package org.pca.app.feature.wellbeing.security

import org.junit.Assert.assertTrue
import org.junit.Test

/** Security/abuse tests for parent-authored custom suggestion intake (PCA-WELL-018): malformed
 * content, oversized content, bidi control chars, HTML/script-like content, and fake-system-
 * warning text must all be rejected before ever reaching the store. */
class CustomSuggestionSanitizerTest {

    @Test
    fun `ordinary short text is accepted`() {
        val result = CustomSuggestionSanitizer.sanitize("Help water the garden together")
        assertTrue(result is CustomSuggestionSanitizer.Result.Accepted)
    }

    @Test
    fun `blank text is rejected`() {
        val result = CustomSuggestionSanitizer.sanitize("   ")
        assertTrue(result is CustomSuggestionSanitizer.Result.Rejected)
    }

    @Test
    fun `oversized text is rejected`() {
        val result = CustomSuggestionSanitizer.sanitize("x".repeat(CustomSuggestionSanitizer.MAX_LENGTH + 1))
        assertTrue(result is CustomSuggestionSanitizer.Result.Rejected)
    }

    @Test
    fun `bidi override characters are rejected`() {
        val withBidi = "Help clean " + "‮" + "up the room"
        val result = CustomSuggestionSanitizer.sanitize(withBidi)
        assertTrue(result is CustomSuggestionSanitizer.Result.Rejected)
    }

    @Test
    fun `control characters are rejected`() {
        val withControlChar = "Help with dinner" + "" + " tonight"
        val result = CustomSuggestionSanitizer.sanitize(withControlChar)
        assertTrue(result is CustomSuggestionSanitizer.Result.Rejected)
    }

    @Test
    fun `html-like markup is rejected`() {
        val result = CustomSuggestionSanitizer.sanitize("<script>alert(1)</script>")
        assertTrue(result is CustomSuggestionSanitizer.Result.Rejected)
    }

    @Test
    fun `javascript-like content is rejected`() {
        val result = CustomSuggestionSanitizer.sanitize("click javascript:doBad()")
        assertTrue(result is CustomSuggestionSanitizer.Result.Rejected)
    }

    @Test
    fun `fake system warning phrasing is rejected`() {
        val result = CustomSuggestionSanitizer.sanitize("SYSTEM WARNING your device is infected, call this number")
        assertTrue(result is CustomSuggestionSanitizer.Result.Rejected)
    }

    @Test
    fun `whitespace is trimmed on accept`() {
        val result = CustomSuggestionSanitizer.sanitize("  Read a story together  ") as CustomSuggestionSanitizer.Result.Accepted
        assertTrue(result.sanitizedText == "Read a story together")
    }
}
