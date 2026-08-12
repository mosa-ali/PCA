package org.pca.app.feature.wellbeing.policy

import kotlin.time.Duration.Companion.minutes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy

class ParentPolicyToAndroidPolicyAdapterTest {

    private fun customMessage(minInterval: Int, maxPerDay: Int, repeatCooldown: Int) = SdkCustomWellbeingMessage(
        messageId = "m",
        enabled = true,
        category = SdkWellbeingCategory.READING,
        languageTexts = mapOf("en" to SdkLanguageText("t", "b")),
        schedule = SdkScheduleWindow(),
        delivery = SdkDeliveryPolicy(
            triggers = setOf(SdkWellbeingTrigger.PERIODIC),
            minimumIntervalMinutes = minInterval,
            maximumPerDay = maxPerDay,
            repeatCooldownMinutes = repeatCooldown,
            lockScreenAllowed = false,
        ),
        target = SdkTargetScope(SdkTargetMode.ALL_CHILDREN),
    )

    private fun policy(vararg messages: SdkCustomWellbeingMessage, enabled: Boolean = true) = ParentWellbeingPolicyV1(
        policyId = "f", policyRevision = 1, familyScopeRef = "s",
        targets = SdkTargetScope(SdkTargetMode.ALL_CHILDREN), enabled = enabled,
        customMessages = messages.toList(),
    )

    @Test
    fun `curatedEntriesFor excludes only explicitly disabled suggestions`() {
        val someId = WellbeingContentCatalogue.entries.first().suggestionId
        val parentPolicy = policy().copy(selectedCuratedSuggestionIds = listOf(SdkCuratedSuggestionSelection(someId, false)))
        val entries = ParentPolicyToAndroidPolicyAdapter.curatedEntriesFor(parentPolicy)
        assertFalse(entries.any { it.suggestionId == someId })
        assertEquals(WellbeingContentCatalogue.entries.size - 1, entries.size)
    }

    @Test
    fun `derivePolicy carries through the master enabled flag`() {
        val base = WellbeingNudgePolicy(enabled = true)
        val derived = ParentPolicyToAndroidPolicyAdapter.derivePolicy(base, policy(enabled = false))
        assertFalse(derived.enabled)
    }

    @Test
    fun `derivePolicy with no custom messages leaves frequency knobs untouched`() {
        val base = WellbeingNudgePolicy(minimumInterval = 20.minutes, maximumDailyNudges = 6)
        val derived = ParentPolicyToAndroidPolicyAdapter.derivePolicy(base, policy())
        assertEquals(base.minimumInterval, derived.minimumInterval)
        assertEquals(base.maximumDailyNudges, derived.maximumDailyNudges)
    }

    @Test
    fun `derivePolicy folds frequency using the most-conservative value across all custom messages`() {
        val base = WellbeingNudgePolicy(minimumInterval = 10.minutes, maximumDailyNudges = 8, sameSuggestionRepeatCooldown = 20.minutes)
        val strict = customMessage(minInterval = 30, maxPerDay = 2, repeatCooldown = 60)
        val loose = customMessage(minInterval = 15, maxPerDay = 5, repeatCooldown = 25)

        val derived = ParentPolicyToAndroidPolicyAdapter.derivePolicy(base, policy(strict, loose))

        // minimumInterval: max(base=10, 30, 15) = 30
        assertEquals(30.minutes, derived.minimumInterval)
        // maximumDailyNudges: min(base=8, 2, 5) = 2
        assertEquals(2, derived.maximumDailyNudges)
        // sameSuggestionRepeatCooldown: max(base=20, 60, 25) = 60
        assertEquals(60.minutes, derived.sameSuggestionRepeatCooldown)
    }

    @Test
    fun `archived or disabled custom messages are excluded from the frequency fold`() {
        val base = WellbeingNudgePolicy(minimumInterval = 10.minutes)
        val archived = customMessage(minInterval = 999, maxPerDay = 1, repeatCooldown = 999).copy(archivedAt = "2026-01-01T00:00:00Z")
        val disabled = customMessage(minInterval = 999, maxPerDay = 1, repeatCooldown = 999).copy(enabled = false)

        val derived = ParentPolicyToAndroidPolicyAdapter.derivePolicy(base, policy(archived, disabled))
        assertEquals(base.minimumInterval, derived.minimumInterval)
    }

    @Test
    fun `derived frequency never relaxes the base policy, only tightens it`() {
        val base = WellbeingNudgePolicy(minimumInterval = 60.minutes, maximumDailyNudges = 1)
        val looser = customMessage(minInterval = 5, maxPerDay = 12, repeatCooldown = 15)
        val derived = ParentPolicyToAndroidPolicyAdapter.derivePolicy(base, policy(looser))

        assertTrue(derived.minimumInterval >= base.minimumInterval)
        assertTrue(derived.maximumDailyNudges <= base.maximumDailyNudges)
    }
}
