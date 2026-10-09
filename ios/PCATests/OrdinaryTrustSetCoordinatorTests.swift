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
        var rejectedSignatures: Set<String> = []
        var expectedPublicKey: String? = nil
        func verify(signature: String, canonicalBytes: Data, publicKey: String) throws -> Bool {
            accepted && !rejectedSignatures.contains(signature)
                && (expectedPublicKey.map { Data($0.utf8) == Data(publicKey.utf8) } ?? true)
        }
    }
    private final class Transport: OrdinaryTrustSetTransport {
        var sent: [OrdinaryTrustSetPending] = []
        var failure = false
        var beforeReply: (() -> Void)?
        var statusValue: OrdinaryTrustSetSubmissionResult = .unknown
        var statusCalls = 0
        var head: OrdinaryTrustSetHead?
        var records: [Int: OrdinaryTrustSetHead] = [:]
        func submit(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult {
            sent.append(request)
            if failure { throw PCAHTTPTransportError.timeout }
            beforeReply?()
            return .accepted(request.candidate)
        }
        func status(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult {
            statusCalls += 1
            return statusValue
        }
        func acceptedRecord(familyId: String, epoch: Int) async throws -> OrdinaryTrustSetHead { guard let value = records[epoch] else { throw PCAAPIError.unavailable }; return value }
        func acceptedHead(familyId: String) async throws -> OrdinaryTrustSetHead { guard let value = head else { throw PCAAPIError.unavailable }; return value }
    }
    private func epoch(_ number: Int, family: String = "family-test", key: Int = 1) -> UntrustedTrustSetEpoch {
        UntrustedTrustSetEpoch(familyId: family, trustSetEpoch: number, keyEpoch: key,
            entries: [UntrustedTrustSetEntry(deviceId: "owner-device", role: .owner, dskKeyId: "owner-dsk", dskPublicKey: "public-dsk",
                dekKeyId: "owner-dek", dekPublicKey: "public-dek", status: .active)],
            issuedAt: "2026-10-09T00:00:00.000Z", supersedesEpoch: number == 1 ? nil : number - 1)
    }
    private func rootHead() throws -> OrdinaryTrustSetHead {
        OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(1)), signature: "accepted-root")
    }
    private func fixture(verifier: Verifier = Verifier()) throws -> (Store, Signer, Transport, OrdinaryTrustSetCoordinator) {
        let head = try rootHead()
        let store = Store(OrdinaryTrustSetRecord(head: head, rootAnchor: head)), signer = Signer(), transport = Transport()
        return (store, signer, transport, OrdinaryTrustSetCoordinator(store: store, signer: signer, verifier: verifier,
            transport: transport, trustedRootAnchor: head, familyId: "family-test", deviceId: "owner-device", dskKeyId: "owner-dsk", dskAlias: "pca.dsk.attempt"))
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
            trustedRootAnchor: try XCTUnwrap(store.value.rootAnchor),
            familyId: "family-test", deviceId: "owner-device", dskKeyId: "owner-dsk", dskAlias: "pca.dsk.attempt")
        _ = try await restarted.submitPending()
        XCTAssertEqual(transport.sent, [pending, pending])
        XCTAssertEqual(signer.calls, 1)
        XCTAssertNil(store.value.pending)
        XCTAssertEqual(try store.value.head.epoch().trustSetEpoch, 2)
    }
    func testRuntimeResumeUsesAuthoritativeStatusBeforeExactRetry() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)

        transport.statusValue = .accepted(pending.candidate)
        let accepted = try await coordinator.resumePending()
        guard case let .accepted(head)? = accepted else { return XCTFail("authoritative accepted status was not returned") }
        XCTAssertEqual(head, pending.candidate)
        XCTAssertEqual(transport.statusCalls, 1)
        XCTAssertTrue(transport.sent.isEmpty, "an already accepted request must not be submitted again")
        XCTAssertNil(store.value.pending)
        XCTAssertEqual(signer.calls, 1)

        try await coordinator.prepare(epoch(3))
        let rejectedPending = try XCTUnwrap(store.value.pending)
        transport.statusValue = .rejected
        let rejected = try await coordinator.resumePending()
        guard case .rejected? = rejected else { return XCTFail("authoritative rejection was not returned") }
        XCTAssertEqual(store.value.pending, rejectedPending, "rejection must not erase the durable request")
        XCTAssertEqual(transport.sent, [], "rejected status must not trigger a retry")
        XCTAssertEqual(transport.statusCalls, 2)
        XCTAssertEqual(signer.calls, 2)
    }
    func testRuntimeResumeRetriesPersistedBytesOnlyAfterUnknownStatus() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        transport.statusValue = .unknown

        let retried = try await coordinator.resumePending()
        guard case let .accepted(head)? = retried else { return XCTFail("exact retry was not accepted") }
        XCTAssertEqual(head, pending.candidate)
        XCTAssertEqual(transport.statusCalls, 1)
        XCTAssertEqual(transport.sent, [pending])
        XCTAssertEqual(signer.calls, 1, "restart recovery must never sign again")
        XCTAssertNil(store.value.pending)
    }
    func testPrepareAndSubmitKeepsCandidatePreparationAndSubmissionInOneCoordinatorGate() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        let result = try await coordinator.prepareAndSubmit(epoch(2))
        guard case let .accepted(head) = result else { return XCTFail("candidate was not accepted") }
        XCTAssertEqual(try head.epoch().trustSetEpoch, 2)
        XCTAssertEqual(transport.sent.count, 1)
        XCTAssertEqual(try FamilyTrustSetCodec.decodeCanonical(transport.sent[0].candidate.canonicalBytes).trustSetEpoch, 2)
        XCTAssertEqual(signer.calls, 1)
        XCTAssertNil(store.value.pending)
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
        let encoded = Data(repeating: 7, count: 64).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let (store, _, transport, coordinator) = try fixture(verifier: Verifier(rejectedSignatures: [encoded]))
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

    func testDeviceAuthorizationDenialIsNotReportedAsExpiredSession() async throws {
        let (store, _, _, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)

        let forbiddenStatusHTTP = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
            PCAHTTPResponse(statusCode: 403, data: Data())
        }
        let forbiddenStatus = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!, familyId: "family-test",
            sessionToken: { "still-valid-device-session" }, http: forbiddenStatusHTTP)
        do {
            _ = try await forbiddenStatus.status(pending)
            XCTFail("forbidden status response must be rejected")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .forbidden)
        }

        let forbiddenHeadHTTP = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
            PCAHTTPResponse(statusCode: 403, data: Data())
        }
        let forbiddenHead = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!, familyId: "family-test",
            sessionToken: { "still-valid-device-session" }, http: forbiddenHeadHTTP)
        do {
            _ = try await forbiddenHead.acceptedHead(familyId: "family-test")
            XCTFail("forbidden accepted-head response must be rejected")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .forbidden)
        }

        let expiredSessionHTTP = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
            PCAHTTPResponse(statusCode: 401, data: Data())
        }
        let expiredSession = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!, familyId: "family-test",
            sessionToken: { "expired-device-session" }, http: expiredSessionHTTP)
        do {
            _ = try await expiredSession.status(pending)
            XCTFail("authentication failure must be unauthorized")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .unauthorized)
        }
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
    func testCatchUpAcceptsLineagePointerOlderThanVerifiedLocalFloor() async throws {
        let (store, _, transport, coordinator) = try fixture(verifier: Verifier(expectedPublicKey: "public-dsk"))
        let root = try XCTUnwrap(store.value.rootAnchor)
        let localEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 5, keyEpoch: 2,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: 3)
        let local = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(localEpoch), signature: "root-signed-local-five")
        store.value = OrdinaryTrustSetRecord(head: local, rootAnchor: root)
        let targetEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 8, keyEpoch: 3,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: 2)
        let target = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(targetEpoch), signature: "root-signed-eight")
        transport.head = target

        let caughtUp = try await coordinator.catchUp()
        XCTAssertTrue(caughtUp)
        XCTAssertEqual(store.value.head, target)
        XCTAssertTrue(transport.records.isEmpty, "a verified root-signed head with an older lineage pointer needs no below-floor fetch")
    }
    func testCatchUpFetchesAboveFloorButAcceptsOlderLineageOnAnIntermediateRecord() async throws {
        let (store, _, transport, coordinator) = try fixture(verifier: Verifier(expectedPublicKey: "public-dsk"))
        let root = try XCTUnwrap(store.value.rootAnchor)
        let localEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 2, keyEpoch: 1,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: 1)
        let local = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(localEpoch), signature: "root-signed-local-two")
        store.value = OrdinaryTrustSetRecord(head: local, rootAnchor: root)
        let older = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 3, keyEpoch: 1,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: 1)
        let middle = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 6, keyEpoch: 2,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: 3)
        let targetEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 8, keyEpoch: 3,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: 6)
        transport.records[3] = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(older), signature: "root-signed-three")
        transport.records[6] = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(middle), signature: "root-signed-six")
        let target = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(targetEpoch), signature: "root-signed-eight")
        transport.head = target

        let caughtUp = try await coordinator.catchUp()
        XCTAssertTrue(caughtUp)
        XCTAssertEqual(store.value.head, target)
        XCTAssertEqual(try store.value.head.epoch().keyEpoch, 3)
    }
    func testEqualCatchUpAuthenticatesPersistedHeadAgainstImmutableRootKey() async throws {
        let (store, _, transport, coordinator) = try fixture(verifier: Verifier(rejectedSignatures: ["forged-equal-head"]))
        let forged = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(2)), signature: "forged-equal-head")
        store.value = OrdinaryTrustSetRecord(head: forged, rootAnchor: try XCTUnwrap(store.value.rootAnchor))
        transport.head = forged
        let original = store.value

        do { _ = try await coordinator.catchUp(); XCTFail("equal but unauthenticated local/server head was trusted") } catch {}
        XCTAssertEqual(store.value, original, "failed local-head authentication must preserve the durable floor")
    }
    func testCatchUpAcceptsNullLineageOnlyWithRootOwnerSignatureAndMonotonicFloors() async throws {
        let (store, _, transport, coordinator) = try fixture(verifier: Verifier(expectedPublicKey: "public-dsk"))
        let unlinkedEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 3, keyEpoch: 2,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: nil)
        let target = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(unlinkedEpoch), signature: "root-signed-current")
        transport.head = target

        let caughtUp = try await coordinator.catchUp()
        XCTAssertTrue(caughtUp)
        XCTAssertEqual(store.value.head, target)
        XCTAssertEqual(try store.value.head.epoch().keyEpoch, 2)
    }
    func testCatchUpRejectsNullLineageKeyEpochRollback() async throws {
        let (store, _, transport, coordinator) = try fixture(verifier: Verifier(expectedPublicKey: "public-dsk"))
        let root = try XCTUnwrap(store.value.rootAnchor)
        let localEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 2, keyEpoch: 2,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: 1)
        let local = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(localEpoch), signature: "root-signed-local")
        store.value = OrdinaryTrustSetRecord(head: local, rootAnchor: root)
        let staleEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 3, keyEpoch: 1,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: nil)
        let stale = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(staleEpoch), signature: "root-signed-stale")
        transport.head = stale
        let original = store.value

        do { _ = try await coordinator.catchUp(); XCTFail("null-lineage head rolled back key epoch") } catch {}
        XCTAssertEqual(store.value, original, "a valid owner signature cannot override the persisted keyEpoch floor")
    }
    func testCatchUpRejectsOwnerReplacementAndRootAnchorTamperingWithoutAdvancing() async throws {
        let (store, _, transport, coordinator) = try fixture()
        let root = try XCTUnwrap(store.value.rootAnchor)
        let changedOwner = UntrustedTrustSetEntry(deviceId: "other-device", role: .owner, dskKeyId: "other-dsk",
            dskPublicKey: "other-public-dsk", dekKeyId: "owner-dek", dekPublicKey: "public-dek", status: .active)
        let replacement = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 2, keyEpoch: 1,
            entries: [changedOwner], issuedAt: epoch(1).issuedAt, supersedesEpoch: nil)
        transport.head = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(replacement), signature: "replacement")
        let original = store.value
        do { _ = try await coordinator.catchUp(); XCTFail("server head replaced the bootstrap owner") } catch {}
        XCTAssertEqual(store.value, original)

        store.value = OrdinaryTrustSetRecord(head: try XCTUnwrap(transport.head), rootAnchor: root)
        let replacedLocal = store.value
        do { _ = try await coordinator.catchUp(); XCTFail("persisted local head replaced the bootstrap owner") } catch {}
        XCTAssertEqual(store.value, replacedLocal)

        store.value = original
        store.value.rootAnchor = OrdinaryTrustSetHead(familyId: root.familyId, canonicalBytes: root.canonicalBytes, signature: "tampered-root")
        let tampered = store.value
        do { _ = try await coordinator.catchUp(); XCTFail("mutable local root anchor was trusted") } catch {}
        XCTAssertEqual(store.value, tampered)
    }
    func testCatchUpRefusesUnanchoredOrBadSignatureHeadWithoutChangingFloor() async throws {
        let (store, _, transport, coordinator) = try fixture(verifier: Verifier(rejectedSignatures: ["bad"]))
        transport.head = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(2)), signature: "bad")
        let original = store.value
        do { _ = try await coordinator.catchUp(); XCTFail("invalid signature accepted") } catch {}
        XCTAssertEqual(store.value, original)

        let invalidLineage = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 2, keyEpoch: 1,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: 2)
        transport.head = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(invalidLineage), signature: "valid-signature")
        do { _ = try await coordinator.catchUp(); XCTFail("lineage equal to candidate epoch was accepted") } catch {}
        XCTAssertEqual(store.value, original, "lineage metadata must remain strictly below its candidate epoch")
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

    func testCatchUpRecoversLostResponsePendingWithoutReSignOrRollback() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        transport.records[2] = pending.candidate
        transport.head = OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(3)), signature: "third")
        let complete = try await coordinator.catchUp()
        XCTAssertTrue(complete)
        XCTAssertNil(store.value.pending)
        XCTAssertEqual(try store.value.head.epoch().trustSetEpoch, 3)
        XCTAssertEqual(signer.calls, 1)
        XCTAssertTrue(transport.sent.isEmpty)
    }
    func testConflictingCatchUpKeepsPendingUntilAuthoritativeExactReceipt() async throws {
        let (store, _, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        transport.head = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: pending.candidate.canonicalBytes, signature: "different-valid-signature")
        let complete = try await coordinator.catchUp()
        XCTAssertTrue(complete)
        XCTAssertEqual(store.value.pending, pending)
        transport.statusValue = .rejected
        let reconciled = try await coordinator.reconcile()
        XCTAssertFalse(reconciled)
        XCTAssertEqual(store.value.pending, pending)
    }

}
