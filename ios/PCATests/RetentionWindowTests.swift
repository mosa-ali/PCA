import XCTest
@testable import PCA

final class RetentionWindowTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!

    private func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)!
    }

    func testFourteenDaysIsExactUTCInterval() {
        let event = date("2026-01-01T10:00:00Z")
        let expiry = RetentionExpiryCalculator.expiryInstant(eventTimestampUtc: event, timeZone: utc, window: .fourteenDays)
        XCTAssertEqual(expiry, date("2026-01-15T10:00:00Z"))
    }

    func testMonthEndOverflowClampsToTargetMonthFinalDay() {
        let event = date("2026-01-31T12:00:00Z") // 2026 is not a leap year
        let expiry = RetentionExpiryCalculator.expiryInstant(eventTimestampUtc: event, timeZone: utc, window: .oneMonth)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        let components = calendar.dateComponents([.year, .month, .day], from: expiry)
        XCTAssertEqual(components.year, 2026)
        XCTAssertEqual(components.month, 2)
        XCTAssertEqual(components.day, 28)
    }

    func testLeapYearFebruary29() {
        let event = date("2028-01-31T00:00:00Z")
        let expiry = RetentionExpiryCalculator.expiryInstant(eventTimestampUtc: event, timeZone: utc, window: .oneMonth)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        let components = calendar.dateComponents([.year, .month, .day], from: expiry)
        XCTAssertEqual(components.month, 2)
        XCTAssertEqual(components.day, 29)
    }

    func testEveryWindowExpiresLaterThanTheShorterOne() {
        let event = date("2026-01-01T00:00:00Z")
        let windows: [RetentionWindow] = [.fourteenDays, .oneMonth, .threeMonths, .sixMonths, .nineMonths]
        let expiries = windows.map { RetentionExpiryCalculator.expiryInstant(eventTimestampUtc: event, timeZone: utc, window: $0) }
        for i in 1..<expiries.count {
            XCTAssertGreaterThan(expiries[i], expiries[i - 1])
        }
    }

    func testIsExpiredIsBoundaryInclusive() {
        let event = date("2026-01-01T00:00:00Z")
        let exactExpiry = date("2026-01-15T00:00:00Z")
        XCTAssertTrue(RetentionExpiryCalculator.isExpired(eventTimestampUtc: event, timeZone: utc, window: .fourteenDays, nowUtc: exactExpiry))
        XCTAssertFalse(RetentionExpiryCalculator.isExpired(eventTimestampUtc: event, timeZone: utc, window: .fourteenDays, nowUtc: exactExpiry.addingTimeInterval(-1)))
    }
}
