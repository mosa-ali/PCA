package org.pca.app.feature.youtube.ui

import org.pca.app.feature.webprotection.identity.WebProtectionIdentity
import org.pca.app.feature.webprotection.identity.WebProtectionIdentityContextProvider
import org.pca.app.feature.youtube.engine.ModeAAndroidUsageAdapter
import org.pca.app.feature.youtube.policy.ModeBFeatureFlagLocalStore

/**
 * The three real states [YouTubeModeActivity] can be in while resolving this device's Mode A
 * evidence -- deliberately a closed set so a caller can never render a stale/partial view while
 * an async load is still in flight (doc 5's "missing evidence must never be displayed as zero
 * use" rule, applied one layer up from [YouTubeModeViewState] itself).
 */
sealed class YouTubeModeLoadState {
    data object Loading : YouTubeModeLoadState()
    data class Success(val viewState: YouTubeModeViewState) : YouTubeModeLoadState()

    /**
     * Covers both real failure modes: no trusted family/device identity yet (not enrolled, or
     * family-sync crypto not active -- see [WebProtectionIdentity.TrustedFamilyContextUnavailable]),
     * and an unexpected exception from the usage-evidence read itself. Deliberately one flat error
     * state, not a distinguishable reason -- this screen has nothing actionable to offer a viewer
     * beyond "try again later," identical in spirit to [org.pca.app.feature.webprotection.ui.SafeBrowserActivity]'s
     * own fail-closed conventions elsewhere in this app.
     */
    data object Error : YouTubeModeLoadState()
}

/**
 * PCA-FR-054 closure (Writer73): the real, production async load [YouTubeModeScreen] needs but
 * never had a caller for -- resolves this device's own trusted family/profile/device identity
 * (never a fabricated one, see [WebProtectionIdentityContextProvider]'s own doc comment), reads
 * real Mode A usage evidence through the existing [ModeAAndroidUsageAdapter], and reads the real
 * (sync, local-only) Mode B feature-flag state through [ModeBFeatureFlagLocalStore]. Extracted out
 * of [YouTubeModeActivity] as a plain, Compose-free class specifically so it is unit-testable with
 * fakes for all three ports, without any Activity/Compose test infrastructure.
 */
class YouTubeModeLoader(
    private val identityProvider: WebProtectionIdentityContextProvider,
    private val usageAdapter: ModeAAndroidUsageAdapter,
    private val modeBFlagStore: ModeBFeatureFlagLocalStore,
) {
    suspend fun load(): YouTubeModeLoadState {
        val identity = identityProvider.current() as? WebProtectionIdentity.Trusted
            ?: return YouTubeModeLoadState.Error

        return try {
            val evidence = usageAdapter.buildEvidence(
                familyId = identity.familyId,
                profileId = identity.profileId,
                deviceId = identity.deviceId,
            )
            val modeBFlag = modeBFlagStore.load()
            YouTubeModeLoadState.Success(YouTubeModeViewStateBuilder.build(evidence, modeBFlag))
        } catch (_: Exception) {
            // Defensive: a persistence/AppOps read failure here must degrade to the same honest
            // Error state as "no identity yet," never crash the hosting Activity or silently
            // render a stale/zero-usage view.
            YouTubeModeLoadState.Error
        }
    }
}
