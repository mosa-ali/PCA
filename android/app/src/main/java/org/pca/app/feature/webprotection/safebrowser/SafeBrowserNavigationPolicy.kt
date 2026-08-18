package org.pca.app.feature.webprotection.safebrowser

import java.util.UUID
import org.pca.app.feature.webprotection.engine.WebFilterEngine
import org.pca.app.feature.webprotection.policy.ClassifierResult
import org.pca.app.feature.webprotection.policy.OpaqueFamilyId
import org.pca.app.feature.webprotection.policy.SafeSearchDirective
import org.pca.app.feature.webprotection.policy.SafeSearchMode
import org.pca.app.feature.webprotection.policy.VpnMetadataDecision
import org.pca.app.feature.webprotection.policy.WebDecisionOutcome
import org.pca.app.feature.webprotection.policy.WebLocale
import org.pca.app.feature.webprotection.policy.canonicalizeDomain
import org.pca.app.feature.webprotection.policy.isBlockRequestable
import org.pca.app.feature.webprotection.policy.resolveEffectiveSafeSearchMode
import org.pca.app.persistence.entity.WebVisitAction
import org.pca.app.persistence.repository.WebVisitRepository

/**
 * doc 14's Safe-Browser-specific ANDROID RUNTIME entry point -- this is the
 * seam the actual PCA Safe Browser WebView surface calls on every navigation
 * attempt (`shouldOverrideUrlLoading`/`shouldInterceptRequest`). Mirrors
 * `backend/src/safebrowser/SafeBrowserNavigationPolicy.ts`'s pipeline
 * exactly: canonicalize -> [WebFilterEngine.decide] -> ALLOW (apply
 * SafeSearch) or BLOCK/REVIEW (persist a [BlockDecisionState]).
 *
 * Persistence: an ALLOW outcome is NEVER persisted here (doc 15: "PCA
 * services do not persist readable app-use timelines" -- an allowed page is
 * not itself a retained event). A BLOCK/REVIEW outcome is persisted via the
 * EXISTING, already-encrypted [WebVisitRepository]/`WebVisitEntity` (doc 10
 * Section 4.2 already approves exactly this URL/title persistence, scoped to
 * the Safe Browser browsing context only -- this class is the only caller in
 * this lane that ever supplies a full `url`/`pageTitle`, satisfying the
 * "Safe Browser context may see a full URL only within its own legitimate
 * browsing context" hard requirement structurally: nothing outside
 * `safebrowser/` in this package ever touches a full URL string).
 */
class SafeBrowserNavigationPolicy(
    private val engine: WebFilterEngine,
    private val webVisits: WebVisitRepository,
    private val now: () -> Long = { System.currentTimeMillis() },
    private val idGenerator: () -> String = { UUID.randomUUID().toString() },
    private val enrollmentSafeSearchDefault: () -> SafeSearchDirective? = { null },
) {
    suspend fun evaluateNavigation(
        familyId: OpaqueFamilyId,
        profileId: OpaqueProfileId,
        deviceId: String,
        url: String,
        pageTitle: String? = null,
        classifierResult: ClassifierResult? = null,
        vpnDecision: VpnMetadataDecision? = null,
        safeSearch: SafeSearchDirective? = null,
        locale: WebLocale = WebLocale.EN,
    ): NavigationOutcome {
        val domain = canonicalizeDomain(url) ?: throw NavigationError.InvalidUrl

        val decision = engine.decide(familyId, domain, classifierResult, vpnDecision, locale)

        if (decision.outcome == WebDecisionOutcome.ALLOW) {
            val effectiveSafeSearch = mergeEnrollmentMinimum(enrollmentSafeSearchDefault(), safeSearch)
            val safeSearchMode = effectiveSafeSearch?.let(::resolveEffectiveSafeSearchMode) ?: SafeSearchMode.OFF
            val rewrite = applySafeSearchQueryParameter(url, domain, safeSearchMode)
            return NavigationOutcome.Allow(safeSearchMode, rewrite.url, rewrite.applied)
        }

        val id = idGenerator()
        val timestamp = now()
        val requestable = decision.outcome != WebDecisionOutcome.ALLOW && isBlockRequestable(decision.source)

        webVisits.record(
            deviceId = deviceId,
            domain = domain,
            url = url,
            title = pageTitle,
            classificationCategory = decision.source.name,
            ruleOrModelVersion = decision.reasonId.name,
            action = if (decision.outcome == WebDecisionOutcome.REVIEW) WebVisitAction.REVIEW else WebVisitAction.BLOCKED,
            timestampEpochMillis = timestamp,
            id = id,
        )

        val blockDecision = BlockDecisionState(
            id = id,
            familyId = familyId,
            profileId = profileId,
            domain = domain,
            url = url,
            pageTitle = pageTitle,
            outcome = decision.outcome,
            source = decision.source,
            reasonId = decision.reasonId,
            reasonCode = decision.reasonCode,
            requestable = requestable,
            createdAtEpochMillis = timestamp,
        )
        return NavigationOutcome.Held(blockDecision)
    }

    private fun mergeEnrollmentMinimum(
        enrollmentMinimum: SafeSearchDirective?,
        requested: SafeSearchDirective?,
    ): SafeSearchDirective? {
        if (requested == null) return enrollmentMinimum
        if (!requested.serviceSupportsSafeSearch || enrollmentMinimum == null) return requested
        val mode = if (enrollmentMinimum.mode.rank() > requested.mode.rank()) enrollmentMinimum.mode else requested.mode
        return SafeSearchDirective(mode, serviceSupportsSafeSearch = true)
    }

    private fun SafeSearchMode.rank(): Int = when (this) {
        SafeSearchMode.OFF -> 0
        SafeSearchMode.MODERATE -> 1
        SafeSearchMode.STRICT -> 2
    }
}
