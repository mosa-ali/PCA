package org.pca.app.i18n

/**
 * doc 20 Section 3/6: "For mixed content, use bidi isolates ... around every LTR identifier,
 * URL, email, code, version, time-zone ID, number range, and technical error token in an Arabic
 * sentence; never use bidirectional overrides." This object is the ONLY place in the app that
 * inserts explicit Unicode bidi control characters -- callers must route embedded LTR tokens
 * (domains, emails, versions, timezone IDs) through [isolateLtr] rather than concatenating raw
 * text into a localized sentence themselves.
 */
object BidiUtils {
    /** U+2066 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE -- the modern Unicode UAX #9
     * isolate mechanism (not an embedding, and never an override). Wrapping an LTR token in FSI/PDI
     * lets the surrounding Arabic sentence's own direction resolve normally while the token itself
     * renders left-to-right regardless of context, and does not leak direction into what follows. */
    private const val FIRST_STRONG_ISOLATE = '⁦'
    private const val POP_DIRECTIONAL_ISOLATE = '⁩'

    fun isolateLtr(token: String): String = "$FIRST_STRONG_ISOLATE$token$POP_DIRECTIONAL_ISOLATE"

    /**
     * doc 20 Section 6: "Hostile bidi control characters must be safely handled in display/
     * logging." Strips every Unicode bidi CONTROL character (isolates, embeddings, and the
     * explicit override controls RLO/LRO) from arbitrary/untrusted text -- e.g. a child's
     * entered name or a URL -- before it is interpolated into a rendered sentence or written to a
     * log. This is a defensive removal, never a bidi override of our own: PCA's own isolation
     * (isolateLtr) is applied AFTER this sanitization, on already-safe text.
     */
    fun sanitizeBidiControls(text: String): String {
        val builder = StringBuilder(text.length)
        for (ch in text) {
            if (!isBidiControlCharacter(ch)) builder.append(ch)
        }
        return builder.toString()
    }

    private fun isBidiControlCharacter(ch: Char): Boolean =
        when (ch.code) {
            0x200E, // LEFT-TO-RIGHT MARK
            0x200F, // RIGHT-TO-LEFT MARK
            0x202A, // LEFT-TO-RIGHT EMBEDDING
            0x202B, // RIGHT-TO-LEFT EMBEDDING
            0x202C, // POP DIRECTIONAL FORMATTING
            0x202D, // LEFT-TO-RIGHT OVERRIDE
            0x202E, // RIGHT-TO-LEFT OVERRIDE
            0x2066, // LEFT-TO-RIGHT ISOLATE
            0x2067, // RIGHT-TO-LEFT ISOLATE
            0x2068, // FIRST STRONG ISOLATE
            0x2069, // POP DIRECTIONAL ISOLATE
            -> true
            else -> false
        }
}
