import XCTest
@testable import PCA

final class DeviceActivityCallbackHealthTests: XCTestCase {
    private func date(_ offsetSeconds: TimeInterval, from base: Date) -> Date {
        base.addingTimeInterval(offsetSeconds)
    }

    func testHealthyWhenEveryDueExpectationWasObserved() {
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let expected = [ExpectedCallback(kind: .intervalDidStart, expectedNoLaterThan: base)]
        let observed = [ObservedCallback(kind: .intervalDidStart, observedAt: date(1, from: base))]
        let health = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: observed, nowUtc: date(500, from: base))
        XCTAssertEqual(health, .healthy)
    }

    func testDegradedWhenADueExpectationWasNeverObserved() {
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let expected = [ExpectedCallback(kind: .intervalDidStart, expectedNoLaterThan: base)]
        let health = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: [], nowUtc: date(500, from: base))
        guard case .degraded(let missed) = health else {
            return XCTFail("expected degraded state")
        }
        XCTAssertEqual(missed.count, 1)
    }

    func testUnknownWhenNoExpectationHasComeDueYet() {
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let expected = [ExpectedCallback(kind: .intervalDidStart, expectedNoLaterThan: date(1000, from: base))]
        let health = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: [], nowUtc: base)
        XCTAssertEqual(health, .unknown)
    }

    func testUnknownWhenThereAreNoExpectationsAtAll() {
        let health = DeviceActivityCallbackReconciler.reconcile(expected: [], observed: [], nowUtc: Date(timeIntervalSince1970: 0))
        XCTAssertEqual(health, .unknown)
    }

    func testToleranceAbsorbsOrdinarySchedulingJitterWithoutFlaggingDegraded() {
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let expected = [ExpectedCallback(kind: .intervalDidStart, expectedNoLaterThan: base)]
        // 60 seconds past deadline, within the default 120s tolerance -- not yet "due."
        let health = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: [], nowUtc: date(60, from: base))
        XCTAssertEqual(health, .unknown)
    }

    func testEventThresholdCallbacksAreIdentifiedByTheirOwnEventId() {
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let expected = [ExpectedCallback(kind: .eventDidReachThreshold(eventId: "limit-30min"), expectedNoLaterThan: base)]
        let wrongObservation = [ObservedCallback(kind: .eventDidReachThreshold(eventId: "different-event"), observedAt: date(1, from: base))]
        let health = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: wrongObservation, nowUtc: date(500, from: base))
        guard case .degraded(let missed) = health else {
            return XCTFail("a differently-identified event observation must not satisfy this expectation")
        }
        XCTAssertEqual(missed.first?.kind, .eventDidReachThreshold(eventId: "limit-30min"))
    }
}
