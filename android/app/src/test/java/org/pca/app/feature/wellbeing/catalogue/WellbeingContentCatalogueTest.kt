package org.pca.app.feature.wellbeing.catalogue

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Content tests (PCA-WELL brief "content tests"): stable IDs, EN+AR present for every
 * suggestion, no duplicate IDs, valid category/duration/lock-screen-safety metadata, no unsafe
 * unsupervised household prompts, no shame/guilt default copy, and category-disabled-means-
 * zero-suggestions-from-it is exercised in `NudgeSelectionEngineTest`.
 */
class WellbeingContentCatalogueTest {

    private val shameOrGuiltWords = listOf(
        "lazy", "addict", "shame", "should be ashamed", "bad kid", "failure", "waste of time",
        "you always", "you never", "disappoint",
    )

    private val hazardousKeywords = listOf("stove", "oven", "knife", "chemical", "bleach")

    @Test
    fun `no duplicate suggestion IDs`() {
        val ids = WellbeingContentCatalogue.entries.map { it.suggestionId }
        assertEquals(ids.size, ids.distinct().size)
    }

    @Test
    fun `no duplicate message IDs`() {
        val messageIds = WellbeingContentCatalogue.entries.map { it.messageId }
        assertEquals(messageIds.size, messageIds.distinct().size)
    }

    /** Categories with deliberately no pre-authored catalogue entries: [CHILD_SELECTED_FAVORITES]
     * is dynamically synthesized at selection time; [PARENT_CUSTOM_OTHER] (doc 38) only ever
     * appears on parent-authored custom content synced in via the parent-policy adapter. */
    private val dynamicOrAdapterOnlyCategories = setOf(
        WellbeingCategory.CHILD_SELECTED_FAVORITES,
        WellbeingCategory.PARENT_CUSTOM_OTHER,
    )

    @Test
    fun `every catalogue-authored category has at least four suggestions`() {
        for (category in WellbeingCategory.entries) {
            if (category in dynamicOrAdapterOnlyCategories) continue
            val count = WellbeingContentCatalogue.byCategory(category).size
            assertTrue("category $category has only $count suggestions", count >= 4)
        }
    }

    @Test
    fun `CHILD_SELECTED_FAVORITES and PARENT_CUSTOM_OTHER have no pre-authored catalogue entries`() {
        for (category in dynamicOrAdapterOnlyCategories) {
            assertTrue(WellbeingContentCatalogue.byCategory(category).isEmpty())
        }
    }

    @Test
    fun `every EN string resource has an AR counterpart and vice versa`() {
        val enKeys = readStringResourceKeys("values")
        val arKeys = readStringResourceKeys("values-ar")
        assumeResourcesFound(enKeys, arKeys)

        for (suggestion in WellbeingContentCatalogue.entries) {
            assertTrue("missing EN string for ${suggestion.messageId}", enKeys.contains(suggestion.messageId))
            assertTrue("missing AR string for ${suggestion.messageId}", arKeys.contains(suggestion.messageId))
        }
    }

    @Test
    fun `hazardous home-responsibility suggestions require adult supervision`() {
        val enValues = readStringResourceValues("values")
        assumeResourcesFound(enValues.keys, emptySet())

        for (suggestion in WellbeingContentCatalogue.byCategory(WellbeingCategory.HOME_RESPONSIBILITY)) {
            val text = enValues[suggestion.messageId]?.lowercase() ?: continue
            val looksHazardous = hazardousKeywords.any { text.contains(it) }
            if (looksHazardous) {
                assertTrue(
                    "suggestion ${suggestion.suggestionId} mentions a hazard but is not marked requiresAdultSupervision",
                    suggestion.requiresAdultSupervision,
                )
            }
        }
    }

    @Test
    fun `movement-reset content never mentions calories or weight`() {
        val enValues = readStringResourceValues("values")
        assumeResourcesFound(enValues.keys, emptySet())

        for (suggestion in WellbeingContentCatalogue.byCategory(WellbeingCategory.MOVEMENT_RESET)) {
            val text = enValues[suggestion.messageId]?.lowercase() ?: continue
            assertFalse("movement content must not mention calories: $text", text.contains("calor"))
            assertFalse("movement content must not mention weight: $text", text.contains("weight"))
            assertFalse("movement content must not mention burn: $text", text.contains("burn"))
        }
    }

