import XCTest
@testable import PCA

final class PCAInboundReplayReclaimerBatchTests: XCTestCase {
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
}
