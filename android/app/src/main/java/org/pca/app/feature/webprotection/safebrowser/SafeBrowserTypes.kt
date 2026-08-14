package org.pca.app.feature.webprotection.safebrowser

import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.OpaqueFamilyId
import org.pca.app.feature.webprotection.policy.WebDecisionOutcome
import org.pca.app.feature.webprotection.policy.WebDecisionSource
import org.pca.app.feature.webprotection.policy.WebReasonId

typealias OpaqueProfileId = String
typealias BlockDecisionId = String
typealias UnblockRequestId = String

/**
 * doc 14's visibility matrix, PCA Safe Browser row: "Full URL/title only
 * under local retention policy; decision reason/source." Mirrors backend
 * `BlockDecisionState` -- `url`/`pageTitle` are only ever populated here
 * (never anywhere else in this lane, which otherwise only ever sees a
 * canonical domain) because the Safe Browser is doc 14's "only normal path
 * in which PCA can intentionally observe a full URL, page title and
 * rendered content locally." The persisted form of this on-device is
 * [org.pca.app.persistence.entity.WebVisitEntity] via
 * [org.pca.app.persistence.repository.WebVisitRepository] -- an EXISTING,
 * already-encrypted-at-rest table this lane reuses rather than inventing a
 * new one (doc 10 Section 4.2 already approves exactly this URL/title
 * persistence scoped to the browsing context).
 */
data class BlockDecisionState(
    val id: BlockDecisionId,
    val familyId: OpaqueFamilyId,
    val profileId: OpaqueProfileId,
    val domain: CanonicalDomain,
    val url: String,
    val pageTitle: String?,
    val outcome: WebDecisionOutcome,
    val source: WebDecisionSource,
    val reasonId: WebReasonId,
    val reasonCode: String,
    /** doc 14: "The child can request a review" -- false for a non-overridable security block. */
    val requestable: Boolean,
    val createdAtEpochMillis: Long,
)

sealed class NavigationOutcome {
    /**
     * [loadUrl] is the URL the WebView chrome must actually load -- either [SafeSearchDirective]-
     * driven-and-provider-supported (in which case it differs from the originally requested URL by
     * exactly one query parameter, see [applySafeSearchQueryParameter]) or, in every other case
     * (mode OFF, no directive supplied, unsupported provider), identical to the requested URL.
     * [safeSearchApplied] makes that distinction inspectable rather than silent -- doc 14's
     * SafeSearch note requires enforcement to never be silently claimed OR silently skipped.
     */
    data class Allow(
        val safeSearchMode: org.pca.app.feature.webprotection.policy.SafeSearchMode,
        val loadUrl: String,
        val safeSearchApplied: Boolean,
    ) : NavigationOutcome()
    data class Held(val blockDecision: BlockDecisionState) : NavigationOutcome()
}

sealed class NavigationError : Exception() {
    object InvalidUrl : NavigationError()
}
