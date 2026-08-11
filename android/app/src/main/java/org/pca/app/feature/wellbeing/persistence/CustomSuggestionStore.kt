package org.pca.app.feature.wellbeing.persistence

import org.pca.app.feature.wellbeing.model.CustomSuggestionReviewState
import org.pca.app.feature.wellbeing.model.DurationBucket
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion
import org.pca.app.feature.wellbeing.security.CustomSuggestionSanitizer
import org.pca.app.foundation.PersistentStateStore
import java.util.UUID

/**
 * Local storage for parent-authored custom suggestions (PCA-WELL-018). Text is sanitized on
 * intake ([CustomSuggestionSanitizer]) and stored only locally in this store; syncing it to other
 * family devices is expected to ride the Family Envelope/FTS transport (doc 09/11) at the
 * Coordinator integration layer -- this store never opens a second transport itself. Every entry
 * starts life `DEFERRED_PENDING_CONTENT_SAFETY_REVIEW` and is never auto-selectable by the engine
 * until a reviewer marks it `APPROVED`.
 */
class CustomSuggestionStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    data class Entry(
        val suggestion: WellbeingSuggestion,
        val reviewState: CustomSuggestionReviewState,
    )

    sealed interface AddResult {
        data class Added(val entry: Entry) : AddResult
        data class Rejected(val reason: String) : AddResult
    }

    fun add(
        rawText: String,
        category: WellbeingCategory,
        duration: DurationBucket,
        languageTag: String,
    ): AddResult {
        val sanitized = CustomSuggestionSanitizer.sanitize(rawText)
        if (sanitized is CustomSuggestionSanitizer.Result.Rejected) {
            return AddResult.Rejected(sanitized.reason)
        }
        val text = (sanitized as CustomSuggestionSanitizer.Result.Accepted).sanitizedText
        val id = "custom.${UUID.randomUUID()}"
        val suggestion = WellbeingSuggestion(
            suggestionId = id,
            // Custom suggestions carry their sanitized literal text as the "messageId" surrogate
            // since there is no shipped string-resource entry for parent-authored content; the UI
            // layer resolves this case by displaying the stored raw text directly, never treating
            // it as a resource name (see WellbeingMessageResolver).
            messageId = "custom_raw:$text",
            category = category,
            duration = duration,
            lockScreenSafe = false,
            requiresAdultSupervision = false,
            enabledByDefault = true,
            version = 1,
            isCustom = true,
            languageTag = languageTag,
        )
        val entry = Entry(suggestion, CustomSuggestionReviewState.DEFERRED_PENDING_CONTENT_SAFETY_REVIEW)
        save(loadAll() + entry)
        return AddResult.Added(entry)
    }

    fun approvedSuggestions(): List<WellbeingSuggestion> =
        loadAll().filter { it.reviewState == CustomSuggestionReviewState.APPROVED }.map { it.suggestion }

    fun loadAll(): List<Entry> = store.getString(key)?.let { decode(it) } ?: emptyList()

    fun setReviewState(suggestionId: String, state: CustomSuggestionReviewState) {
        val updated = loadAll().map { if (it.suggestion.suggestionId == suggestionId) it.copy(reviewState = state) else it }
        save(updated)
    }

    fun clear() {
        store.remove(key)
    }

    private fun save(entries: List<Entry>) {
        store.putString(key, encode(entries))
    }

    private fun encode(entries: List<Entry>): String = entries.joinToString(ENTRY_SEP) { e ->
        listOf(
            e.suggestion.suggestionId,
            e.suggestion.category.name,
            e.suggestion.duration.name,
            e.suggestion.languageTag,
            e.reviewState.name,
            e.suggestion.messageId.removePrefix("custom_raw:"),
        ).joinToString(FIELD_SEP)
    }

    private fun decode(raw: String): List<Entry> = raw.split(ENTRY_SEP)
        .filter { it.isNotEmpty() }
        .mapNotNull { line ->
            val parts = line.split(FIELD_SEP, limit = FIELD_COUNT)
            if (parts.size != FIELD_COUNT) return@mapNotNull null
            try {
                Entry(
                    suggestion = WellbeingSuggestion(
                        suggestionId = parts[0],
                        messageId = "custom_raw:${parts[5]}",
                        category = WellbeingCategory.valueOf(parts[1]),
                        duration = DurationBucket.valueOf(parts[2]),
                        lockScreenSafe = false,
                        requiresAdultSupervision = false,
                        enabledByDefault = true,
                        version = 1,
                        isCustom = true,
                        languageTag = parts[3],
                    ),
                    reviewState = CustomSuggestionReviewState.valueOf(parts[4]),
                )
            } catch (_: IllegalArgumentException) {
                null
            }
        }

    private companion object {
        const val KEY = "wellbeing_custom_suggestions_v1"
        // Control characters guaranteed absent from any sanitized custom-suggestion text --
        // CustomSuggestionSanitizer rejects the whole U+0000-U+0008 range -- so these remain
        // safe delimiters even though the text field itself is arbitrary parent-authored input.
        const val ENTRY_SEP = ""
        const val FIELD_SEP = ""
        const val FIELD_COUNT = 6
    }
}
