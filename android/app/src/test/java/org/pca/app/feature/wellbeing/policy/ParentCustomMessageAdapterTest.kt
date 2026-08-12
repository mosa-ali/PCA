package org.pca.app.feature.wellbeing.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.model.DurationBucket
import org.pca.app.feature.wellbeing.model.NudgeTrigger
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import org.pca.app.feature.wellbeing.policy.ScheduleWindowEvaluator.WallClockSnapshot

class ParentCustomMessageAdapterTest {

    private val now = WallClockSnapshot("2026-08-12", "WED", 720)

    private fun message(
        category: SdkWellbeingCategory = SdkWellbeingCategory.FAMILY_HELP,
        enabled: Boolean = true,
        archivedAt: String? = null,
        languageTexts: Map<String, SdkLanguageText> = mapOf("en" to SdkLanguageText("Help fold laundry", "Ask if you can help with the laundry today.")),
        target: SdkTargetScope = SdkTargetScope(SdkTargetMode.ALL_CHILDREN),
        schedule: SdkScheduleWindow = SdkScheduleWindow(),
        requiresAdultSupervision: Boolean = false,
        lockScreenAllowed: Boolean = true,
    ) = SdkCustomWellbeingMessage(
        messageId = "msg-1",
        enabled = enabled,
        category = category,
        languageTexts = languageTexts,
        schedule = schedule,
        delivery = SdkDeliveryPolicy(
            triggers = setOf(SdkWellbeingTrigger.CHILD_REQUESTED_IDEA),
            minimumIntervalMinutes = 10,
            maximumPerDay = 4,
            repeatCooldownMinutes = 30,
            lockScreenAllowed = lockScreenAllowed,
            requiresAdultSupervision = requiresAdultSupervision,
        ),
        target = target,
        archivedAt = archivedAt,
    )

    @Test
    fun `produces a WellbeingSuggestion with mapped category and default short duration`() {
        val result = ParentCustomMessageAdapter.map(message(), "child-1", "en", now)
        val produced = result as ParentCustomMessageAdapter.MappingResult.Produced
        assertEquals(WellbeingCategory.FAMILY_HELP, produced.suggestion.category)
        assertEquals(DurationBucket.SHORT_2_5_MIN, produced.suggestion.duration)
        assertTrue(produced.suggestion.isCustom)
        assertEquals("en", produced.suggestion.languageTag)
    }

    @Test
    fun `EN device locale selects the EN variant text`() {
        val msg = message(languageTexts = mapOf(
            "en" to SdkLanguageText("English title", "English body"),
            "ar" to SdkLanguageText("عنوان عربي", "نص عربي"),
        ))
        val produced = ParentCustomMessageAdapter.map(msg, "child-1", "en", now) as ParentCustomMessageAdapter.MappingResult.Produced
        assertTrue(produced.suggestion.messageId.contains("English title"))
    }

    @Test
    fun `AR device locale selects the AR variant text`() {
        val msg = message(languageTexts = mapOf(
            "en" to SdkLanguageText("English title", "English body"),
            "ar" to SdkLanguageText("عنوان عربي", "نص عربي"),
        ))
        val produced = ParentCustomMessageAdapter.map(msg, "child-1", "ar", now) as ParentCustomMessageAdapter.MappingResult.Produced
        assertTrue(produced.suggestion.messageId.contains("عنوان عربي"))
    }

    @Test
    fun `no auto-translate fallback -- locale missing from languageTexts is simply not eligible`() {
        val msg = message(languageTexts = mapOf("en" to SdkLanguageText("English only", "Body")))
        val result = ParentCustomMessageAdapter.map(msg, "child-1", "ar", now)
        assertEquals(ParentCustomMessageAdapter.MappingResult.NotEligibleNow, result)
    }

    @Test
    fun `disabled message is not eligible`() {
        val result = ParentCustomMessageAdapter.map(message(enabled = false), "child-1", "en", now)
        assertEquals(ParentCustomMessageAdapter.MappingResult.NotEligibleNow, result)
    }

    @Test
    fun `archived message is not eligible`() {
        val result = ParentCustomMessageAdapter.map(message(archivedAt = "2026-08-01T00:00:00Z"), "child-1", "en", now)
        assertEquals(ParentCustomMessageAdapter.MappingResult.NotEligibleNow, result)
    }

    @Test
    fun `message targeted at a different child is not eligible for this child`() {
        val msg = message(target = SdkTargetScope(SdkTargetMode.ONE_CHILD, listOf("some-other-child")))
        val result = ParentCustomMessageAdapter.map(msg, "child-1", "en", now)
        assertEquals(ParentCustomMessageAdapter.MappingResult.NotEligibleNow, result)
    }

