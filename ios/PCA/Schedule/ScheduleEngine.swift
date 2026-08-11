import Foundation

/// Swift port of backend/src/schedule/engine.ts (PCA-4), kept behaviorally
/// aligned with it deliberately -- this is the SAME policy semantics the
/// backend/Android schedule engine implements, ported so the iOS Child
/// Agent can compute the identical ALLOWED/BLOCKED decision locally
/// (doc 07 Section 6/12: consume the same policy, do not invent a second
/// authority). Any precedence change here without a matching backend
/// change would itself become a cross-platform policy divergence bug.
public enum ScheduleEngine {
    /// Precedence, highest first -- identical to engine.ts's documented
    /// order: parent exception > bedtime > school mode (INTERSECTION
    /// across all simultaneously-active school windows, per backend
    /// FINDING-006 -- never insertion order) > block period > allow
    /// period > daily limit (bonus-extended) > default allow.
    public static func evaluate(_ input: ScheduleEvaluationInput) -> ScheduleDecision {
        let configErrors = input.windows.flatMap(validate)
        if !configErrors.isEmpty {
            return ScheduleDecision(kind: .invalidConfig, reason: "One or more schedule windows failed validation.", configErrors: configErrors)
        }

        let intended = evaluateIntended(input)

        if input.enforcementCapability != .enforced, intended.isRestrictive {
            return ScheduleDecision(
                kind: .enforcementUnavailable,
                reason: "Intended decision \(intended.kind) cannot be confirmed enforced (capability: \(input.enforcementCapability)).",
                matchedWindowIds: intended.matchedWindowIds,
                intendedKind: intended.kind
            )
        }
        return intended
    }

    private static func evaluateIntended(_ input: ScheduleEvaluationInput) -> ScheduleDecision {
        let now = input.nowUtc
        let appToken = input.appToken

        if let activeException = input.exceptions.first(where: {
            $0.appScope.includes(appToken) && now >= $0.startAt && now < $0.endAt
        }) {
            return ScheduleDecision(kind: .allowedException, reason: "Active parent exception \(activeException.id).")
        }

        let activeWindows = input.windows.filter { isWindowActive($0, now: now) }

        if let bedtime = activeWindows.first(where: { $0.kind == .bedtime && $0.appScope.includes(appToken) }) {
            return ScheduleDecision(kind: .blockedBedtime, reason: "Active bedtime window \(bedtime.id).", matchedWindowIds: [bedtime.id])
        }

        let activeSchoolWindows = activeWindows.filter { $0.kind == .schoolMode }
        if !activeSchoolWindows.isEmpty {
            let excluding = activeSchoolWindows.filter { !$0.appScope.includes(appToken) }.map(\.id).sorted()
            if !excluding.isEmpty {
                return ScheduleDecision(
                    kind: .blockedSchoolMode,
                    reason: "App is outside the allow-scope of \(excluding.count) of \(activeSchoolWindows.count) active school-mode window(s) (intersection semantics): \(excluding.joined(separator: ", ")).",
                    matchedWindowIds: excluding
                )
            }
        }

        if let blockPeriod = activeWindows.first(where: { $0.kind == .blockPeriod && $0.appScope.includes(appToken) }) {
            return ScheduleDecision(kind: .blockedPeriod, reason: "Active block period \(blockPeriod.id).", matchedWindowIds: [blockPeriod.id])
        }

        let allowPeriodsForApp = input.windows.filter { $0.kind == .allowPeriod && $0.appScope.includes(appToken) }
        if !allowPeriodsForApp.isEmpty {
            let activeAllowPeriod = activeWindows.first { $0.kind == .allowPeriod && $0.appScope.includes(appToken) }
            if activeAllowPeriod == nil {
                return ScheduleDecision(kind: .blockedOutsideAllowPeriod, reason: "No allow period currently covers this app.")
            }
        }

        guard let dailyLimit = input.dailyLimit else {
            return ScheduleDecision(kind: .allowed, reason: "No daily limit configured.")
        }

        let localDate = localDateString(now, timeZone: input.timeZone)
        let usedMinutesToday = dailyLimit.anchorLocalDate == localDate ? dailyLimit.usedMinutesToday : 0

        let activeBonusMinutes = input.bonusGrants
            .filter { $0.appScope.includes(appToken) && now >= $0.grantedAt && now < $0.expiresAt }
            .reduce(0) { $0 + $1.extraMinutes }

        let effectiveLimit = dailyLimit.limitMinutes + activeBonusMinutes
        let remaining = effectiveLimit - usedMinutesToday

        if remaining <= 0 {
            return ScheduleDecision(
                kind: .blockedLimitReached,
                reason: "Used \(usedMinutesToday) of \(effectiveLimit) effective minutes today.",
                remainingMinutesToday: 0
            )
        }
        return ScheduleDecision(
            kind: activeBonusMinutes > 0 ? .allowedBonus : .allowed,
            reason: activeBonusMinutes > 0 ? "Allowed with \(activeBonusMinutes) active bonus minutes." : "Within daily limit.",
            remainingMinutesToday: remaining
        )
    }

    // MARK: - Window matching (Calendar-based, mirrors schedule/policy.ts's cross-midnight logic)

    static func validate(_ window: ScheduleWindow) -> [String] {
        var errors: [String] = []
        for (label, tod) in [("start", window.start), ("end", window.end)] {
            if tod.hour < 0 || tod.hour > 23 { errors.append("window \(window.id): \(label).hour out of range") }
            if tod.minute < 0 || tod.minute > 59 { errors.append("window \(window.id): \(label).minute out of range") }
        }
        if window.daysOfWeek.isEmpty { errors.append("window \(window.id): daysOfWeek must not be empty") }
        for day in window.daysOfWeek where !(1...7).contains(day) {
            errors.append("window \(window.id): invalid daysOfWeek entry \(day)")
        }
        return errors
    }

    static func isWindowActive(_ window: ScheduleWindow, now: Date) -> Bool {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = window.timeZone
        let components = calendar.dateComponents([.weekday, .hour, .minute], from: now)
        guard let weekday = components.weekday, let hour = components.hour, let minute = components.minute else { return false }

        let nowMinutes = hour * 60 + minute
        let startMinutes = window.start.hour * 60 + window.start.minute
        let endMinutes = window.end.hour * 60 + window.end.minute

        if endMinutes > startMinutes {
            return window.daysOfWeek.contains(weekday) && nowMinutes >= startMinutes && nowMinutes < endMinutes
        }

        let todayIsStartDay = window.daysOfWeek.contains(weekday) && nowMinutes >= startMinutes
        let yesterdayWeekday = ((weekday - 1 + 6) % 7) + 1 // Calendar weekday is 1...7; wrap within that range
        let yesterdayWasStartDay = window.daysOfWeek.contains(yesterdayWeekday) && nowMinutes < endMinutes
        return todayIsStartDay || yesterdayWasStartDay
    }

    static func localDateString(_ date: Date, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
