package org.pca.app.feature.wellbeing.delivery

import android.content.Context
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion

/**
 * Resolves a [WellbeingSuggestion.messageId] to display text using the existing Android
 * string-resource/locale mechanism (PCA-WELL-021: no hardcoded UI strings, EN via
 * `res/values/strings.xml`, AR via `res/values-ar/strings.xml`, RTL handled by the standard
 * resource-qualifier + layout-direction system doc 20 already establishes for the rest of the
 * app). Custom (parent-authored) suggestions carry their literal sanitized text as a
 * `custom_raw:` prefixed surrogate instead of a resource name; those are displayed as-is, tagged
 * with their own `languageTag` rather than resolved through the app's current locale.
 */
class WellbeingMessageResolver(private val context: Context) {

    fun resolve(suggestion: WellbeingSuggestion): String {
        if (suggestion.messageId.startsWith(CUSTOM_PREFIX)) {
            return suggestion.messageId.substring(CUSTOM_PREFIX.length)
        }
        val resId = context.resources.getIdentifier(suggestion.messageId, "string", context.packageName)
        return if (resId != 0) context.getString(resId) else suggestion.messageId
    }

    private companion object {
        const val CUSTOM_PREFIX = "custom_raw:"
    }
}
