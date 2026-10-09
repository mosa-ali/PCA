import XCTest
import Foundation
@testable import PCA

final class OrdinaryTrustSetCoordinatorTests: XCTestCase {
    private final class Store: OrdinaryTrustSetStoring {
        var value: OrdinaryTrustSetRecord
        var fail = false
        init(_ value: OrdinaryTrustSetRecord) { self.value = value }
        func load() throws -> OrdinaryTrustSetRecord { value }
        func save(_ value: OrdinaryTrustSetRecord) throws {
            if fail { throw OrdinaryTrustSetError.malformedState }
            self.value = value
        }
        func compareAndSetDurably(expected: OrdinaryTrustSetRecord?, next: OrdinaryTrustSetRecord) throws -> Bool {
            guard expected == value else { return false }
            try save(next); return value == next
        }
        func confirmDurable(_ expected: OrdinaryTrustSetRecord) throws -> Bool { value == expected }

    }
    private final class Signer: FirstDeviceDskSigning {
        var calls = 0
        func signCanonical(alias: String, message: Data) throws -> Data { calls += 1; return Data(repeating: 7, count: 64) }
    }
    private struct Verifier: OrdinaryTrustSetSignatureVerifying {
        var accepted = true
        func verify(signature: String, canonicalBytes: Data, publicKey: String) throws -> Bool { accepted }
    }
    private final class Transport: OrdinaryTrustSetTransport {
        var sent: [OrdinaryTrustSetPending] = []
        var failure = false
        var beforeReply: (() -> Void)?
        var statusValue: OrdinaryTrustSetSubmissionResult = .unknown
        var head: OrdinaryTrustSetHead?
        var records: [Int: OrdinaryTrustSetHead] = [:]
        func submit(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult {
            sent.append(request)
            if failure { throw PCAHTTPTransportError.timeout }
            beforeReply?()
            return .accepted(request.candidate)
        }
        func status(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult { statusValue }
        func acceptedRecord(familyId: String, epoch: Int) async throws -> OrdinaryTrustSetHead { guard let value = records[epoch] else { throw PCAAPIError.unavailable }; return value }
        func acceptedHead(familyId: String) async throws -> OrdinaryTrustSetHead { guard let value = head else { throw PCAAPIError.unavailable }; return value }
    }
    private func epoch(_ number: Int, family: String = "family-test", key: Int = 1) -> UntrustedTrustSetEpoch {
        UntrustedTrustSetEpoch(familyId: family, trustSetEpoch: number, keyEpoch: key,
            entries: [UntrustedTrustSetEntry(deviceId: "owner-device", role: .owner, dskKeyId: "owner-dsk", dskPublicKey: "public-dsk",
                dekKeyId: "owner-dek", dekPublicKey: "public-dek", status: .active)],
            issuedAt: "2026-10-09T00:00:00.000Z", supersedesEpoch: number == 1 ? nil : number - 1)
    }
    private func fixture(verifier: Verifier = Verifier()) throws -> (Store, Signer, Transport, OrdinaryTrustSetCoordinator) {
        let head = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(1)), signature: "accepted-root")
        let store = Store(OrdinaryTrustSetRecord(head: head)), signer = Signer(), transport = Transport()
        return (store, signer, transport, OrdinaryTrustSetCoordinator(store: store, signer: signer, verifier: verifier,
            transport: transport, familyId: "family-test", deviceId: "owner-device", dskKeyId: "owner-dsk", dskAlias: "pca.dsk.attempt"))
    }
    func testPersistBeforeSendAndRestartRetryNeverResigns() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        XCTAssertTrue(transport.sent.isEmpty)
        let pending = try XCTUnwrap(store.value.pending)
        transport.failure = true
        do { _ = try await coordinator.submitPending(); XCTFail("timeout expected") } catch {}
        XCTAssertEqual(store.value.pending, pending)
        transport.failure = false
        let restarted = OrdinaryTrustSetCoordinator(store: store, signer: signer, verifier: Verifier(), transport: transport,
            familyId: "family-test", deviceId: "owner-device", dskKeyId: "owner-dsk", dskAlias: "pca.dsk.attempt")
        _ = try await restarted.submitPending()
        XCTAssertEqual(transport.sent, [pending, pending])
        XCTAssertEqual(signer.calls, 1)
        XCTAssertNil(store.value.pending)
        XCTAssertEqual(try store.value.head.epoch().trustSetEpoch, 2)
    }
    func testPersistenceFailureNeverSendsAndPreservesHead() async throws {
        let (store, _, transport, coordinator) = try fixture()
        let original = store.value
        store.fail = true
        do { try await coordinator.prepare(epoch(2)); XCTFail("failure expected") } catch {}
        XCTAssertEqual(store.value, original)
        XCTAssertTrue(transport.sent.isEmpty)
    }
    func testUnknownStatusPreservesExactPendingAndLostResponseRecoveryClearsOnlyExactRequest() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        let unknown = try await coordinator.reconcile()
        XCTAssertFalse(unknown)
        XCTAssertEqual(store.value.pending, pending)
        transport.statusValue = .accepted(pending.candidate)
        let accepted = try await coordinator.reconcile()
        XCTAssertTrue(accepted)
        XCTAssertNil(store.value.pending)
        XCTAssertEqual(signer.calls, 1)
    }
    func testInvalidSignatureCannotPersistOrSend() async throws {
        let (store, _, transport, coordinator) = try fixture(verifier: Verifier(accepted: false))
        do { try await coordinator.prepare(epoch(2)); XCTFail("signature rejection expected") } catch {}
        XCTAssertNil(store.value.pending)
        XCTAssertTrue(transport.sent.isEmpty)
    }
    func testRollbackCrossFamilyAndSkippingRejectedBeforeSigning() async throws {
        let (_, signer, _, coordinator) = try fixture()
        for candidate in [epoch(1), epoch(3), epoch(2, family: "another-family"), epoch(2, key: 0)] {
            do { try await coordinator.prepare(candidate); XCTFail("invalid candidate accepted") } catch {}
        }
        XCTAssertEqual(signer.calls, 0)
    }
    func testConflictingStatusAndConcurrentPrepareCannotReplacePending() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        do { try await coordinator.prepare(epoch(2)); XCTFail("pending replacement accepted") } catch {}
        transport.statusValue = .accepted(OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: pending.candidate.canonicalBytes, signature: "different"))
        do { _ = try await coordinator.reconcile(); XCTFail("conflict accepted") } catch {}
        XCTAssertEqual(store.value.pending, pending)
        XCTAssertEqual(signer.calls, 1)
    }
    func testAPIUsesApprovedBodyAndRejectsMalformedProjectedMetadata() async throws {
        let (store, _, _, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        let signature = Data(repeating: 7, count: 64).base64EncodedString()
        var record: [String: Any] = ["canonicalEpochBase64": pending.candidate.canonicalBytes.base64EncodedString(),
            "signatureBase64": signature, "signerDeviceId": "owner-device", "signerKeyId": "owner-dsk",
            "trustSetEpoch": 2, "keyEpoch": 1]
        let acceptedResponse = try JSONSerialization.data(withJSONObject: ["outcome": "ACCEPTED", "acceptedEpoch": record, "acceptedHead": record])
        let http = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in PCAHTTPResponse(statusCode: 200, data: acceptedResponse) }
        let client = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!, familyId: "family-test",
            sessionToken: { "device-session" }, http: http)
        let result = try await client.submit(pending)
        guard case let .accepted(head) = result else { return XCTFail("acceptance missing") }
        XCTAssertEqual(head, pending.candidate)
        let request = try XCTUnwrap(http.requests.first)
        XCTAssertEqual(request.url?.path, "/api/device/families/family-test/trust-set/epochs")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer device-session")
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String:String])
        XCTAssertEqual(Set(body.keys), Set(["canonicalEpochBase64", "signatureBase64"]))
        XCTAssertEqual(body["signatureBase64"], signature)
        record["trustSetEpoch"] = 3
        let corruptResponse = try JSONSerialization.data(withJSONObject: ["outcome": "ACCEPTED", "acceptedEpoch": record, "acceptedHead": record])
        let corruptHTTP = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in PCAHTTPResponse(statusCode: 200, data: corruptResponse) }
        let corrupt = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!, familyId: "family-test",
            sessionToken: { "device-session" }, http: corruptHTTP)
        do { _ = try await corrupt.submit(pending); XCTFail("corrupt projection accepted") } catch {}
    }

    func testCatchUpWalksSkippedEpochPredecessorsAndPersistsOnlyVerifiedProgress() async throws {
        let (store, _, transport, coordinator) = try fixture()
        let third = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 3, keyEpoch: 1,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: 1)
        let eighth = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 8, keyEpoch: 2,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: 3)
        transport.records[3] = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(third), signature: "third")
        transport.head = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(eighth), signature: "eighth")
        let bounded = try await coordinator.catchUp(maximumRecords: 1)
        XCTAssertFalse(bounded)
        XCTAssertEqual(try store.value.head.epoch().trustSetEpoch, 1)
        let complete = try await coordinator.catchUp()
        XCTAssertTrue(complete)
        XCTAssertEqual(try store.value.head.epoch().trustSetEpoch, 8)
    }
    func testCatchUpRefusesUnanchoredOrBadSignatureHeadWithoutChangingFloor() async throws {
        let (store, _, transport, coordinator) = try fixture(verifier: Verifier(accepted: false))
        transport.head = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(2)), signature: "bad")
        let original = store.value
        do { _ = try await coordinator.catchUp(); XCTFail("invalid signature accepted") } catch {}
        XCTAssertEqual(store.value, original)
    }

    func testStaleNetworkResponseCannotOverwriteAdvancedCustody() async throws {
        let (store, _, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        let advanced = OrdinaryTrustSetRecord(head: OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(3)), signature: "third"))
        transport.beforeReply = { store.value = advanced }
        do { _ = try await coordinator.submitPending(); XCTFail("stale CAS should reject") } catch {}
        XCTAssertEqual(store.value, advanced)
        XCTAssertEqual(transport.sent, [pending])
    }

    private func committedRoot() throws -> FirstDeviceRootRecord {
        let owner = epoch(1).entries[0]
        let seed = FirstDeviceCeremonySeed(attemptId: "attempt", attemptRecoveryToken: "", serverBaseUrl: "https://api.example.test",
            deviceId: owner.deviceId, signingKeyId: owner.dskKeyId, encryptionKeyId: owner.dekKeyId,
            dskPublicKeyBase64: owner.dskPublicKey, dekPublicKeyBase64: owner.dekPublicKey, dskAlias: "pca.dsk.attempt", dekAlias: "pca.dek.attempt")
        return FirstDeviceRootRecord(seed: seed, state: .rootCommitted, familyId: "family-test", committedAtMillis: 1,
            acceptedEpoch1: FirstDeviceAcceptedEpochAnchor(canonicalBytes: String(decoding: try FamilyTrustSetCodec.canonicalize(epoch(1)), as: UTF8.self), signature: "root-signature"))
    }
    func testConfirmedBootstrapSeedsExactSignedAnchorAndNeverResetsAdvancedHead() throws {
        let root = try committedRoot()
        let roots = InMemoryFirstDeviceRootStore(record: root)
        let custody = KeychainOrdinaryTrustSetStore(keychain: InMemoryKeychainStore(), account: "owner-device")
        let head = try OrdinaryTrustSetBootstrapAnchor.seed(rootStore: roots, ordinaryStore: custody, verifier: Verifier())
        XCTAssertEqual(head.canonicalBytes, Data(try XCTUnwrap(root.acceptedEpoch1).canonicalBytes.utf8))
        XCTAssertEqual(try custody.load().rootAnchor, head)
        let current = try custody.load()
        let advanced = OrdinaryTrustSetRecord(head: OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(2)), signature: "epoch-two"), rootAnchor: head)
        XCTAssertTrue(try custody.compareAndSetDurably(expected: current, next: advanced))
        let reseeded = try OrdinaryTrustSetBootstrapAnchor.seed(rootStore: roots, ordinaryStore: custody, verifier: Verifier())
        XCTAssertEqual(reseeded, advanced.head)
    }
    func testLegacyRootMissingAnchorAndMismatchedEnrollmentKeyFailClosed() throws {
        var root = try committedRoot()
        let custody = KeychainOrdinaryTrustSetStore(keychain: InMemoryKeychainStore(), account: "owner-device")
        root.acceptedEpoch1 = nil
        XCTAssertThrowsError(try OrdinaryTrustSetBootstrapAnchor.seed(rootStore: InMemoryFirstDeviceRootStore(record: root), ordinaryStore: custody, verifier: Verifier()))
        root = try committedRoot()
        root.seed.dskPublicKeyBase64 = "substituted-key"
        XCTAssertThrowsError(try OrdinaryTrustSetBootstrapAnchor.seed(rootStore: InMemoryFirstDeviceRootStore(record: root), ordinaryStore: custody, verifier: Verifier()))
        XCTAssertThrowsError(try custody.load())
    }
    func testIndependentKeychainStoreInstancesRejectStaleCASAndFloorRollback() throws {
        let keychain = InMemoryKeychainStore()
        let first = KeychainOrdinaryTrustSetStore(keychain: keychain, account: "owner-device")
        let second = KeychainOrdinaryTrustSetStore(keychain: keychain, account: "owner-device")
        let original = OrdinaryTrustSetRecord(head: OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(1)), signature: "root"))
        XCTAssertTrue(try first.compareAndSetDurably(expected: nil, next: original))
        let advanced = OrdinaryTrustSetRecord(head: OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(2)), signature: "next"))
        XCTAssertTrue(try second.compareAndSetDurably(expected: original, next: advanced))
        XCTAssertFalse(try first.compareAndSetDurably(expected: original, next: original))
        XCTAssertThrowsError(try first.compareAndSetDurably(expected: advanced, next: original))
        XCTAssertEqual(try first.load(), advanced)
    }

}
