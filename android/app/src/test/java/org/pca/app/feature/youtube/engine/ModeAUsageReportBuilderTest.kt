package org.pca.app.feature.youtube.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.youtube.policy.UsageCapabilityStatus
import org.pca.app.feature.youtube.policy.UsageSource

class ModeAUsageReportBuilderTest {

    @Test
    fun `aggregate duration is reported honestly as app usage only, labeled and non-negative`() {
        val builder = ModeAUsageReportBuilder(now = { 5_000L })

        val evidence = builder.buildEvidence(
            familyId = "family-1",
            profileId = "profile-1",
            source = UsageSource.ANDROID_USAGE_STATS,
            capabilityStatus = UsageCapabilityStatus.GRANTED,
            durationMs = 45 * 60_000L,
        )

        assertEquals(45 * 60_000L, evidence.durationMs)
        assertEquals("app usage only", evidence.label)
        assertEquals(false, evidence.coverageGap)
        assertEquals(5_000L, evidence.observedAtEpochMillis)
    }

    @Test
    fun `missing evidence is never displayed as zero use -- null duration sets a coverage gap`() {
        val builder = ModeAUsageReportBuilder()

        val evidence = builder.buildEvidence("family-1", "profile-1", UsageSource.UNAVAILABLE, UsageCapabilityStatus.REVOKED, durationMs = null)

        assertEquals(null, evidence.durationMs)
        assertTrue(evidence.coverageGap)
    }

    @Test(expected = ModeAError.DurationWithoutGrant::class)
    fun `a duration figure without GRANTED capability status is rejected`() {
        ModeAUsageReportBuilder().buildEvidence("family-1", "profile-1", UsageSource.ANDROID_USAGE_STATS, UsageCapabilityStatus.REVOKED, durationMs = 1000L)
    }

    @Test(expected = ModeAError.InvalidDuration::class)
    fun `a negative duration figure is rejected`() {
        ModeAUsageReportBuilder().buildEvidence("family-1", "profile-1", UsageSource.ANDROID_USAGE_STATS, UsageCapabilityStatus.GRANTED, durationMs = -1L)
    }

    @Test
    fun `evidence has no field of any kind for a video id, title, or watch list`() {
        // Structural proof, not just a runtime check: ModeAUsageEvidence's declared properties are
        // exactly familyId/profileId/source/capabilityStatus/durationMs/coverageGap/observedAtEpochMillis/label.
        val evidence = ModeAUsageReportBuilder().buildEvidence(
            "family-1", "profile-1", UsageSource.ANDROID_USAGE_STATS, UsageCapabilityStatus.GRANTED, durationMs = 1000L,
        )
        // Filters out compiler-injected synthetic fields (e.g. the Compose compiler plugin's
        // "$stable" stability marker, added project-wide) -- only real declared properties count.
        val propertyNames = evidence::class.java.declaredFields.map { it.name }.filterNot { it.startsWith("$") }.toSet()
        assertEquals(
            setOf("familyId", "profileId", "source", "capabilityStatus", "durationMs", "coverageGap", "observedAtEpochMillis"),
            propertyNames,
        )
    }
}
