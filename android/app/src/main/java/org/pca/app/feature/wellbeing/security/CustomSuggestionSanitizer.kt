package org.pca.app.feature.wellbeing.security

/**
 * Mechanical safety gate for parent-authored custom suggestions (PCA-WELL-018). This is
 * intentionally NOT a content-safety/child-appropriateness reviewer -- no on-device or cloud
 * classifier exists for that in this phase (PCA-WELL-015 forbids adding one here). It only
 * rejects structurally dangerous input (oversized text, control/bidi characters that could be
 * used to visually spoof the rendered text, HTML/script-like markup, and text patterns that
 * mimic a fake system warning). Anything that passes is still never auto-approved: the caller
 * must persist it as `CustomSuggestionReviewState.DEFERRED_PENDING_CONTENT_SAFETY_REVIEW`
 * (doc 35) rather than making it immediately selectable, since a real human/child-safety content
 * review is out of scope for this deterministic-rules-only phase.
 */
object CustomSuggestionSanitizer {

    const val MAX_LENGTH = 140

    private val CONTROL_OR_BIDI_CHARS = Regex(
        "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F" +
            "\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]",
    )
    private val HTML_OR_SCRIPT_LIKE = Regex("<[^>]*>|javascript:|on\\w+\\s*=", RegexOption.IGNORE_CASE)
    private val FAKE_SYSTEM_WARNING_PATTERNS = listOf(
        "system warning", "virus detected", "your device is infected", "update now or",
        "security alert", "you have been hacked", "call this number",
    )

    sealed interface Result {
        data class Accepted(val sanitizedText: String) : Result
        data class Rejected(val reason: String) : Result
    }

    fun sanitize(rawText: String): Result {
        val trimmed = rawText.trim()
        if (trimmed.isEmpty()) return Result.Rejected("empty")
        if (trimmed.length > MAX_LENGTH) return Result.Rejected("too_long")
        if (CONTROL_OR_BIDI_CHARS.containsMatchIn(trimmed)) return Result.Rejected("control_or_bidi_chars")
        if (HTML_OR_SCRIPT_LIKE.containsMatchIn(trimmed)) return Result.Rejected("html_or_script_like")
        val lower = trimmed.lowercase()
        if (FAKE_SYSTEM_WARNING_PATTERNS.any { lower.contains(it) }) return Result.Rejected("fake_system_warning_like")
        return Result.Accepted(trimmed)
    }
}
