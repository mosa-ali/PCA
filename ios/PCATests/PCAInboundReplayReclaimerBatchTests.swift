import XCTest
@testable import PCA

final class PCAInboundReplayReclaimerBatchTests: XCTestCase {
    @MainActor func testPullRejectsEscapedDuplicateEnvelopeEpochBeforeInboxCapture() async throws {
        let body = Data(#"{"scope":{"familyId":"family-1","recipientDeviceId":"device-1"},"applied":[{"protocolMajor":1,"protocolMinor":0,"messageId":"message-1","familyId":"family-1","senderDeviceId":"sender-1","recipientDeviceId":"device-1","senderKeyId":"key-1","messageType":"POLICY_UPDATE","trustSetEpoch":1,"trustSet\u0045poch":2,"keyEpoch":1,"sequenceOrNonce":"1","issuedAt":"2026-10-01T00:00:00.000Z","expiresAt":"2026-10-01T00:01:00.000Z","semanticVersion":"1.0.0","payload":"AQID","signature":"signature-1"}],"unparseableMessageIds":[],"droppedForListBound":[]}"#.utf8)
        let transport = InMemoryPCAHTTPTransport { _ in PCAHTTPResponse(statusCode: 200, data: body) }
        let client = try PCADeviceRuntimeSyncClient(
            baseURL: URL(string: "https://api.example.test")!, transport: transport)
        let session = PCADeviceSession(deviceId: "device-1", sessionToken: String(repeating: "A", count: 43),
            expiresAt: Date().addingTimeInterval(3_600))
        let keychain = CountingKeychainStore()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain,
            serviceNamespace: "runtime-sync-duplicate-epoch")

        do {
            let response = try await client.pull(session: session)
            try inbox.capture(response, sessionDeviceId: session.deviceId)
            XCTFail("an inbound envelope with duplicate decoded epoch names must not reach inbox capture")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
        XCTAssertEqual(keychain.writeCount, 0,
            "a malformed response must be rejected before inbox persistence; avoid treating a Keychain read failure as an empty inbox")
    }

    @MainActor func testBoundedReclaimUsesBatchKeychainWritesAndPreservesUnacknowledgedTerminal() async throws {
        let keychain = CountingKeychainStore()
        let scope = PCAInboundScope(familyId: "family-1", recipientDeviceId: "device-1")
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "reclaimer-batch")
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "reclaimer-batch")
        let now = Date(timeIntervalSince1970: 1_760_000_000)

