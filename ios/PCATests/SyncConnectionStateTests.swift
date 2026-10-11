import XCTest
@testable import PCA

final class SyncConnectionStateTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testNoTransportIsOffline() {
        let input = SyncConnectionStateInput(isTransportConnected: false, isSyncing: true, hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: now, nowUtc: now)
        XCTAssertEqual(SyncConnectionStateComputer.compute(input), .offline)
    }

    func testActivelyDrainingIsSyncing() {
        let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: true, hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: now, nowUtc: now)
        XCTAssertEqual(SyncConnectionStateComputer.compute(input), .syncing)
    }

    func testConnectedRecentlySyncedNothingPendingIsLive() {
        let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false, hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: now, nowUtc: now)
        XCTAssertEqual(SyncConnectionStateComputer.compute(input), .live)
    }

    func testConnectedRecentlySyncedButPendingWorkIsSyncPending() {
        let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false, hasPendingLocalWork: true, lastSuccessfulSyncAtUtc: now, nowUtc: now)
        XCTAssertEqual(SyncConnectionStateComputer.compute(input), .syncPending)
    }

    func testNeverSyncedWithNoPendingWorkIsStale() {
        let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false, hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: nil, nowUtc: now)
        XCTAssertEqual(SyncConnectionStateComputer.compute(input), .stale)
    }

    func testNeverSyncedWithPendingWorkIsSyncPending() {
        let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false, hasPendingLocalWork: true, lastSuccessfulSyncAtUtc: nil, nowUtc: now)
        XCTAssertEqual(SyncConnectionStateComputer.compute(input), .syncPending)
    }

    func testStaleThresholdExceededIsStaleEvenWhenConnected() {
        let old = now.addingTimeInterval(-2 * 24 * 60 * 60)
        let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false, hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: old, nowUtc: now)
        XCTAssertEqual(SyncConnectionStateComputer.compute(input), .stale)
    }

    func testConnectedTransportAloneNeverImpliesLive() {
        // LIVE requires both a connected transport AND a recent successful sync.
        let old = now.addingTimeInterval(-999 * 24 * 60 * 60)
        let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false, hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: old, nowUtc: now)
        XCTAssertNotEqual(SyncConnectionStateComputer.compute(input), .live)
    }

    func testNonFiniteEvaluationTimeCannotClaimLive() {
        for timestamp in [Double.nan, Double.infinity, -Double.infinity] {
            let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false,
                hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: now,
                nowUtc: Date(timeIntervalSince1970: timestamp))
            XCTAssertEqual(SyncConnectionStateComputer.compute(input), .stale, "invalid evaluation timestamp: \(timestamp)")
        }
    }

    func testNonFiniteLastSuccessTimeCannotClaimLive() {
        for timestamp in [Double.nan, Double.infinity, -Double.infinity] {
            let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false,
                hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: Date(timeIntervalSince1970: timestamp), nowUtc: now)
            XCTAssertEqual(SyncConnectionStateComputer.compute(input), .stale, "invalid last-sync timestamp: \(timestamp)")
        }
    }

    func testInvalidStaleThresholdCannotClaimLive() {
        for threshold in [Double.nan, Double.infinity, -Double.infinity, -1] {
            let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false,
                hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: now, nowUtc: now,
                staleThresholdSeconds: threshold)
            XCTAssertEqual(SyncConnectionStateComputer.compute(input), .stale, "invalid stale threshold: \(threshold)")
        }
    }

    func testNonFiniteComputedAgeCannotClaimLiveEvenWhenInputsAreFinite() {
        let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false,
            hasPendingLocalWork: false,
            lastSuccessfulSyncAtUtc: Date(timeIntervalSince1970: -Double.greatestFiniteMagnitude),
            nowUtc: Date(timeIntervalSince1970: Double.greatestFiniteMagnitude))
        XCTAssertEqual(SyncConnectionStateComputer.compute(input), .stale)
    }

    func testInvalidTimestampRemainsStaleWhenLocalWorkIsPending() {
        let input = SyncConnectionStateInput(isTransportConnected: true, isSyncing: false,
            hasPendingLocalWork: true, lastSuccessfulSyncAtUtc: Date(timeIntervalSince1970: .nan), nowUtc: now)
        XCTAssertEqual(SyncConnectionStateComputer.compute(input), .stale)
    }
}
