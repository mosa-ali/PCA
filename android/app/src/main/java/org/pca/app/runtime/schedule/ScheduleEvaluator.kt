package org.pca.app.runtime.schedule

/**
 * Deterministic precedence, highest first -- a field-for-field conforming mirror of
 * `backend/src/schedule/engine.ts`'s `evaluateSchedule` (PCA-4 "policy precedence"). Do not
 * reorder or reinterpret this precedence independently of that reference; any intentional
 * divergence must be recorded as a mismatch per
 * `contracts/schedule-runtime/README.md` and `docs/architecture/37_RUNTIME_SCHEDULE_CONFORMANCE.md`,
 * never introduced silently:
 *
 *   1. An active parent exception overrides everything, including bedtime and school mode
 *      (PCA-FR-043A: exceptions exist specifically to unlock a currently-locked window).
 *   2. Bedtime blocks unconditionally for its app scope.
 *   3. School mode allows an app only if EVERY simultaneously-active SCHOOL_MODE window's
 *      allow-scope includes it (intersection / most-restrictive-wins across overlapping school
 *      windows), blocking everything else.
 *   4. An explicit block period blocks its app scope.
 *   5. An explicit allow period restricts its app scope to only inside that window (outside it,
 *      blocked).
 *   6. The daily minute limit, bonus-extended if an active grant applies.
 *   7. Default allow.
 *
 * Pure and offline-safe: it only ever reads the policy data handed to it (already
 * synced/cached on-device) and `nowUtc` -- it never fetches anything, so identical inputs always
 * produce identical output whether the device is online or offline (PCA-4 "offline behavior":
 * control is never silently relaxed just because connectivity is lost).
 */
object ScheduleEvaluator {

    fun evaluate(input: ScheduleEvaluationInput): ScheduleDecision {
        // PCA-AND-003 non-overridable safety floor (see EmergencyAccessFloor doc comment): checked
        // first, before any window/config content is even read, so no policy shape -- malicious,
        // malformed, or validly-authored/signed -- can ever produce a blocking decision for a
        // protected emergency app token.
        if (EmergencyAccessFloor.isProtectedToken(input.appToken)) {
            return EmergencyAccessFloor.ALWAYS_ALLOWED_DECISION
        }

        val configErrors = input.windows.flatMap { validateScheduleWindow(it) }
        if (configErrors.isNotEmpty()) {
            return ScheduleDecision(
                decision = ScheduleDecisionKind.INVALID_CONFIG,
                reason = "One or more schedule windows failed validation.",
                configErrors = configErrors,
            )
        }

        val intended = evaluateIntendedDecision(input)

        if (input.enforcementCapability != EnforcementCapabilityState.ENFORCED && isRestrictive(intended.decision)) {
            return ScheduleDecision(
                decision = ScheduleDecisionKind.ENFORCEMENT_UNAVAILABLE,
                reason = "Intended decision ${intended.decision} cannot be confirmed enforced (capability: ${input.enforcementCapability}).",
                intendedDecision = intended.decision,
                matchedWindowId = intended.matchedWindowId,
                matchedWindowIds = intended.matchedWindowIds,
            )
        }

        return intended
    }

    private fun isRestrictive(decision: ScheduleDecisionKind): Boolean = decision in setOf(
        ScheduleDecisionKind.BLOCKED_BEDTIME,
        ScheduleDecisionKind.BLOCKED_SCHOOL_MODE,
        ScheduleDecisionKind.BLOCKED_PERIOD,
        ScheduleDecisionKind.BLOCKED_OUTSIDE_ALLOW_PERIOD,
        ScheduleDecisionKind.BLOCKED_LIMIT_REACHED,
    )