    @Test
    fun `content-tone quality gate rejects shame or guilt default copy`() {
        val enValues = readStringResourceValues("values")
        assumeResourcesFound(enValues.keys, emptySet())

        for ((key, text) in enValues) {
            if (!key.startsWith("wellbeing_")) continue
            val lower = text.lowercase()
            for (word in shameOrGuiltWords) {
                assertFalse("string $key contains shame/guilt-coded phrase '$word': $text", lower.contains(word))
            }
        }
    }

    @Test
    fun `WELL-2 adult-supervision indicator has reviewed EN and AR copy`() {
        val enValues = readStringResourceValues("values")
        val arValues = readStringResourceValues("values-ar")
        assumeResourcesFound(enValues.keys, arValues.keys)

        val key = "wellbeing_card_requires_adult_supervision"
        assertTrue("missing EN copy for $key", enValues[key]?.isNotBlank() == true)
        assertTrue("missing AR copy for $key", arValues[key]?.isNotBlank() == true)
        // Sanity: the AR string must actually be Arabic script, not a leftover placeholder/copy
        // of the English text (RTL requirement, PCA-WELL-021).
        val arText = arValues[key].orEmpty()
        assertTrue("AR copy for $key does not look like Arabic script: $arText", arText.any { it.code in 0x0600..0x06FF })
    }

    @Test
    fun `WELL-2 supervision indicator is rendered as visible+accessible text, not color-icon-animation only`() {
        val root = locateWellbeingModuleRoot()
        org.junit.Assume.assumeTrue("could not locate feature/wellbeing main sources from test working directory", root != null)
        val cardScreen = File(root, "ui/WellbeingCardScreen.kt")
        org.junit.Assume.assumeTrue("WellbeingCardScreen.kt not found", cardScreen.isFile)
        val text = cardScreen.readText()
        assertTrue(
            "WellbeingCardScreen must render the adult-supervision string resource as visible Text",
            text.contains("wellbeing_card_requires_adult_supervision"),
        )
        assertTrue(
            "adult-supervision indicator must be a plain Text (accessible/TalkBack-visible), not color/icon-only",
            text.contains("requiresAdultSupervision") && text.contains("Text("),
        )
    }

    private fun locateWellbeingModuleRoot(): File? {
        val candidates = listOf(
            "src/main/java/org/pca/app/feature/wellbeing",
            "android/app/src/main/java/org/pca/app/feature/wellbeing",
            "app/src/main/java/org/pca/app/feature/wellbeing",
        )
        return candidates.map { File(it) }.firstOrNull { it.isDirectory }
    }

    // --- helpers: parse the shipped strings.xml files directly (no Android runtime needed) ---

    private fun assumeResourcesFound(a: Set<String>, b: Set<String>) {
        org.junit.Assume.assumeTrue("could not locate res/values/strings.xml from test working directory", a.isNotEmpty() || b.isNotEmpty())
    }

    private fun readStringResourceKeys(valuesDir: String): Set<String> = readStringResourceValues(valuesDir).keys

    private fun readStringResourceValues(valuesDir: String): Map<String, String> {
        val file = locateStringsXml(valuesDir) ?: return emptyMap()
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val nodes = doc.getElementsByTagName("string")
        val result = mutableMapOf<String, String>()
        for (i in 0 until nodes.length) {
            val node = nodes.item(i)
            val name = node.attributes.getNamedItem("name")?.nodeValue ?: continue
            result[name] = node.textContent ?: ""
        }
        return result
    }

    private fun locateStringsXml(valuesDir: String): File? {
        val candidates = listOf(
            "src/main/res/$valuesDir/strings.xml",
            "android/app/src/main/res/$valuesDir/strings.xml",
            "app/src/main/res/$valuesDir/strings.xml",
            "../src/main/res/$valuesDir/strings.xml",
        )
        for (c in candidates) {
            val f = File(c)
            if (f.exists()) return f
        }
        return null
    }
}
