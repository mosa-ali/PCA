package org.pca.app.feature.youtube.engine

import org.pca.app.feature.youtube.policy.ModeAUsageEvidence
import org.pca.app.feature.youtube.policy.OpaqueFamilyId
import org.pca.app.feature.youtube.policy.OpaqueProfileId
import org.pca.app.feature.youtube.policy.UsageCapabilityStatus
import org.pca.app.feature.youtube.policy.UsageSource
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.platform.UsageAccessState

/** The platform token PCA's existing usage-observation pipeline reports for the standard YouTube app. */
const val YOUTUBE_APP_PACKAGE_NAME = "com.google.android.youtube"

/**
 * The Android RUNTIME seam for doc 15 Mode A: connects the EXISTING,
 * already-accepted app-usage capability (`org.pca.app.platform.UsageObservationSource`
 * for live permission state, `org.pca.app.persistence.repository.UsageSessionRepository`
 * for the already-normalized/persisted `UsageSession` records -- both owned
 * and produced by the usage/location runtime lane, consumed here READ-ONLY)
 * to doc 15's Mode A contract, filtered to the YouTube app token only.
 *
 * This class NEVER reads anything beyond aggregate duration for the YouTube
 * package -- no per-session detail (title, video id, search query) is
 * requested from or exposed by [UsageSessionRepository] in the first place
 * (that repository's own [org.pca.app.persistence.repository.UsageSession]
 * shape has no such fields), so there is no finer-grained data available to
 * leak here even by mistake. The Kotlin type system on
 * [org.pca.app.feature.youtube.engine.ModeAUsageReportBuilder.buildEvidence]
 * enforces the rest (see that class's doc comment).
 */
class ModeAAndroidUsageAdapter(
    private val usageSessions: UsageSessionRepository,
    private val accessState: () -> UsageAccessState,
    private val builder: ModeAUsageReportBuilder = ModeAUsageReportBuilder(),
    private val packageName: String = YOUTUBE_APP_PACKAGE_NAME,
) {
    suspend fun buildEvidence(
        familyId: OpaqueFamilyId,
        profileId: OpaqueProfileId,
        deviceId: String,
    ): ModeAUsageEvidence {
        val capabilityStatus = toCapabilityStatus(accessState())

        val durationMs: Long? = if (capabilityStatus == UsageCapabilityStatus.GRANTED) {
            usageSessions.getForDevice(deviceId)
                .filter { it.appOrCategoryToken == packageName }
                .sumOf { it.durationMillis }
        } else {
            null // doc 5: missing evidence must never be displayed as zero use -- not even 0L when the capability isn't GRANTED
        }

        return builder.buildEvidence(
            familyId = familyId,
            profileId = profileId,
            source = if (capabilityStatus == UsageCapabilityStatus.UNSUPPORTED) UsageSource.UNAVAILABLE else UsageSource.ANDROID_USAGE_STATS,
            capabilityStatus = capabilityStatus,
            durationMs = durationMs,
        )
    }

    /**
     * [UsageAccessState] is Android's real, multi-valued AppOps snapshot;
     * [UsageCapabilityStatus] is doc 15's coarser three-value reporting
     * contract. DENIED and NOT_CONFIGURED both collapse to REVOKED here --
     * both mean "PCA does not currently have this capability from the user,"
     * which is the honest, conservative bucket; UNAVAILABLE (the OS service
     * itself could not be obtained) maps to UNSUPPORTED, since no retry at
     * this layer can make it available on this device/build.
     */
    private fun toCapabilityStatus(state: UsageAccessState): UsageCapabilityStatus = when (state) {
        UsageAccessState.GRANTED -> UsageCapabilityStatus.GRANTED
        UsageAccessState.DENIED, UsageAccessState.NOT_CONFIGURED -> UsageCapabilityStatus.REVOKED
        UsageAccessState.UNAVAILABLE -> UsageCapabilityStatus.UNSUPPORTED
    }
}
