import XCTest
@testable import PCA

/// Ported from backend/test/schedule/engine.test.mjs (PCA-4) to prove this
/// Swift port stays behaviorally aligned with the backend/Android engine
/// it mirrors -- same precedence, same cross-midnight/weekday-rollover/
/// DST handling, same FINDING-006 school-mode intersection semantics.
final class ScheduleEngineTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!
    private let riyadh = TimeZone(identifier: "Asia/Riyadh")!

    private func window(
        id: String = "w1", kind: ScheduleWindowKind = .blockPeriod,
        days: Set<Int> = [1, 2, 3, 4, 5, 6, 7], start: TimeOfDay = TimeOfDay(hour: 0, minute: 0),
        end: TimeOfDay = TimeOfDay(hour: 23, minute: 59), appScope: AppScope = .all, timeZone: TimeZone? = nil
    ) -> ScheduleWindow {
        ScheduleWindow(id: id, kind: kind, daysOfWeek: days, start: start, end: end, appScope: appScope, timeZone: timeZone ?? riyadh)
    }

    private func input(
        now: Date, timeZone: TimeZone? = nil, appToken: String = "app-a", windows: [ScheduleWindow] = [],
        bonusGrants: [BonusGrant] = [], exceptions: [ParentException] = [], dailyLimit: DailyAppLimit? = nil,
        enforcement: EnforcementCapabilityState = .enforced
    ) -> ScheduleEvaluationInput {
        ScheduleEvaluationInput(
            nowUtc: now, timeZone: timeZone ?? riyadh, appToken: appToken, windows: windows,
            bonusGrants: bonusGrants, exceptions: exceptions, dailyLimit: dailyLimit, enforcementCapability: enforcement
        )
    }

    private func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)!
    }

    func testCrossMidnightBedtimeBlocksBeforeAndAfterMidnightButNotMidday() {
        // Wednesday 2026-01-07, Riyadh (+3).
        let bedtime = window(id: "bedtime", kind: .bedtime, days: [4], start: TimeOfDay(hour: 22, minute: 0), end: TimeOfDay(hour: 6, minute: 0))

        let before = ScheduleEngine.evaluate(input(now: date("2026-01-07T20:00:00Z"), windows: [bedtime])) // 23:00 Riyadh Wed
        XCTAssertEqual(before.kind, .blockedBedtime)

        let after = ScheduleEngine.evaluate(input(now: date("2026-01-07T23:00:00Z"), windows: [bedtime])) // 02:00 Riyadh Thu
        XCTAssertEqual(after.kind, .blockedBedtime)

        let midday = ScheduleEngine.evaluate(input(now: date("2026-01-07T09:00:00Z"), windows: [bedtime])) // 12:00 Riyadh Wed
        XCTAssertEqual(midday.kind, .allowed)
    }

    func testWeekdayRolloverOnlyBlocksCalendarDayAfterMatchingStartDay() {
        // Calendar weekday numbering: 1=Sun...7=Sat. Friday 2026-01-09 = weekday 6.
        let bedtime = window(id: "bedtime", kind: .bedtime, days: [6], start: TimeOfDay(hour: 23, minute: 0), end: TimeOfDay(hour: 7, minute: 0))

        let saturdayEarly = ScheduleEngine.evaluate(input(now: date("2026-01-09T22:00:00Z"), windows: [bedtime])) // 01:00 Riyadh Sat
        XCTAssertEqual(saturdayEarly.kind, .blockedBedtime)

        let sundayEarly = ScheduleEngine.evaluate(input(now: date("2026-01-10T22:00:00Z"), windows: [bedtime])) // 01:00 Riyadh Sun
        XCTAssertEqual(sundayEarly.kind, .allowed)
    }

    func testPrecedenceParentExceptionOverridesActiveBedtime() {
        let bedtime = window(id: "bedtime", kind: .bedtime)
        let exception = ParentException(id: "exc-1", appScope: .all, startAt: date("2026-01-07T11:00:00Z"), endAt: date("2026-01-07T13:00:00Z"))
        let result = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), windows: [bedtime], exceptions: [exception]))
        XCTAssertEqual(result.kind, .allowedException)
    }

    func testSchoolModeIntersectionAcrossTwoOverlappingWindowsWithDifferentAllowScopes() {
        let windowA = window(id: "school-a", kind: .schoolMode, appScope: .apps(["homework-app"]))
        let windowB = window(id: "school-b", kind: .schoolMode, appScope: .all)

        let forward = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), appToken: "game-app", windows: [windowA, windowB]))
        let reverse = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), appToken: "game-app", windows: [windowB, windowA]))
        XCTAssertEqual(forward.kind, .blockedSchoolMode)
        XCTAssertEqual(forward.matchedWindowIds, ["school-a"], "only the excluding window is attributed, sorted, never array order")
        XCTAssertEqual(forward, reverse, "decision must be independent of window array order (FINDING-006)")
    }

    func testSchoolModeAllowsAppIncludedByEveryActiveWindow() {
        let windowA = window(id: "school-a", kind: .schoolMode, appScope: .apps(["homework-app", "calculator-app"]))
        let windowB = window(id: "school-b", kind: .schoolMode, appScope: .apps(["calculator-app"]))
        let result = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), appToken: "calculator-app", windows: [windowA, windowB]))
        XCTAssertEqual(result.kind, .allowed)
    }

    func testBonusGrantExtendsLimitOnlyWhileActive() {
        let dailyLimit = DailyAppLimit(appScope: .all, limitMinutes: 30, usedMinutesToday: 30, anchorLocalDate: "2026-01-07")
        let grant = BonusGrant(id: "bonus-1", appScope: .all, extraMinutes: 15, grantedAt: date("2026-01-07T09:00:00Z"), expiresAt: date("2026-01-07T09:15:00Z"))

        let during = ScheduleEngine.evaluate(input(now: date("2026-01-07T09:05:00Z"), dailyLimit: dailyLimit, bonusGrants: [grant]))
        XCTAssertEqual(during.kind, .allowedBonus)

        let after = ScheduleEngine.evaluate(input(now: date("2026-01-07T09:20:00Z"), dailyLimit: dailyLimit, bonusGrants: [grant]))
        XCTAssertEqual(after.kind, .blockedLimitReached)
    }

    func testEnforcementUnavailableReportsIntendedDecisionInsteadOfBareBlock() {
        let bedtime = window(id: "bedtime", kind: .bedtime)
        let result = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), windows: [bedtime], enforcement: .unavailable))
        XCTAssertEqual(result.kind, .enforcementUnavailable)
        XCTAssertEqual(result.intendedKind, .blockedBedtime)
    }

    func testEnforcementUnavailableNeverSuppressesAnAllowedVerdict() {
        let result = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), enforcement: .unavailable))
        XCTAssertEqual(result.kind, .allowed)
    }

    func testInvalidWindowConfigurationIsRejectedWithoutCrashingOrSilentlyAllowing() {
        let malformed = window(start: TimeOfDay(hour: 99, minute: 0))
        let result = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), windows: [malformed]))
        XCTAssertEqual(result.kind, .invalidConfig)
        XCTAssertFalse(result.configErrors.isEmpty)
    }

    func testDSTTransitionShiftsWhichInstantMapsToAFixedLocalBedtimeHour() {
        let newYork = TimeZone(identifier: "America/New_York")!
        let bedtime = window(id: "bedtime", kind: .bedtime, days: [1, 2, 3, 4, 5, 6, 7], start: TimeOfDay(hour: 2, minute: 0), end: TimeOfDay(hour: 3, minute: 0), timeZone: newYork)

        let beforeDst = ScheduleEngine.evaluate(input(now: date("2026-03-01T07:30:00Z"), timeZone: newYork, windows: [bedtime]))
        XCTAssertEqual(beforeDst.kind, .blockedBedtime)

        let afterDst = ScheduleEngine.evaluate(input(now: date("2026-03-15T07:30:00Z"), timeZone: newYork, windows: [bedtime]))
        XCTAssertEqual(afterDst.kind, .allowed)
    }
}