        for index in 0..<64 {
            let response = try inboundResponse(id: "message-\(index)", nonce: String(index + 1))
            let envelope = try XCTUnwrap(response.applied.first)
            try inbox.capture(response, sessionDeviceId: scope.recipientDeviceId)
            if index < 63 { try inbox.markAcknowledged(envelope, scope: scope) }

            let intent = PCAInboundApplicationIntent(operationId: UUID().uuidString.lowercased(), scope: scope,
                envelope: envelope, authorityBinding: Data("authority".utf8),
                acceptedCommandBinding: Data("command".utf8), preparedAt: now)
            try journal.prepare(intent)
            try journal.complete(intent, outcome: .applied, at: now)
        }

        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "reclaimer-batch",
            expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let boundary = PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]),
            minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 64)])
        try denial.install(boundary, assertAuthority: {})
        let reclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial,
            verifier: FixedRetirementVerifier(boundary: boundary))

        keychain.resetCounters()
        let reclaimed = try await reclaimer.reclaim(scope: scope, assertAuthority: {})

        XCTAssertEqual(reclaimed, 63)
        XCTAssertLessThanOrEqual(keychain.writeCount, 16,
            "64 journal/inbox records should be reclaimed with bounded snapshot writes")
        XCTAssertLessThanOrEqual(keychain.readCount, 72,
            "Keychain reads should scale with snapshots, not each record")

        let pending = try inbox.pendingCrypto(scope: scope)
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(pending.first?.envelope.messageId, "message-63")
        XCTAssertFalse(try XCTUnwrap(pending.first).relayAcknowledged)
        let remaining = try journal.records()
        XCTAssertEqual(remaining.count, 1)
        XCTAssertEqual(remaining.first?.intent.envelope.messageId, "message-63")
        XCTAssertTrue(try denial.coversReplayIdentityPermanently(
            try XCTUnwrap(pending.first).envelope, scope: scope))
    }

    @MainActor func testInboxOnlyReclaimBatches256AcknowledgedAliases() async throws {
        let keychain = CountingKeychainStore()
        let scope = PCAInboundScope(familyId: "family-1", recipientDeviceId: "device-1")
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "reclaimer-inbox-only-batch")
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "reclaimer-inbox-only-batch")
        let aliases = try (1...256).map { index in
            try XCTUnwrap(inboundResponse(id: "alias-\(index)", nonce: String(index)).applied.first)
        }
        try inbox.capture(PCAInboundRuntimeSyncResponse(scope: scope, applied: aliases,
            unparseableMessageIds: [], droppedForListBound: []), sessionDeviceId: scope.recipientDeviceId)
        try inbox.markAcknowledged(aliases, scope: scope)

        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "reclaimer-inbox-only-batch",
            expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let boundary = PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]),
            minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 256)])
        try denial.install(boundary, assertAuthority: {})
        let reclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial,
            verifier: FixedRetirementVerifier(boundary: boundary))

        keychain.resetCounters()
        let reclaimed = try await reclaimer.reclaim(scope: scope, assertAuthority: {})

        XCTAssertEqual(reclaimed, 256)
        XCTAssertLessThanOrEqual(keychain.writeCount, 10,
            "256 inbox-only aliases should be reclaimed with bounded snapshot writes")
        XCTAssertLessThanOrEqual(keychain.readCount, 72,
            "Keychain reads should be bounded by snapshots, not alias count")
        XCTAssertTrue(try inbox.pendingCrypto(scope: scope).isEmpty)
        XCTAssertTrue(try journal.records().isEmpty)
        XCTAssertTrue(try denial.coversReplayIdentityPermanently(aliases[0], scope: scope))
    }

    @MainActor func testRestartResumesWhenInboxDeletionCommittedButReadbackFailed() async throws {
        let keychain = CommitThenUnreadableKeychainStore()
        let scope = PCAInboundScope(familyId: "family-1", recipientDeviceId: "device-1")
        let response = try inboundResponse(id: "terminal-after-ambiguous-write", nonce: "1")
        let envelope = try XCTUnwrap(response.applied.first)
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "reclaimer-ambiguous-inbox-write")
        try inbox.capture(response, sessionDeviceId: scope.recipientDeviceId)
        try inbox.markAcknowledged(envelope, scope: scope)

        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "reclaimer-ambiguous-inbox-write")
        let intent = PCAInboundApplicationIntent(operationId: UUID().uuidString.lowercased(), scope: scope,
            envelope: envelope, authorityBinding: Data("authority".utf8),
            acceptedCommandBinding: Data("command".utf8), preparedAt: Date(timeIntervalSince1970: 1_760_000_000))
        try journal.prepare(intent)
        try journal.complete(intent, outcome: .applied, at: intent.preparedAt)

        let denial = PCAInboundReplayDenialLedger(keychain: keychain,
            serviceNamespace: "reclaimer-ambiguous-inbox-write", expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let boundary = PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]),
            minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 1)])
        let verifier = FixedRetirementVerifier(boundary: boundary)

        keychain.failNextInboxReadbackAfterReplace = true
        let firstReclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial,
            verifier: verifier)
        do {
            _ = try await firstReclaimer.reclaim(scope: scope, assertAuthority: {})
            XCTFail("A committed inbox replacement with unavailable readback must remain an uncertain failure")
        } catch { }

        XCTAssertTrue(try inbox.pendingCrypto(scope: scope).isEmpty,
            "the Keychain replacement committed before its readback became unavailable")
        XCTAssertEqual(try journal.records().count, 1,
            "the terminal receipt must remain until a later process proves ciphertext absence")

        // Reconstruct all stores to model process death. The next run observes
        // the committed inbox snapshot and safely completes journal retirement.
        let restoredInbox = PCAKeychainInboundInboxStore(keychain: keychain,
            serviceNamespace: "reclaimer-ambiguous-inbox-write")
        let restoredJournal = PCAInboundApplicationJournal(keychain: keychain,
            serviceNamespace: "reclaimer-ambiguous-inbox-write")
        let restoredDenial = PCAInboundReplayDenialLedger(keychain: keychain,
            serviceNamespace: "reclaimer-ambiguous-inbox-write", expectedDeviceId: scope.recipientDeviceId)
        let restoredReclaimer = try PCAInboundReplayReclaimer(journal: restoredJournal, inbox: restoredInbox,
            denial: restoredDenial, verifier: verifier)
        let resumed = try await restoredReclaimer.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(resumed, 1)
        XCTAssertTrue(try restoredJournal.records().isEmpty)
        XCTAssertTrue(try restoredInbox.pendingCrypto(scope: scope).isEmpty)
        XCTAssertTrue(try restoredDenial.coversReplayIdentityPermanently(envelope, scope: scope))
    }

    @MainActor func testInboxOnlyBatchRestartResumesAfterCommittedDeletionReadbackFailure() async throws {
        let serviceNamespace = "reclaimer-inbox-only-ambiguous-write"
        let keychain = CommitThenUnreadableKeychainStore(serviceNamespace: serviceNamespace)
        let scope = PCAInboundScope(familyId: "family-1", recipientDeviceId: "device-1")
        let response = try inboundResponse(id: "inbox-only-after-ambiguous-write", nonce: "1")
        let envelope = try XCTUnwrap(response.applied.first)
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: serviceNamespace)
        try inbox.capture(response, sessionDeviceId: scope.recipientDeviceId)
        try inbox.markAcknowledged(envelope, scope: scope)
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: serviceNamespace)
        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: serviceNamespace,
            expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let boundary = PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]),
            minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 1)])
        let verifier = FixedRetirementVerifier(boundary: boundary)

        keychain.failNextInboxReadbackAfterReplace = true
        let firstReclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial,
            verifier: verifier)
        do {
            _ = try await firstReclaimer.reclaim(scope: scope, assertAuthority: {})
            XCTFail("A committed inbox-only deletion with unavailable readback must remain an uncertain failure")
        } catch { }

        XCTAssertTrue(try inbox.pendingCrypto(scope: scope).isEmpty,
            "the batched deletion committed even though its readback was unavailable")
        XCTAssertTrue(try journal.records().isEmpty,
            "inbox-only ciphertext has no journal record to remove")
        XCTAssertTrue(try denial.coversReplayIdentityPermanently(envelope, scope: scope),
            "the permanent denial boundary survives the ambiguous ciphertext deletion")

        let restoredInbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: serviceNamespace)
        let restoredJournal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: serviceNamespace)
        let restoredDenial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: serviceNamespace,
            expectedDeviceId: scope.recipientDeviceId)
        let restoredReclaimer = try PCAInboundReplayReclaimer(journal: restoredJournal, inbox: restoredInbox,
            denial: restoredDenial, verifier: verifier)
        let resumed = try await restoredReclaimer.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(resumed, 0,
            "restart treats the already-committed inbox-only deletion as an idempotent no-op")
        XCTAssertTrue(try restoredInbox.pendingCrypto(scope: scope).isEmpty)
        XCTAssertTrue(try restoredDenial.coversReplayIdentityPermanently(envelope, scope: scope))
    }

    private func inboundResponse(id: String, nonce: String) throws -> PCAInboundRuntimeSyncResponse {
        let envelope: [String: Any] = [
            "protocolMajor": 1, "protocolMinor": 0, "messageId": id,
            "familyId": "family-1", "senderDeviceId": "sender-1", "recipientDeviceId": "device-1",
            "senderKeyId": "key-1", "messageType": "STATUS_SNAPSHOT", "trustSetEpoch": 1, "keyEpoch": 1,
            "sequenceOrNonce": nonce, "issuedAt": "2026-10-01T00:00:00.000Z",
            "expiresAt": "2026-10-01T00:01:00.000Z", "semanticVersion": "1.0.0",
            "payload": "AQID", "signature": "signature-1"
        ]
        let data = try JSONSerialization.data(withJSONObject: [
            "scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
            "applied": [envelope], "unparseableMessageIds": [], "droppedForListBound": []
        ])
        return try JSONDecoder().decode(PCAInboundRuntimeSyncResponse.self, from: data)
    }

    @MainActor private final class FixedRetirementVerifier: PCAInboundRetirementVerifying {
        private let boundary: PCAInboundReplayRetirementBoundary
        init(boundary: PCAInboundReplayRetirementBoundary) { self.boundary = boundary }
        func verify(scope: PCAInboundScope) async throws -> PCAInboundRetirementVerification {
            guard scope == boundary.scope else { return .unavailable }
            return .accepted(boundary: boundary, revalidateAuthority: {})
        }
    }

    private final class CountingKeychainStore: KeychainStoreProtocol {
        private let backing = InMemoryKeychainStore()
        private(set) var readCount = 0
        private(set) var writeCount = 0

        func resetCounters() { readCount = 0; writeCount = 0 }

        func store(_ data: Data, forAccount account: String, service: String,
                   accessibility: KeychainAccessibility) throws {
            writeCount += 1
            try backing.store(data, forAccount: account, service: service, accessibility: accessibility)
        }

        func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String,
                                      accessibility: KeychainAccessibility) throws {
            writeCount += 1
            try backing.storeReplacingAtomically(data, forAccount: account, service: service, accessibility: accessibility)
        }

        func retrieve(forAccount account: String, service: String) throws -> Data {
            readCount += 1
            return try backing.retrieve(forAccount: account, service: service)
        }

        func delete(forAccount account: String, service: String) throws {
            try backing.delete(forAccount: account, service: service)
        }
    }

    private final class CommitThenUnreadableKeychainStore: KeychainStoreProtocol {
        private let backing = InMemoryKeychainStore()
        var failNextInboxReadbackAfterReplace = false {
            didSet {
                if failNextInboxReadbackAfterReplace {
                    inboxReplacementsUntilReadbackFailure = 2
                }
            }
        }
        private var inboxReadbackUnavailable = false
        private var inboxReplacementsUntilReadbackFailure = 0
        private let inboxAccount = "current.ciphertext-inbox"
        private let inboxService: String

        init(serviceNamespace: String = "reclaimer-ambiguous-inbox-write") {
            inboxService = serviceNamespace + ".ciphertext-inbox"
        }

        func store(_ data: Data, forAccount account: String, service: String,
                   accessibility: KeychainAccessibility) throws {
            try backing.store(data, forAccount: account, service: service, accessibility: accessibility)
        }

        func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String,
                                      accessibility: KeychainAccessibility) throws {
            try backing.storeReplacingAtomically(data, forAccount: account, service: service,
                accessibility: accessibility)
            if failNextInboxReadbackAfterReplace && account == inboxAccount && service == inboxService {
                inboxReplacementsUntilReadbackFailure -= 1
                if inboxReplacementsUntilReadbackFailure == 0 {
                    failNextInboxReadbackAfterReplace = false
                    inboxReadbackUnavailable = true
                }
            }
        }

        func retrieve(forAccount account: String, service: String) throws -> Data {
            if inboxReadbackUnavailable && account == inboxAccount && service == inboxService {
                inboxReadbackUnavailable = false
                throw KeychainStoreError.unexpectedStatus(-1)
            }
            return try backing.retrieve(forAccount: account, service: service)
        }

        func delete(forAccount account: String, service: String) throws {
            try backing.delete(forAccount: account, service: service)
        }
    }
}