    private fun evaluateIntendedDecision(input: ScheduleEvaluationInput): ScheduleDecision {
        val nowUtc = input.nowUtc
        val appToken = input.appToken
        val windows = input.windows
        val bonusGrants = input.bonusGrants
        val exceptions = input.exceptions
        val dailyLimit = input.dailyLimit

        val activeException = exceptions.firstOrNull { exception ->
            appScopeIncludes(exception.appScope, appToken) &&
                !nowUtc.isBefore(exception.startAtUtc) &&
                nowUtc.isBefore(exception.endAtUtc)
        }
        if (activeException != null) {
            return ScheduleDecision(
                decision = ScheduleDecisionKind.ALLOWED_EXCEPTION,
                reason = "Active parent exception ${activeException.id}.",
            )
        }

        val activeWindows = windows.filter { isWindowActive(it, nowUtc) }

        val bedtime = activeWindows.firstOrNull { it.kind == ScheduleWindowKind.BEDTIME && appScopeIncludes(it.appScope, appToken) }
        if (bedtime != null) {
            return ScheduleDecision(
                decision = ScheduleDecisionKind.BLOCKED_BEDTIME,
                reason = "Active bedtime window ${bedtime.id}.",
                matchedWindowId = bedtime.id,
            )
        }

        val activeSchoolModeWindows = activeWindows.filter { it.kind == ScheduleWindowKind.SCHOOL_MODE }
        if (activeSchoolModeWindows.isNotEmpty()) {
            val excludingWindows = activeSchoolModeWindows
                .filter { !appScopeIncludes(it.appScope, appToken) }
                .map { it.id }
                .sorted()
            if (excludingWindows.isNotEmpty()) {
                return ScheduleDecision(
                    decision = ScheduleDecisionKind.BLOCKED_SCHOOL_MODE,
                    reason = "App is outside the allow-scope of ${excludingWindows.size} of ${activeSchoolModeWindows.size} active school-mode window(s) (intersection semantics): ${excludingWindows.joinToString(", ")}.",
                    matchedWindowId = excludingWindows.first(),
                    matchedWindowIds = excludingWindows,
                )
            }
        }

        val blockPeriod = activeWindows.firstOrNull { it.kind == ScheduleWindowKind.BLOCK_PERIOD && appScopeIncludes(it.appScope, appToken) }
        if (blockPeriod != null) {
            return ScheduleDecision(
                decision = ScheduleDecisionKind.BLOCKED_PERIOD,
                reason = "Active block period ${blockPeriod.id}.",
                matchedWindowId = blockPeriod.id,
            )
        }

        val allowPeriodsForApp = windows.filter { it.kind == ScheduleWindowKind.ALLOW_PERIOD && appScopeIncludes(it.appScope, appToken) }
        if (allowPeriodsForApp.isNotEmpty()) {
            val activeAllowPeriod = activeWindows.firstOrNull { it.kind == ScheduleWindowKind.ALLOW_PERIOD && appScopeIncludes(it.appScope, appToken) }
            if (activeAllowPeriod == null) {
                return ScheduleDecision(
                    decision = ScheduleDecisionKind.BLOCKED_OUTSIDE_ALLOW_PERIOD,
                    reason = "No allow period currently covers this app.",
                )
            }
        }

        if (dailyLimit == null) {
            return ScheduleDecision(decision = ScheduleDecisionKind.ALLOWED, reason = "No daily limit configured.")
        }

        val zoned = toZonedWallClock(nowUtc, input.timezone)
        val usedMinutesToday = if (dailyLimit.anchorLocalDate == zoned.localDate) dailyLimit.usedMinutesToday else 0

        val activeBonusMinutes = bonusGrants
            .filter { grant ->
                appScopeIncludes(grant.appScope, appToken) &&
                    !nowUtc.isBefore(grant.grantedAtUtc) &&
                    nowUtc.isBefore(grant.expiresAtUtc)
            }
            .sumOf { it.extraMinutes }

        val effectiveLimit = dailyLimit.limitMinutes + activeBonusMinutes
        val remainingMinutesToday = effectiveLimit - usedMinutesToday

        if (remainingMinutesToday <= 0) {
            return ScheduleDecision(
                decision = ScheduleDecisionKind.BLOCKED_LIMIT_REACHED,
                reason = "Used $usedMinutesToday of $effectiveLimit effective minutes today.",
                remainingMinutesToday = 0,
            )
        }

        return ScheduleDecision(
            decision = if (activeBonusMinutes > 0) ScheduleDecisionKind.ALLOWED_BONUS else ScheduleDecisionKind.ALLOWED,
            reason = if (activeBonusMinutes > 0) "Allowed with $activeBonusMinutes active bonus minutes." else "Within daily limit.",
            remainingMinutesToday = remainingMinutesToday,
        )
    }
}
