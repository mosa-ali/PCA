package org.pca.app.feature.youtube.engine

import org.pca.app.feature.youtube.policy.ModeAUsageEvidence
import org.pca.app.feature.youtube.policy.OpaqueFamilyId
import org.pca.app.feature.youtube.policy.OpaqueProfileId
import org.pca.app.feature.youtube.policy.UsageCapabilityStatus
import org.pca.app.feature.youtube.policy.UsageSource

sealed class ModeAError(message: String) : Exception(message) {
    object InvalidDuration : ModeAError("durationMs must be a non-negative finite number when supplied.")
    object DurationWithoutGrant : ModeAError("A duration figure requires GRANTED capability status.")
}

/**
 * Mirrors `backend/src/youtube/ModeAUsageReportService.ts`'s
 * `buildEvidence` exactly. Deliberately accepts only an aggregate duration
 * figure (or none) -- there is no parameter anywhere on this method for a
 * video id, title, or per-item list, so this builder cannot be made to
 * fabricate an exact watched-video history even by a careless caller; the
 * Kotlin type system enforces doc 15's "must not fabricate an exact
 * watched-video list" at the call site, not just by convention.
 */
class ModeAUsageReportBuilder(private val now: () -> Long = { System.currentTimeMillis() }) {

    fun buildEvidence(
        familyId: OpaqueFamilyId,
        profileId: OpaqueProfileId,
        source: UsageSource,
        capabilityStatus: UsageCapabilityStatus,
        durationMs: Long?,
    ): ModeAUsageEvidence {
        if (durationMs != null && durationMs < 0) throw ModeAError.InvalidDuration
        if (durationMs != null && capabilityStatus != UsageCapabilityStatus.GRANTED) throw ModeAError.DurationWithoutGrant

        return ModeAUsageEvidence(
            familyId = familyId,
            profileId = profileId,
            source = source,
            capabilityStatus = capabilityStatus,
            durationMs = durationMs,
            coverageGap = capabilityStatus != UsageCapabilityStatus.GRANTED || durationMs == null,
            observedAtEpochMillis = now(),
        )
    }
}
