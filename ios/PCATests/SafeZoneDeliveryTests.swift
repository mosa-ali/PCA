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

    private func row(_ id: String = "zone-001", ciphertext: String = "AQID", revision: UInt32 = 1) -> PCAOpaqueSafeZoneDelivery {
        PCAOpaqueSafeZoneDelivery(zoneId: id, ciphertextB64: ciphertext, nonceB64: "AAECAwQFBgcICQoL",
            keyEpoch: 2, revision: revision, deliveryState: "PENDING_OFFLINE", updatedAtUtc: "2026-10-10T10:20:30.000Z")
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
