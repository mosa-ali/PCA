package org.pca.app.runtime.schedule

import java.time.Instant

/**
 * PCA-FR-130 ("Bonus Time"): the on-device merge step a live sync client
 * would run after receiving and decrypting a `POLICY_UPDATE` Family
 * Envelope carrying a new/decided [BonusGrant] -- see this feature's own
 * report for why the actual network/decrypt leg is NOT built here (the
 * production crypto suite this repo's own `SchedulePolicyEnvelopePayload.kt`
 * depends on has no live sync client anywhere in this codebase yet, on
 * EITHER platform; that is a pre-existing, repo-wide gap this lane does not
 * attempt to close). This class is the part of the pipeline that genuinely
 * IS this device's own responsibility once a grant's plaintext content is
 * available: merge it into the persisted [SchedulePolicyV1] the SAME way
 * [PersistentSchedulePolicyStore] already persists every other policy
 * revision, so [ScheduleRuntime]/[ScheduleEvaluator] honor it exactly like
 * any other accepted policy -- offline-safe, restart-safe, bedtime/
 * emergency-floor-respecting, for free, because it reuses that already-real
 * enforcement path rather than adding a second one.
 *
 * Requires a policy already exists in [store] (a device with literally no
 * accepted base policy yet has no [SchedulePolicyV1.familyId]/
 * [SchedulePolicyV1.childProfileId]/[SchedulePolicyV1.timezone] to attach a
 * grant to) -- [applyDecidedGrant] returns [ApplyResult.NoBasePolicy] rather
 * than fabricating one.
 */
object BonusGrantSync {

    sealed interface ApplyResult {
        data class Applied(val snapshot: SchedulePolicySnapshot) : ApplyResult
        data object NoBasePolicy : ApplyResult
    }

    /**
     * Merges [grant] into the child's currently persisted policy, applying
     * the SAME "a new grant supersedes a still-active prior grant for the
     * same appScope" overlap rule `backend/src/childrequests/BonusGrantLedger.ts`
     * documents (kept in sync deliberately -- see that file's own doc
     * comment for the full "why supersede, not stack" rationale: unbounded
     * additive stacking across repeated approvals would defeat the
     * per-grant bound). Superseding caps the prior grant's `expiresAtUtc`
     * to [nowUtc] rather than deleting it -- never a second state channel,
     * just the same absolute-UTC expiry every [BonusGrant] already has.
     *
     * Both `candidatePolicy` and `lastKnownGoodPolicy` are updated to the
     * SAME new revision -- exactly what a genuine "just synced and accepted
     * a new revision" acceptance would produce (see
     * `contracts/schedule-runtime/SchedulePolicyV1.md`'s acceptance state
     * machine), so the very next [ScheduleRuntime.evaluate] call --
     * including after a simulated process/app restart that only reloads
     * [store] -- reflects the grant with no separate "pending acceptance"
     * step.
     */
    fun applyDecidedGrant(store: SchedulePolicyStore, grant: BonusGrant, nowUtc: Instant): ApplyResult {
        val snapshot = store.load() ?: return ApplyResult.NoBasePolicy
        val base = snapshot.candidatePolicy ?: snapshot.lastKnownGoodPolicy ?: return ApplyResult.NoBasePolicy

        val superseded = base.bonusGrants.map { prior ->
            if (prior.id == grant.id) return@map prior
            val stillActive = !prior.grantedAtUtc.isAfter(nowUtc) && prior.expiresAtUtc.isAfter(nowUtc)
            if (!stillActive || !scopesOverlap(prior.appScope, grant.appScope)) prior
            else prior.copy(expiresAtUtc = nowUtc)
        }
        val withoutSameId = superseded.filterNot { it.id == grant.id }
        val updated = base.copy(
            policyRevision = base.policyRevision + 1,
            bonusGrants = withoutSameId + grant,
            issuedAt = nowUtc,
            effectiveFrom = nowUtc,
        )
        val nextSnapshot = snapshot.copy(candidatePolicy = updated, lastKnownGoodPolicy = updated, lastPolicySyncAtUtc = nowUtc)
        store.save(nextSnapshot)
        return ApplyResult.Applied(nextSnapshot)
    }

    /**
     * Revokes an active grant by id (PCA-FR-130 "revocation... implement
     * and test if it's a natural fit") -- same cap-don't-delete posture as
     * the backend ledger. A no-op (returns the unchanged snapshot inside
     * [ApplyResult.Applied]) when the grant is unknown or already inactive
     * at [nowUtc], so revoke can never resurrect or extend a grant.
     */
    fun revokeGrant(store: SchedulePolicyStore, grantId: String, nowUtc: Instant): ApplyResult {
        val snapshot = store.load() ?: return ApplyResult.NoBasePolicy
        val base = snapshot.candidatePolicy ?: snapshot.lastKnownGoodPolicy ?: return ApplyResult.NoBasePolicy

        var changed = false
        val next = base.bonusGrants.map { grant ->
            if (grant.id != grantId) return@map grant
            val isActive = !grant.grantedAtUtc.isAfter(nowUtc) && grant.expiresAtUtc.isAfter(nowUtc)
            if (!isActive) grant
            else {
                changed = true
                grant.copy(expiresAtUtc = nowUtc)
            }
        }
        if (!changed) return ApplyResult.Applied(snapshot)

        val updated = base.copy(policyRevision = base.policyRevision + 1, bonusGrants = next, issuedAt = nowUtc, effectiveFrom = nowUtc)
        val nextSnapshot = snapshot.copy(candidatePolicy = updated, lastKnownGoodPolicy = updated, lastPolicySyncAtUtc = nowUtc)
        store.save(nextSnapshot)
        return ApplyResult.Applied(nextSnapshot)
    }
}

private fun scopesOverlap(a: AppScope, b: AppScope): Boolean = when {
    a is AppScope.All || b is AppScope.All -> true
    a is AppScope.Apps && b is AppScope.Apps -> a.apps.any { appScopeIncludes(b, it) }
    else -> false
}