    @Test
    fun `message targeted at ALL_CHILDREN reaches any child`() {
        val msg = message(target = SdkTargetScope(SdkTargetMode.ALL_CHILDREN))
        val result = ParentCustomMessageAdapter.map(msg, "any-child-id", "en", now)
        assertTrue(result is ParentCustomMessageAdapter.MappingResult.Produced)
    }

    @Test
    fun `message outside its schedule window is not eligible right now`() {
        val msg = message(schedule = SdkScheduleWindow(daysOfWeek = setOf("SAT", "SUN")))
        val result = ParentCustomMessageAdapter.map(msg, "child-1", "en", now) // now is WED
        assertEquals(ParentCustomMessageAdapter.MappingResult.NotEligibleNow, result)
    }

    @Test
    fun `requiresAdultSupervision maps through and forces lockScreenSafe false regardless of lockScreenAllowed`() {
        val msg = message(requiresAdultSupervision = true, lockScreenAllowed = true)
        val produced = ParentCustomMessageAdapter.map(msg, "child-1", "en", now) as ParentCustomMessageAdapter.MappingResult.Produced
        assertTrue(produced.suggestion.requiresAdultSupervision)
        assertEquals(false, produced.suggestion.lockScreenSafe)
    }

    @Test
    fun `lockScreenAllowed true without adult supervision maps to lockScreenSafe true`() {
        val msg = message(requiresAdultSupervision = false, lockScreenAllowed = true)
        val produced = ParentCustomMessageAdapter.map(msg, "child-1", "en", now) as ParentCustomMessageAdapter.MappingResult.Produced
        assertTrue(produced.suggestion.lockScreenSafe)
    }

    @Test
    fun `movement content mentioning calories is rejected`() {
        val msg = message(
            category = SdkWellbeingCategory.MOVEMENT_RESET,
            languageTexts = mapOf("en" to SdkLanguageText("Burn calories", "Do jumping jacks to burn 100 calories.")),
        )
        val result = ParentCustomMessageAdapter.map(msg, "child-1", "en", now)
        assertTrue(result is ParentCustomMessageAdapter.MappingResult.Rejected)
    }

    @Test
    fun `movement content with punitive make-up-for-screen-time language is rejected`() {
        val msg = message(
            category = SdkWellbeingCategory.MOVEMENT_RESET,
            languageTexts = mapOf("en" to SdkLanguageText("Move time", "You must exercise to make up for screen time.")),
        )
        val result = ParentCustomMessageAdapter.map(msg, "child-1", "en", now)
        assertTrue(result is ParentCustomMessageAdapter.MappingResult.Rejected)
    }

    @Test
    fun `ordinary movement content is accepted`() {
        val msg = message(
            category = SdkWellbeingCategory.MOVEMENT_RESET,
            languageTexts = mapOf("en" to SdkLanguageText("Quick stretch", "Stand up and stretch for a couple of minutes.")),
        )
        val result = ParentCustomMessageAdapter.map(msg, "child-1", "en", now)
        assertTrue(result is ParentCustomMessageAdapter.MappingResult.Produced)
    }

    @Test
    fun `CUSTOM category maps to PARENT_CUSTOM_OTHER`() {
        val msg = message(category = SdkWellbeingCategory.CUSTOM)
        val produced = ParentCustomMessageAdapter.map(msg, "child-1", "en", now) as ParentCustomMessageAdapter.MappingResult.Produced
        assertEquals(WellbeingCategory.PARENT_CUSTOM_OTHER, produced.suggestion.category)
    }

    @Test
    fun `pool eligibleFor filters by trigger, target, locale, and schedule together`() {
        val forBreak = message(target = SdkTargetScope(SdkTargetMode.ONE_CHILD, listOf("child-1")))
            .copy(messageId = "break-msg", delivery = SdkDeliveryPolicy(
                triggers = setOf(SdkWellbeingTrigger.BREAK_STARTED),
                minimumIntervalMinutes = 5, maximumPerDay = 4, repeatCooldownMinutes = 15, lockScreenAllowed = false,
            ))
        val forIdea = message().copy(messageId = "idea-msg")

        val pool = ParentCustomMessagePool.eligibleFor(
            listOf(forBreak, forIdea),
            NudgeTrigger.CHILD_REQUESTED_IDEA,
            childProfileId = "child-1",
            deviceLocale = "en",
            now = now,
        )
        assertEquals(1, pool.size)
        assertTrue(pool.single().suggestionId.contains("idea-msg"))
    }
}
