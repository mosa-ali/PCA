import XCTest
import Foundation
@testable import PCA

final class SafeZoneDeliveryTests: XCTestCase {
    private final class InterruptingKeychainStore: KeychainStoreProtocol {
        private let backing = InMemoryKeychainStore()
        private let lock = NSLock()
        private var zoneWrites = 0
        private var failZoneWriteNumber: Int?
        init(failZoneWriteNumber: Int?) { self.failZoneWriteNumber = failZoneWriteNumber }
        func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
            try storeReplacingAtomically(data, forAccount: account, service: service, accessibility: accessibility)
        }
        func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
            if service.hasSuffix(".safe-zone-delivery.v1"), account.contains(".zone.") {
                lock.lock()
                zoneWrites += 1
                let shouldFail = zoneWrites == failZoneWriteNumber
                lock.unlock()
                if shouldFail { throw InjectedFailure.interruptedWrite }
            }
            try backing.storeReplacingAtomically(data, forAccount: account, service: service, accessibility: accessibility)
        }
        func retrieve(forAccount account: String, service: String) throws -> Data {
            try backing.retrieve(forAccount: account, service: service)
        }
        func delete(forAccount account: String, service: String) throws {
            try backing.delete(forAccount: account, service: service)
        }
        private enum InjectedFailure: Error { case interruptedWrite }
    }

    private final class TemporarilyUnavailableKeychainStore: KeychainStoreProtocol {
        private let backing = InMemoryKeychainStore()
        var unavailableAccount: String?
        var unavailableService = false
        func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
            try backing.store(data, forAccount: account, service: service, accessibility: accessibility)
        }
        func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
            try backing.storeReplacingAtomically(data, forAccount: account, service: service, accessibility: accessibility)
        }
        func retrieve(forAccount account: String, service: String) throws -> Data {
            if unavailableService || unavailableAccount == account {
                throw KeychainStoreError.unexpectedStatus(-25308)
            }
            return try backing.retrieve(forAccount: account, service: service)
        }
        func delete(forAccount account: String, service: String) throws {
            try backing.delete(forAccount: account, service: service)
        }
    }

    private final class ScopeChangingKeychainStore: KeychainStoreProtocol {
        private let backing = InMemoryKeychainStore()
        var afterRetrieve: ((String, String) -> Void)?
        func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
            try backing.store(data, forAccount: account, service: service, accessibility: accessibility)
        }
        func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
            try backing.storeReplacingAtomically(data, forAccount: account, service: service, accessibility: accessibility)
        }
        func retrieve(forAccount account: String, service: String) throws -> Data {
            let data = try backing.retrieve(forAccount: account, service: service)
            afterRetrieve?(account, service)
            return data
        }
        func delete(forAccount account: String, service: String) throws {
            try backing.delete(forAccount: account, service: service)
        }
    }

    private let scope = PCADeviceSafeZoneDeliveryScope(familyId: "family-a", deviceId: "device-a")
    private let otherScope = PCADeviceSafeZoneDeliveryScope(familyId: "family-b", deviceId: "device-a")
    private lazy var session = PCADeviceSession(deviceId: "device-a", sessionToken: "device-bearer", expiresAt: Date(timeIntervalSince1970: 2_000_000_000))

    private func inbox(_ keychain: KeychainStoreProtocol, scope: PCADeviceSafeZoneDeliveryScope? = nil) -> PCAKeychainSafeZoneDeliveryInbox {
        PCAKeychainSafeZoneDeliveryInbox(keychain: keychain, serviceNamespace: "test.pca") { scope ?? self.scope }
    }

    private func client(_ http: PCAHTTPTransport,
                        monotonicNow: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) throws -> PCADeviceSafeZoneDeliveryClient {
        try PCADeviceSafeZoneDeliveryClient(baseURL: URL(string: "https://api.example.test")!, currentSession: { self.session },
            transport: http, monotonicNow: monotonicNow)
    }

    private func row(_ id: String = "zone-001", ciphertext: String = "AQID", revision: UInt32 = 1,
                     keyEpoch: Int = 2) -> PCAOpaqueSafeZoneDelivery {
        PCAOpaqueSafeZoneDelivery(zoneId: id, ciphertextB64: ciphertext, nonceB64: "AAECAwQFBgcICQoL",
            keyEpoch: keyEpoch, revision: revision, deliveryState: "PENDING_OFFLINE", updatedAtUtc: "2026-10-10T10:20:30.000Z")
    }

    private func epochCursor(_ keyEpoch: Int, _ zoneId: String) -> String {
        "v1~\(keyEpoch)~\(zoneId)"
    }

    private func json(_ rows: [[String: Any]], nextCursor: Any = NSNull()) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["safeZones": rows, "nextCursor": nextCursor])
    }

    private func wire(_ row: PCAOpaqueSafeZoneDelivery) -> [String: Any] {
        ["zoneId": row.zoneId, "ciphertextB64": row.ciphertextB64, "nonceB64": row.nonceB64,
         "keyEpoch": row.keyEpoch, "revision": row.revision, "deliveryState": row.deliveryState,
         "updatedAtUtc": row.updatedAtUtc]
    }

    func testFetchStagesOpaqueEnvelopeInDeviceOnlyKeychainAndRelaunchReadsIt() async throws {
        let keychain = InMemoryKeychainStore()
        let response = try json([wire(row())])
        let http = InMemoryPCAHTTPTransport { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/v1/runtime-sync/safe-zones")
            XCTAssertNil(request.url?.query)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer device-bearer")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
            return PCAHTTPResponse(statusCode: 200, data: response)
        }
        let store = inbox(keychain)
        let completed = try await client(http).synchronize(scope: scope, inbox: store)
        XCTAssertTrue(completed)

        let restored = inbox(keychain)
        XCTAssertEqual(try restored.read(scope: scope), [row()])
        XCTAssertNil(try restored.nextCursor(scope: scope))
        let manifest = try keychain.retrieve(forAccount: "safe-zone-delivery.v1.\(scope.storageKey).manifest", service: "test.pca.safe-zone-delivery.v1")
        XCTAssertTrue(String(decoding: manifest, as: UTF8.self).contains("zone-001"))
        XCTAssertEqual(keychain.storedAccessibility(forAccount: "safe-zone-delivery.v1.\(scope.storageKey).zone.zone-001", service: "test.pca.safe-zone-delivery.v1"), .whenUnlockedThisDeviceOnly)
        XCTAssertFalse(String(decoding: manifest, as: UTF8.self).contains("family-a"))
    }

    func testPaginationPersistsCursorBeforeFollowingAndResumesAfterRelaunch() async throws {
        let keychain = InMemoryKeychainStore()
        let firstRows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index))
        }
        let firstBody = try json(firstRows.map(wire), nextCursor: firstRows.last!.zoneId)
        let secondBody = try json([wire(row("zone-017"))])
        let requests = NSMutableArray()
        let http = InMemoryPCAHTTPTransport { request in
            requests.add(request.url?.absoluteString ?? "")
            return requests.count == 1
                ? PCAHTTPResponse(statusCode: 200, data: firstBody)
                : PCAHTTPResponse(statusCode: 200, data: secondBody)
        }
        let firstStore = inbox(keychain)
        let firstCompleted = try await client(http).synchronize(scope: scope, inbox: firstStore, maximumPages: 1)
        XCTAssertFalse(firstCompleted)
        XCTAssertEqual(try firstStore.nextCursor(scope: scope), "zone-016")

        let relaunchedStore = inbox(keychain)
        let secondCompleted = try await client(http).synchronize(scope: scope, inbox: relaunchedStore, maximumPages: 1)
        XCTAssertTrue(secondCompleted)
        XCTAssertEqual(requests.count, 2)
        XCTAssertTrue((requests[1] as! String).contains("cursor=zone-016"))
        XCTAssertEqual(try relaunchedStore.read(scope: scope).count, 17)
        XCTAssertNil(try relaunchedStore.nextCursor(scope: scope))
    }

    func testEpochBoundCursorAcceptsLongZoneIdAndIsResumedVerbatim() async throws {
        let keychain = InMemoryKeychainStore()
        let store = inbox(keychain)
        let longZoneId = String(repeating: "z", count: 128)
        let rows = (1..<PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index))
        } + [row(longZoneId)]
        let next = epochCursor(2, longZoneId)
        XCTAssertGreaterThan(next.utf8.count, longZoneId.utf8.count)
        XCTAssertLessThanOrEqual(next.utf8.count, 160)
        let firstBody = try json(rows.map(wire), nextCursor: next)
        let secondBody = try json([])
        var requestURLs: [URL] = []
        let http = InMemoryPCAHTTPTransport { request in
            if let url = request.url { requestURLs.append(url) }
            return requestURLs.count == 1
                ? PCAHTTPResponse(statusCode: 200, data: firstBody)
                : PCAHTTPResponse(statusCode: 200, data: secondBody)
        }

        let firstCompleted = try await client(http).synchronize(scope: scope, inbox: store, maximumPages: 1)
        XCTAssertFalse(firstCompleted)
        XCTAssertEqual(try store.nextCursor(scope: scope), next)
        let secondCompleted = try await client(http).synchronize(scope: scope, inbox: store, maximumPages: 1)
        XCTAssertTrue(secondCompleted)
        XCTAssertEqual(requestURLs.count, 2)
        XCTAssertEqual(URLComponents(url: requestURLs[1], resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "cursor" })?.value, next)
        XCTAssertEqual(try store.read(scope: scope).count, PCAKeychainSafeZoneDeliveryInbox.pageSize)
    }

    func testStaleEpochCursorCanRestartAtEarlierZoneIds() async throws {
        let keychain = InMemoryKeychainStore()
        let store = inbox(keychain)
        let epochTwoRows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index), keyEpoch: 2)
        }
        let epochThreeRows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index), revision: 2, keyEpoch: 3)
        }
        let oldCursor = epochCursor(2, epochTwoRows.last!.zoneId)
        let newCursor = epochCursor(3, epochThreeRows.last!.zoneId)
        let firstBody = try json(epochTwoRows.map(wire), nextCursor: oldCursor)
        let restartBody = try json(epochThreeRows.map(wire), nextCursor: newCursor)
        var requestURLs: [URL] = []
        let http = InMemoryPCAHTTPTransport { request in
            if let url = request.url { requestURLs.append(url) }
            return requestURLs.count == 1
                ? PCAHTTPResponse(statusCode: 200, data: firstBody)
                : PCAHTTPResponse(statusCode: 200, data: restartBody)
        }

        let firstCompleted = try await client(http).synchronize(scope: scope, inbox: store, maximumPages: 1)
        XCTAssertFalse(firstCompleted)
        XCTAssertEqual(try store.nextCursor(scope: scope), oldCursor)
        let restartedPageCompleted = try await client(http).synchronize(scope: scope, inbox: store, maximumPages: 1)
        XCTAssertFalse(restartedPageCompleted)
        XCTAssertEqual(URLComponents(url: requestURLs[1], resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "cursor" })?.value, oldCursor)
        XCTAssertEqual(try store.read(scope: scope), epochThreeRows,
            "the new epoch page may restart before the prior cursor's zone ID and replace older envelopes")
        XCTAssertEqual(try store.nextCursor(scope: scope), newCursor)
    }

    func testHigherEpochPageWithNonAdvancingRevisionIsRejectedBeforeCursorCommit() throws {
        let store = inbox(InMemoryKeychainStore())
        let currentRows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index), revision: 4, keyEpoch: 2)
        }
        let oldCursor = epochCursor(2, currentRows.last!.zoneId)
        try store.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: currentRows, nextCursor: oldCursor),
            for: scope, requestedCursor: nil)

        // A key-epoch restart may begin at an earlier zone ID, but the
        // repository's per-row revision is monotonic across epoch changes.
        // If that invariant is broken, staging must reject before changing
        // rows or committing a cursor that cannot be anchored on restart.
        let staleRows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index), revision: 3, keyEpoch: 3)
        }
        XCTAssertThrowsError(try store.stage(PCAOpaqueSafeZoneDeliveryPage(
            safeZones: staleRows, nextCursor: epochCursor(3, staleRows.last!.zoneId)),
            for: scope, requestedCursor: oldCursor)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .staleRevision)
        }
        XCTAssertEqual(try store.nextCursor(scope: scope), oldCursor)
        XCTAssertEqual(try store.read(scope: scope), currentRows)
    }

    func testSameEpochPageCannotMoveRequestedCursorBackward() throws {
        let store = inbox(InMemoryKeychainStore())
        let initialRows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index), keyEpoch: 2)
        }
        let requestedCursor = epochCursor(2, initialRows.last!.zoneId)
        try store.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: initialRows, nextCursor: requestedCursor),
            for: scope, requestedCursor: nil)

        // The response is internally sorted and self-consistent, but in the
        // current epoch it replays rows before the requested cursor and moves
        // the server cursor backward. It must not become durable.
        let backwardRows = (0..<PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index), keyEpoch: 2)
        }
        let backwardCursor = epochCursor(2, backwardRows.last!.zoneId)
        XCTAssertThrowsError(try store.stage(
            PCAOpaqueSafeZoneDeliveryPage(safeZones: backwardRows, nextCursor: backwardCursor),
            for: scope, requestedCursor: requestedCursor
        )) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .staleCursor)
        }

        let rollbackRows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index), keyEpoch: 1)
        }
        XCTAssertThrowsError(try store.stage(
            PCAOpaqueSafeZoneDeliveryPage(safeZones: rollbackRows,
                nextCursor: epochCursor(1, rollbackRows.last!.zoneId)),
            for: scope, requestedCursor: requestedCursor
        )) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .staleCursor)
        }

        var mixedEpochRows = initialRows
        mixedEpochRows[0] = row(mixedEpochRows[0].zoneId, keyEpoch: 3)
        XCTAssertThrowsError(try store.stage(
            PCAOpaqueSafeZoneDeliveryPage(safeZones: mixedEpochRows,
                nextCursor: epochCursor(2, mixedEpochRows.last!.zoneId)),
            for: scope, requestedCursor: requestedCursor
        )) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .staleCursor)
        }

        XCTAssertEqual(try store.nextCursor(scope: scope), requestedCursor)
        XCTAssertEqual(try store.read(scope: scope), initialRows)
    }

    func testEpochBoundCursorMustMatchPageAndAdvanceManifestCursorExactly() throws {
        let store = inbox(InMemoryKeychainStore())
        let rows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index), keyEpoch: 2)
        }
        let validCursor = epochCursor(2, rows.last!.zoneId)

        XCTAssertThrowsError(try store.stage(PCAOpaqueSafeZoneDeliveryPage(
            safeZones: rows, nextCursor: epochCursor(3, rows.last!.zoneId)),
            for: scope, requestedCursor: nil)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .staleCursor)
        }
        XCTAssertThrowsError(try store.stage(PCAOpaqueSafeZoneDeliveryPage(
            safeZones: rows, nextCursor: epochCursor(2, rows[rows.count - 2].zoneId)),
            for: scope, requestedCursor: nil)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .staleCursor)
        }
        XCTAssertTrue(try store.read(scope: scope).isEmpty)
        XCTAssertNil(try store.nextCursor(scope: scope))

        try store.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: rows, nextCursor: validCursor),
            for: scope, requestedCursor: nil)
        XCTAssertThrowsError(try store.stage(PCAOpaqueSafeZoneDeliveryPage(
            safeZones: rows, nextCursor: validCursor),
            for: scope, requestedCursor: validCursor)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .staleCursor,
                "a server response cannot repeat the requested cursor")
        }
        XCTAssertThrowsError(try store.stage(PCAOpaqueSafeZoneDeliveryPage(
            safeZones: rows, nextCursor: epochCursor(2, rows.last!.zoneId)),
            for: scope, requestedCursor: nil)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .staleCursor,
                "page staging requires exact requested-cursor continuity with the manifest")
        }
        XCTAssertEqual(try store.nextCursor(scope: scope), validCursor)
    }

    func testPersistedCursorMustReferToStoredZoneAndEpoch() throws {
        let rows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index), keyEpoch: 2)
        }
        let validCursor = epochCursor(2, rows.last!.zoneId)
        let invalidCursors = [
            epochCursor(3, rows.last!.zoneId),
            epochCursor(2, rows[rows.count - 2].zoneId),
            "zone-999",
            "v1~02~\(rows.last!.zoneId)",
        ]

        for invalidCursor in invalidCursors {
            let keychain = InMemoryKeychainStore()
            let store = inbox(keychain)
            try store.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: rows, nextCursor: validCursor),
                for: scope, requestedCursor: nil)
            let account = "safe-zone-delivery.v1.\(scope.storageKey).manifest"
            let original = try keychain.retrieve(forAccount: account, service: "test.pca.safe-zone-delivery.v1")
            var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: original) as? [String: Any])
            manifest["nextCursor"] = invalidCursor
            let corrupted = try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys])
            try keychain.storeReplacingAtomically(corrupted, forAccount: account,
                service: "test.pca.safe-zone-delivery.v1", accessibility: .whenUnlockedThisDeviceOnly)

            XCTAssertThrowsError(try store.nextCursor(scope: scope), "cursor \(invalidCursor) is not anchored to a stored row") {
                XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .corruptInbox)
            }
        }
    }

    func testSynchronizationDeadlineShrinksRequestTimeoutAndDoesNotStageLatePage() async throws {
        let keychain = InMemoryKeychainStore()
        let store = inbox(keychain)
        var uptime = 100.0
        var requestCount = 0
        let firstRows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index))
        }
        let firstBody = try json(firstRows.map(wire), nextCursor: firstRows.last!.zoneId)
        let lateBody = try json([wire(row("zone-017"))])
        let http = InMemoryPCAHTTPTransport { request in
            requestCount += 1
            if requestCount == 1 {
                XCTAssertEqual(request.timeoutInterval, PCADeviceSafeZoneDeliveryClient.maximumSynchronizationDuration)
                uptime += 12
                return PCAHTTPResponse(statusCode: 200, data: firstBody)
            }
            XCTAssertEqual(request.timeoutInterval, 18, accuracy: 0.001,
                "each request is capped by the remaining invocation budget")
            uptime += 19
            return PCAHTTPResponse(statusCode: 200, data: lateBody)
        }

        do {
            _ = try await client(http, monotonicNow: { uptime })
                .synchronize(scope: scope, inbox: store, maximumPages: 2,
                    absoluteMonotonicDeadline: 200)
            XCTFail("a late response must not be staged after the bounded synchronization deadline")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .transport(.timeout))
        }

        XCTAssertEqual(requestCount, 2)
        XCTAssertEqual(try store.read(scope: scope), firstRows,
            "the committed first page remains durable while the late second page is discarded")
        XCTAssertEqual(try store.nextCursor(scope: scope), firstRows.last?.zoneId)
    }

    func testCallerDeadlineShortensLocalCapAndRejectsLateResponseBeforeStaging() async throws {
        let keychain = InMemoryKeychainStore()
        let store = inbox(keychain)
        var uptime = 100.0
        var requestCount = 0
        let body = try json([wire(row())])
        let http = InMemoryPCAHTTPTransport { request in
            requestCount += 1
            XCTAssertEqual(requestCount, 1)
            XCTAssertEqual(request.timeoutInterval, 7, accuracy: 0.001,
                "the earlier caller deadline must bound the request below the local 30-second cap")
            uptime = 108
            return PCAHTTPResponse(statusCode: 200, data: body)
        }

        do {
            _ = try await client(http, monotonicNow: { uptime })
                .synchronize(scope: scope, inbox: store, absoluteMonotonicDeadline: 107)
            XCTFail("a response after the caller deadline must not be staged")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .transport(.timeout))
        }

        XCTAssertEqual(requestCount, 1)
        XCTAssertTrue(try store.read(scope: scope).isEmpty)
        XCTAssertNil(try store.nextCursor(scope: scope))
    }

    func testResponseInsideCallerDeadlineStagesWithLessThanOneSecondRemaining() async throws {
        let keychain = InMemoryKeychainStore()
        let store = inbox(keychain)
        var uptime = 100.0
        let body = try json([wire(row())])
        let http = InMemoryPCAHTTPTransport { request in
            XCTAssertEqual(request.timeoutInterval, 7, accuracy: 0.001)
            uptime = 106.5
            return PCAHTTPResponse(statusCode: 200, data: body)
        }

        let completed = try await client(http, monotonicNow: { uptime })
            .synchronize(scope: scope, inbox: store, absoluteMonotonicDeadline: 107)

        XCTAssertTrue(completed,
            "request admission needs a one-second timeout floor, but a response already received before the deadline remains usable")
        XCTAssertEqual(try store.read(scope: scope), [row()])
        XCTAssertNil(try store.nextCursor(scope: scope))
    }

    func testAlreadyCancelledSynchronizationStartsNoRequestOrInboxMutation() async throws {
        let keychain = InMemoryKeychainStore()
        let store = inbox(keychain)
        var requestCount = 0
        var sessionReadCount = 0
        let http = InMemoryPCAHTTPTransport { _ in
            requestCount += 1
            return PCAHTTPResponse(statusCode: 200, data: try self.json([self.wire(self.row())]))
        }
        let client = try PCADeviceSafeZoneDeliveryClient(
            baseURL: URL(string: "https://api.example.test")!,
            currentSession: { sessionReadCount += 1; return self.session },
            transport: http)
        let operation = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await client.synchronize(scope: self.scope, inbox: store)
        }

        do {
            _ = try await operation.value
            XCTFail("a canceled synchronization must stop before its first request")
        } catch is CancellationError {
            // Expected: cancellation is honored before session or inbox work.
        }

        XCTAssertEqual(requestCount, 0)
        XCTAssertEqual(sessionReadCount, 0, "cancellation must be observed before session or Keychain recovery work")
        XCTAssertTrue(try store.read(scope: scope).isEmpty)
        XCTAssertNil(try store.nextCursor(scope: scope))
    }

    func testPartialPageWriteKeepsCursorUnchangedAndRelaunchReplaysPageSafely() async throws {
        let keychain = InterruptingKeychainStore(failZoneWriteNumber: 4)
        let firstRows = (1...PCAKeychainSafeZoneDeliveryInbox.pageSize).map { index in
            row(String(format: "zone-%03d", index))
        }
        let firstBody = try json(firstRows.map(wire), nextCursor: firstRows.last!.zoneId)
        var requests = 0
        let http = InMemoryPCAHTTPTransport { _ in
            requests += 1
            return PCAHTTPResponse(statusCode: 200, data: firstBody)
        }
        let beforeInterruption = inbox(keychain)

        do {
            _ = try await client(http).synchronize(scope: scope, inbox: beforeInterruption, maximumPages: 1)
            XCTFail("injected mid-page Keychain failure must interrupt staging")
        } catch let error as PCADeviceSafeZoneDeliveryError {
            XCTAssertEqual(error, .persistenceUnavailable)
        }
        XCTAssertTrue(try beforeInterruption.read(scope: scope).isEmpty,
            "incomplete page records are removed during relaunch recovery")
        XCTAssertNil(try beforeInterruption.nextCursor(scope: scope),
            "a partial page must not advance the durable cursor")
        for index in 1...3 {
            let account = "safe-zone-delivery.v1.\(scope.storageKey).zone.\(String(format: "zone-%03d", index))"
            XCTAssertThrowsError(try keychain.retrieve(forAccount: account,
                service: "test.pca.safe-zone-delivery.v1"), "orphan row \(index) must be reclaimed")
        }

        let relaunchedStore = inbox(keychain)
        let resumed = try await client(http).synchronize(scope: scope, inbox: relaunchedStore, maximumPages: 1)
        XCTAssertFalse(resumed, "the full page is staged and its cursor remains for the next bounded invocation")
        XCTAssertEqual(requests, 2, "relaunch must request the page again from its original cursor")
        XCTAssertEqual(try relaunchedStore.read(scope: scope), firstRows)
        XCTAssertEqual(try relaunchedStore.nextCursor(scope: scope), "zone-016")
    }

    func testTemporaryKeychainLockIsRetryableNotCorruptAndPreservesStagedData() throws {
        let keychain = TemporarilyUnavailableKeychainStore()
        let store = inbox(keychain)
        try store.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: [row()], nextCursor: nil),
            for: scope, requestedCursor: nil)
        let manifestAccount = "safe-zone-delivery.v1.\(scope.storageKey).manifest"
        let zoneAccount = "safe-zone-delivery.v1.\(scope.storageKey).zone.zone-001"

        keychain.unavailableAccount = manifestAccount
        XCTAssertThrowsError(try store.nextCursor(scope: scope)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .persistenceUnavailable)
        }
        keychain.unavailableAccount = zoneAccount
        XCTAssertThrowsError(try store.read(scope: scope)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .persistenceUnavailable)
        }

        keychain.unavailableAccount = nil
        XCTAssertEqual(try store.read(scope: scope), [row()])
        XCTAssertNil(try store.nextCursor(scope: scope))
    }

    func testMalformedRowsAndInvalidPagingCursorAreRejectedWithoutAdvancing() async throws {
        let invalidBodies = [
            try json([wire(row()).merging(["ciphertextB64": "AQI="]) { _, new in new }]),
            try json([wire(row()).merging(["familyId": "attacker-family"]) { _, new in new }]),
            try json([wire(row())], nextCursor: "zone-not-last"),
        ]
        for body in invalidBodies {
            let keychain = InMemoryKeychainStore()
            let store = inbox(keychain)
            let http = InMemoryPCAHTTPTransport { _ in PCAHTTPResponse(statusCode: 200, data: body) }
            do {
                _ = try await client(http).synchronize(scope: scope, inbox: store)
                XCTFail("malformed response must be rejected")
            } catch {
                XCTAssertTrue(error is PCAAPIError || error is PCADeviceSafeZoneDeliveryError)
            }
            XCTAssertTrue(try store.read(scope: scope).isEmpty)
            XCTAssertNil(try store.nextCursor(scope: scope))
        }
    }

    func testPageRejectsEscapedDuplicateDecodedMemberBeforeStaging() async throws {
        let keychain = InMemoryKeychainStore()
        let store = inbox(keychain)
        let valid = String(decoding: try json([wire(row())]), as: UTF8.self)
        let field = "\"zoneId\":\"zone-001\""
        XCTAssertTrue(valid.contains(field))
        let duplicate = valid.replacingOccurrences(
            of: field,
            with: "\"zoneId\":\"zone-001\",\"zone\\u0049d\":\"attacker-zone\""
        )
        XCTAssertNotEqual(duplicate, valid)
        let http = InMemoryPCAHTTPTransport { _ in PCAHTTPResponse(statusCode: 200, data: Data(duplicate.utf8)) }

        do {
            _ = try await client(http).synchronize(scope: scope, inbox: store)
            XCTFail("escaped duplicate member in a server page must be rejected")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
        XCTAssertTrue(try store.read(scope: scope).isEmpty)
        XCTAssertNil(try store.nextCursor(scope: scope))
    }

    func testPersistedRowsAndManifestRejectEscapedDuplicateDecodedMembers() throws {
        let rowKeychain = InMemoryKeychainStore()
        let rowStore = inbox(rowKeychain)
        try rowStore.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: [row()], nextCursor: nil),
            for: scope, requestedCursor: nil)
        let rowAccount = "safe-zone-delivery.v1.\(scope.storageKey).zone.zone-001"
        let validRow = String(decoding: try rowKeychain.retrieve(forAccount: rowAccount,
            service: "test.pca.safe-zone-delivery.v1"), as: UTF8.self)
        let rowField = "\"zoneId\":\"zone-001\""
        XCTAssertTrue(validRow.contains(rowField))
        let duplicateRow = validRow.replacingOccurrences(
            of: rowField,
            with: "\"zoneId\":\"zone-001\",\"zone\\u0049d\":\"attacker-zone\""
        )
        try rowKeychain.storeReplacingAtomically(Data(duplicateRow.utf8), forAccount: rowAccount,
            service: "test.pca.safe-zone-delivery.v1", accessibility: .whenUnlockedThisDeviceOnly)
        XCTAssertThrowsError(try rowStore.read(scope: scope)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .corruptInbox)
        }

        let manifestKeychain = InMemoryKeychainStore()
        let manifestStore = inbox(manifestKeychain)
        try manifestStore.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: [row()], nextCursor: nil),
            for: scope, requestedCursor: nil)
        let manifestAccount = "safe-zone-delivery.v1.\(scope.storageKey).manifest"
        let validManifest = String(decoding: try manifestKeychain.retrieve(forAccount: manifestAccount,
            service: "test.pca.safe-zone-delivery.v1"), as: UTF8.self)
        let versionField = "\"version\":1"
        XCTAssertTrue(validManifest.contains(versionField))
        let duplicateManifest = validManifest.replacingOccurrences(
            of: versionField,
            with: "\"version\":1,\"vers\\u0069on\":1"
        )
        try manifestKeychain.storeReplacingAtomically(Data(duplicateManifest.utf8),
            forAccount: manifestAccount, service: "test.pca.safe-zone-delivery.v1",
            accessibility: .whenUnlockedThisDeviceOnly)
        XCTAssertThrowsError(try manifestStore.nextCursor(scope: scope)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .corruptInbox)
        }
    }

    func testRevisionReplayNeverRollsBackAndEqualRevisionConflictDoesNotAdvance() throws {
        let store = inbox(InMemoryKeychainStore())
        try store.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: [row(revision: 4)], nextCursor: nil), for: scope, requestedCursor: nil)
        try store.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: [row(ciphertext: "BAUG", revision: 3)], nextCursor: nil), for: scope, requestedCursor: nil)
        XCTAssertEqual(try store.read(scope: scope), [row(revision: 4)])
        XCTAssertThrowsError(try store.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: [row(ciphertext: "BAUG", revision: 4)], nextCursor: nil), for: scope, requestedCursor: nil)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .conflictingRevision)
        }
        XCTAssertEqual(try store.read(scope: scope), [row(revision: 4)])
    }

    func testScopeChangeAfterNetworkResponsePreventsStaging() async throws {
        let keychain = InMemoryKeychainStore()
        var currentScope: PCADeviceSafeZoneDeliveryScope? = scope
        let store = PCAKeychainSafeZoneDeliveryInbox(keychain: keychain, serviceNamespace: "test.pca") { currentScope }
        let body = try json([wire(row())])
        let http = InMemoryPCAHTTPTransport { _ in
            currentScope = self.otherScope
            return PCAHTTPResponse(statusCode: 200, data: body)
        }
        do {
            _ = try await client(http).synchronize(scope: scope, inbox: store)
            XCTFail("changed enrollment scope must prevent staging")
        } catch {
            XCTAssertEqual(error as? PCADeviceSafeZoneDeliveryError, .scopeChanged)
        }
        XCTAssertTrue(try inbox(keychain, scope: otherScope).read(scope: otherScope).isEmpty)
    }

    func testScopeChangeDuringKeychainReadDoesNotReturnPriorScopeDataOrCursor() throws {
        let keychain = ScopeChangingKeychainStore()
        var activeScope: PCADeviceSafeZoneDeliveryScope? = scope
        let store = PCAKeychainSafeZoneDeliveryInbox(keychain: keychain, serviceNamespace: "safe-zone-read-scope") {
            activeScope
        }
        try store.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: [row()], nextCursor: nil),
            for: scope, requestedCursor: nil)

        var changedDuringRecordRead = false
        keychain.afterRetrieve = { account, _ in
            guard account.contains(".zone.") else { return }
            guard !changedDuringRecordRead else { return }
            changedDuringRecordRead = true
            activeScope = self.otherScope
        }
        XCTAssertThrowsError(try store.read(scope: scope)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .scopeChanged)
        }

        activeScope = scope
        var changedDuringManifestRead = false
        keychain.afterRetrieve = { account, _ in
            guard account.hasSuffix(".manifest") else { return }
            guard !changedDuringManifestRead else { return }
            changedDuringManifestRead = true
            activeScope = self.otherScope
        }
        XCTAssertThrowsError(try store.nextCursor(scope: scope)) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .scopeChanged)
        }
    }

    func testAuthenticationFailureAndRelaunchCursorAreNotMisrepresentedAsApplication() async throws {
        let keychain = InMemoryKeychainStore()
        let store = inbox(keychain)
        let body = try json([wire(row())])
        let http = InMemoryPCAHTTPTransport { _ in PCAHTTPResponse(statusCode: 401, data: body) }
        do {
            _ = try await client(http).synchronize(scope: scope, inbox: store)
            XCTFail("unauthorized session must fail")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .unauthorized)
        }
        XCTAssertTrue(try store.read(scope: scope).isEmpty)
    }

    func testInboxStagesMoreThan128SafeZonesAcrossResumablePages() async throws {
        let keychain = InMemoryKeychainStore()
        let firstStore = inbox(keychain)
        var pageIndex = 0
        let http = InMemoryPCAHTTPTransport { _ in
            let lower = pageIndex * PCAKeychainSafeZoneDeliveryInbox.pageSize + 1
            let upper = min(lower + PCAKeychainSafeZoneDeliveryInbox.pageSize - 1, 129)
            let rows = (lower...upper).map { self.row(String(format: "zone-%03d", $0)) }
            let next = upper < 129 ? rows.last!.zoneId : nil
            pageIndex += 1
            let nextCursor: Any
            if let next { nextCursor = next } else { nextCursor = NSNull() }
            return PCAHTTPResponse(statusCode: 200, data: try self.json(rows.map(self.wire), nextCursor: nextCursor))
        }

        let firstCompleted = try await client(http).synchronize(scope: scope, inbox: firstStore, maximumPages: 8)
        XCTAssertFalse(firstCompleted)
        XCTAssertEqual(try firstStore.read(scope: scope).count, 128)
        XCTAssertEqual(try firstStore.nextCursor(scope: scope), "zone-128")

        let relaunchedStore = inbox(keychain)
        let secondCompleted = try await client(http).synchronize(scope: scope, inbox: relaunchedStore, maximumPages: 1)
        XCTAssertTrue(secondCompleted)
        XCTAssertEqual(try relaunchedStore.read(scope: scope).count, 129)
        XCTAssertNil(try relaunchedStore.nextCursor(scope: scope))
    }

    func testEncodedStorageLimitRejectsPageWithoutAdvancingCursor() throws {
        let store = inbox(InMemoryKeychainStore())
        let maxCiphertext = Data(repeating: 0x5A, count: 65_535).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        var cursor: String?
        for pageIndex in 0..<2 {
            let lower = pageIndex * PCAKeychainSafeZoneDeliveryInbox.pageSize + 1
            let rows = (lower..<(lower + PCAKeychainSafeZoneDeliveryInbox.pageSize)).map {
                row(String(format: "large-%03d", $0), ciphertext: maxCiphertext)
            }
            let next = rows.last!.zoneId
            try store.stage(PCAOpaqueSafeZoneDeliveryPage(safeZones: rows, nextCursor: next),
                for: scope, requestedCursor: cursor)
            cursor = next
        }

        let lower = 2 * PCAKeychainSafeZoneDeliveryInbox.pageSize + 1
        let oversizedPage = (lower..<(lower + PCAKeychainSafeZoneDeliveryInbox.pageSize)).map {
            row(String(format: "large-%03d", $0), ciphertext: maxCiphertext)
        }
        XCTAssertThrowsError(try store.stage(
            PCAOpaqueSafeZoneDeliveryPage(safeZones: oversizedPage, nextCursor: oversizedPage.last!.zoneId),
            for: scope, requestedCursor: cursor
        )) {
            XCTAssertEqual($0 as? PCADeviceSafeZoneDeliveryError, .persistenceUnavailable)
        }
        XCTAssertEqual(try store.read(scope: scope).count, 32)
        XCTAssertEqual(try store.nextCursor(scope: scope), cursor)
    }
}
