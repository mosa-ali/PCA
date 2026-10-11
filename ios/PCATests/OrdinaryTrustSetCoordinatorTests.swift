import XCTest
import Foundation
@testable import PCA

final class OrdinaryTrustSetCoordinatorTests: XCTestCase {
    private struct SharedSignatureCorpus: Decodable {
        let vectors: [SharedSignatureVector]
    }
    private struct SharedSignatureVector: Decodable {
        let name: String
        let canonical: String
    }

    func testProductionVerifierUsesSharedOrdinaryEpochBytesWithoutDomainPrefix() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let corpusURL = root.appendingPathComponent("contracts/family-trust-set/canonical-vectors.json")
        let corpus = try JSONDecoder().decode(SharedSignatureCorpus.self, from: Data(contentsOf: corpusURL))
        let vector = try XCTUnwrap(corpus.vectors.first { $0.name == "ordinary-unicode" })
        let canonicalBytes = Data(vector.canonical.utf8)

        // The fixture key is test-only. Its P-256 keypair was generated ephemerally;
        // the private key was discarded after producing this low-S SHA-256/P1363 signature.
        let publicKey = "BEfIaXgQNC5TooTU-F8_s7tYxEBSnq3dWU2GNbUPnToPEg1pa9otat0ktE2fIuZyV5gbbNCkCgq4ASgYjGbjQRY"
        let signature = "uQhIUB_OfYlSzJda4ZesMVQ7mPJ4F_9BHNkAf-vzmrdEjD7nLMqzdtnK_dk46eGCyHU114iujqmZVVqapf4I7A"
        let verifier = P256OrdinaryTrustSetSignatureVerifier()

        XCTAssertTrue(try verifier.verify(signature: signature, canonicalBytes: canonicalBytes, publicKey: publicKey))
        XCTAssertFalse(try verifier.verify(signature: signature,
            canonicalBytes: Data("PCA_ORDINARY_TRUST_SET_V1:".utf8) + canonicalBytes, publicKey: publicKey))

        var alteredBytes = canonicalBytes
        alteredBytes[alteredBytes.startIndex] ^= 1
        XCTAssertFalse(try verifier.verify(signature: signature, canonicalBytes: alteredBytes, publicKey: publicKey))
    }

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
        var acceptedSignerKeys: [String: String] = [:]
        func verify(signature: String, canonicalBytes: Data, publicKey: String) throws -> Bool {
            accepted && !rejectedSignatures.contains(signature)
                && (acceptedSignerKeys[signature].map { Data($0.utf8) == Data(publicKey.utf8) } ?? true)
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
            head = request.candidate
            return .accepted(request.candidate)
        }
        func status(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult {
            statusCalls += 1
            if case let .accepted(accepted) = statusValue { head = accepted }
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
    private func transferredEpoch(_ number: Int, supersedes: Int, ownerIsNew: Bool) -> UntrustedTrustSetEpoch {
        let genesisOwner = UntrustedTrustSetEntry(deviceId: "owner-device", role: ownerIsNew ? .administrator : .owner,
            dskKeyId: "owner-dsk", dskPublicKey: "public-dsk", dekKeyId: "owner-dek",
            dekPublicKey: "public-dek", status: .active)
        let successor = UntrustedTrustSetEntry(deviceId: "new-owner-device", role: ownerIsNew ? .owner : .administrator,
            dskKeyId: "new-owner-dsk", dskPublicKey: "new-public-dsk", dekKeyId: "new-owner-dek",
            dekPublicKey: "new-public-dek", status: .active)
        return UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: number, keyEpoch: 1,
            entries: [genesisOwner, successor], issuedAt: "2026-10-09T00:00:00.000Z", supersedesEpoch: supersedes)
    }
    private func signedHead(_ value: UntrustedTrustSetEpoch, signature: String) throws -> OrdinaryTrustSetHead {
        OrdinaryTrustSetHead(familyId: value.familyId,
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(value), signature: signature)
    }
    private func maximumOpaque(_ prefix: String) -> String {
        let remaining = 128 - prefix.utf16.count
        return prefix + String(repeating: "😀", count: remaining / 2) + (remaining.isMultiple(of: 2) ? "" : "x")
    }
    private func maximumShapeEpoch(_ number: Int, supersedes: Int?) -> UntrustedTrustSetEpoch {
        let entries = (0..<64).map { index in
            UntrustedTrustSetEntry(deviceId: maximumOpaque("device-\(index)-"),
                role: index == 0 ? .owner : .viewer,
                dskKeyId: maximumOpaque("dsk-id-\(index)-"), dskPublicKey: maximumOpaque("dsk-public-\(index)-"),
                dekKeyId: maximumOpaque("dek-id-\(index)-"), dekPublicKey: maximumOpaque("dek-public-\(index)-x"),
                status: .active)
        }
        return UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: number, keyEpoch: 1,
            entries: entries, issuedAt: "2026-10-09T00:00:00.000Z", supersedesEpoch: supersedes)
    }
    private func rootHead() throws -> OrdinaryTrustSetHead {
        OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(1)), signature: "accepted-root")
    }
    private func fixture(verifier: Verifier = Verifier()) throws -> (Store, Signer, Transport, OrdinaryTrustSetCoordinator) {
        let head = try rootHead()
        let store = Store(OrdinaryTrustSetRecord(head: head, rootAnchor: head)), signer = Signer(), transport = Transport()
        transport.head = head
        return (store, signer, transport, OrdinaryTrustSetCoordinator(store: store, signer: signer, verifier: verifier,
            transport: transport, trustedRootAnchor: head, familyId: "family-test", deviceId: "owner-device", dskKeyId: "owner-dsk", dskAlias: "pca.dsk.attempt"))
    }
    func testOrdinaryEpochRequestCanonicalByteLimitBoundary() throws {
        let maximum = OrdinaryTrustSetRequestLimits.maximumCanonicalBytes
        XCTAssertEqual(maximum, 196_506)
        XCTAssertNoThrow(try OrdinaryTrustSetRequestLimits.validateCandidateCanonicalBytes(
            Data(repeating: 0, count: maximum)))
        XCTAssertThrowsError(try OrdinaryTrustSetRequestLimits.validateCandidateCanonicalBytes(
            Data(repeating: 0, count: maximum + 1))) { error in
            XCTAssertEqual(error as? OrdinaryTrustSetError, .malformedState)
        }
    }
    func testMaximumSupportedTrustSetCheckpointFitsOneMiBKeychainItem() throws {
        let root = try signedHead(maximumShapeEpoch(1, supersedes: nil), signature: String(repeating: "r", count: 512))
        let base = try signedHead(maximumShapeEpoch(2, supersedes: 1), signature: String(repeating: "b", count: 512))
        let current = try signedHead(maximumShapeEpoch(3, supersedes: 2), signature: String(repeating: "c", count: 512))
        let candidate = try signedHead(maximumShapeEpoch(4, supersedes: 3), signature: String(repeating: "p", count: 512))
        let pending = OrdinaryTrustSetPending(previousHead: current, candidate: candidate,
            signerDeviceId: maximumOpaque("device-0-"), signerKeyId: maximumOpaque("dsk-id-0-"))
        let record = OrdinaryTrustSetRecord(head: current, pending: pending, rootAnchor: root, acceptedBase: base)
        try record.validate()
        let bytes = try JSONEncoder().encode(record)
        XCTAssertLessThan(bytes.count, 1_048_576,
            "the maximum supported head shape, including root/checkpoint/pending duplication, must fit Keychain custody")
    }
    func testOversizedPersistedOrdinaryEpochRequestFailsBeforeTransport() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        let previous = store.value.head
        let oversizedCandidate = OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: Data(repeating: 0, count: OrdinaryTrustSetRequestLimits.maximumCanonicalBytes + 1),
            signature: "persisted-signature")
        store.value.pending = OrdinaryTrustSetPending(previousHead: previous, candidate: oversizedCandidate,
            signerDeviceId: "owner-device", signerKeyId: "owner-dsk")

        do {
            _ = try await coordinator.submitPending()
            XCTFail("oversized persisted request must fail locally")
        } catch let error as OrdinaryTrustSetError {
            XCTAssertEqual(error, .malformedState)
        }
        XCTAssertTrue(transport.sent.isEmpty, "invalid durable request must not reach the server")
        XCTAssertEqual(signer.calls, 0, "retry validation must not re-sign persisted bytes")
    }
    private func apiRecord(_ head: OrdinaryTrustSetHead) throws -> [String: Any] {
        let urlSignature = head.signature.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let paddedSignature = urlSignature + String(repeating: "=", count: (4 - urlSignature.count % 4) % 4)
        let signature = try XCTUnwrap(Data(base64Encoded: paddedSignature)).base64EncodedString()
        let epoch = try head.epoch()
        return ["canonicalEpochBase64": head.canonicalBytes.base64EncodedString(),
            "signatureBase64": signature, "signerDeviceId": "owner-device", "signerKeyId": "owner-dsk",
            "trustSetEpoch": epoch.trustSetEpoch, "keyEpoch": epoch.keyEpoch]
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

    func testKeychainRestartRetriesIdenticalCanonicalBytesAndSignatureAfterStatusMiss() async throws {
        let root = try rootHead()
        let keychain = InMemoryKeychainStore()
        let firstStore = KeychainOrdinaryTrustSetStore(keychain: keychain, account: "owner-device")
        XCTAssertTrue(try firstStore.compareAndSetDurably(expected: nil,
            next: OrdinaryTrustSetRecord(head: root, rootAnchor: root)))
        let firstSigner = Signer()
        let transport = Transport()
        transport.failure = true
        let firstCoordinator = OrdinaryTrustSetCoordinator(store: firstStore, signer: firstSigner,
            verifier: Verifier(), transport: transport, trustedRootAnchor: root,
            familyId: "family-test", deviceId: "owner-device", dskKeyId: "owner-dsk",
            dskAlias: "pca.dsk.attempt")

        try await firstCoordinator.prepare(epoch(2))
        let prepared = try XCTUnwrap(firstStore.load().pending)
        do {
            _ = try await firstCoordinator.submitPending()
            XCTFail("the first delivery should simulate a lost response")
        } catch {}
        XCTAssertEqual(try firstStore.load().pending, prepared,
            "a transport failure retains the signed request in Keychain")

        // Re-open the durable store and create a fresh coordinator/signer as a
        // process-restart proxy. Recovery must use only the persisted request.
        let reopenedStore = KeychainOrdinaryTrustSetStore(keychain: keychain, account: "owner-device")
        let persisted = try XCTUnwrap(reopenedStore.load().pending)
        XCTAssertEqual(persisted, prepared)
        XCTAssertEqual(persisted.candidate.canonicalBytes, prepared.candidate.canonicalBytes)
        XCTAssertEqual(persisted.candidate.signature, prepared.candidate.signature)
        let restartedSigner = Signer()
        let restartedCoordinator = OrdinaryTrustSetCoordinator(store: reopenedStore, signer: restartedSigner,
            verifier: Verifier(), transport: transport, trustedRootAnchor: root,
            familyId: "family-test", deviceId: "owner-device", dskKeyId: "owner-dsk",
            dskAlias: "pca.dsk.attempt")
        transport.failure = false

        let resumed = try await restartedCoordinator.resumePending()
        guard case let .accepted(accepted)? = resumed else { return XCTFail("persisted request was not accepted") }
        XCTAssertEqual(accepted, persisted.candidate)
        XCTAssertEqual(transport.statusCalls, 1, "restart queries authoritative status before retry")
        XCTAssertEqual(transport.sent, [persisted, persisted],
            "the post-restart retry must send byte-identical candidate and signature")
        XCTAssertEqual(transport.sent[0].candidate.canonicalBytes, transport.sent[1].candidate.canonicalBytes)
        XCTAssertEqual(transport.sent[0].candidate.signature, transport.sent[1].candidate.signature)
        XCTAssertEqual(firstSigner.calls, 1)
        XCTAssertEqual(restartedSigner.calls, 0, "restart recovery never signs again")
        XCTAssertNil(try reopenedStore.load().pending)
        XCTAssertEqual(try reopenedStore.load().head, persisted.candidate)
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

    func testResumeWithUnknownStatusAcceptsExactRemoteHeadWithoutResubmitting() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)

        // The server committed the request but both the submit response and
        // status projection are inconclusive. The accepted-head read is the
        // authoritative proof that this exact signed candidate committed.
        transport.statusValue = .unknown
        transport.head = pending.candidate

        let resumed = try await coordinator.resumePending()
        guard case let .accepted(accepted)? = resumed else {
            return XCTFail("the exact accepted server head should reconcile the persisted request")
        }
        XCTAssertEqual(accepted, pending.candidate)
        XCTAssertEqual(transport.statusCalls, 1)
        XCTAssertTrue(transport.sent.isEmpty, "the exact accepted head must prevent duplicate submission")
        XCTAssertEqual(signer.calls, 1, "restart reconciliation must never re-sign")
        XCTAssertNil(store.value.pending)
        XCTAssertEqual(store.value.head, pending.candidate)
    }

    func testAcceptedStatusThenSignedHeadCatchUpReconcilesSkippedEpochsWithoutResigning() async throws {
        let (store, signer, _, _) = try fixture()
        let candidateEpoch = epoch(2)
        let intermediateEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 3, keyEpoch: 1,
            entries: epoch(1).entries, issuedAt: "2026-10-09T00:00:03.000Z", supersedesEpoch: 2)
        let projectedEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 8, keyEpoch: 2,
            entries: epoch(1).entries, issuedAt: "2026-10-09T00:00:08.000Z", supersedesEpoch: 3)
        func signedHead(_ value: UntrustedTrustSetEpoch, byte: UInt8) throws -> OrdinaryTrustSetHead {
            let signature = Data(repeating: byte, count: 64).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            return OrdinaryTrustSetHead(familyId: value.familyId,
                canonicalBytes: try FamilyTrustSetCodec.canonicalize(value), signature: signature)
        }
        let intermediate = try signedHead(intermediateEpoch, byte: 3)
        let projectedHead = try signedHead(projectedEpoch, byte: 8)
        let root = try XCTUnwrap(store.value.rootAnchor)
        var serverHead = root
        let http = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { request in
            guard let path = request.url?.path else { throw PCAHTTPTransportError.network }
            let body: [String: Any]
            switch path {
            case "/api/device/families/family-test/trust-set/epochs/status":
                let pending = try XCTUnwrap(store.value.pending)
                body = ["outcome": "ACCEPTED", "acceptedEpoch": try self.apiRecord(pending.candidate),
                    "acceptedHead": try self.apiRecord(projectedHead)]
                serverHead = projectedHead
            case "/api/device/families/family-test/trust-set/epochs/head":
                body = ["acceptedHead": try self.apiRecord(serverHead)]
            case "/api/device/families/family-test/trust-set/epochs/records/3":
                body = ["acceptedEpoch": try self.apiRecord(intermediate)]
            default:
                throw PCAHTTPTransportError.network
            }
            return PCAHTTPResponse(statusCode: 200, data: try JSONSerialization.data(withJSONObject: body))
        }
        let client = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!,
            familyId: "family-test", sessionToken: { "device-session" }, http: http)
        let coordinator = OrdinaryTrustSetCoordinator(store: store, signer: signer, verifier: Verifier(),
            transport: client, trustedRootAnchor: root, familyId: "family-test", deviceId: "owner-device",
            dskKeyId: "owner-dsk", dskAlias: "pca.dsk.attempt")

        try await coordinator.prepare(candidateEpoch)
        let pending = try XCTUnwrap(store.value.pending)
        let resumed = try await coordinator.resumePending()
        guard case let .accepted(receipt)? = resumed else { return XCTFail("exact status receipt was not accepted") }
        XCTAssertEqual(receipt, pending.candidate)
        XCTAssertNil(store.value.pending)
        XCTAssertEqual(try store.value.head.epoch().trustSetEpoch, 2,
            "status acknowledgement advances only to its exact accepted record")

        let caughtUp = try await coordinator.catchUp(maximumRecords: 4)
        XCTAssertTrue(caughtUp)
        XCTAssertEqual(store.value.head, projectedHead)
        XCTAssertNil(store.value.pending)
        XCTAssertEqual(signer.calls, 1)
        XCTAssertEqual(http.requests.compactMap { $0.url?.path }, [
            "/api/device/families/family-test/trust-set/epochs/head",
            "/api/device/families/family-test/trust-set/epochs/status",
            "/api/device/families/family-test/trust-set/epochs/head",
            "/api/device/families/family-test/trust-set/epochs/records/3"
        ])
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
    func testReconcileValidatesPersistedPendingBeforeStatusTransport() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        let restarted = OrdinaryTrustSetCoordinator(store: store, signer: signer,
            verifier: Verifier(rejectedSignatures: [pending.candidate.signature]), transport: transport,
            trustedRootAnchor: try XCTUnwrap(store.value.rootAnchor),
            familyId: "family-test", deviceId: "owner-device", dskKeyId: "owner-dsk",
            dskAlias: "pca.dsk.attempt")

        do {
            _ = try await restarted.reconcile()
            XCTFail("unverifiable durable request must not be sent to status")
        } catch let error as OrdinaryTrustSetError {
            XCTAssertEqual(error, .unauthorizedSigner)
        }
        XCTAssertEqual(transport.statusCalls, 0)
        XCTAssertEqual(store.value.pending, pending,
            "failed local signature validation preserves the exact durable attempt")
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

    func testAPIRejectsDuplicateAndUnexpectedKeysAcrossResponseShapes() async throws {
        let (store, _, _, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        let record = try apiRecord(pending.candidate)
        let recordJSON = String(decoding: try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]), as: UTF8.self)
        let duplicateRecordJSON = String(recordJSON.dropLast()) + ",\"key\\u0045poch\":1}"
        let extraRecord = record.merging(["debug": true]) { _, replacement in replacement }
        let extraRecordJSON = String(decoding: try JSONSerialization.data(withJSONObject: extraRecord, options: [.sortedKeys]), as: UTF8.self)

        func client(_ data: Data) throws -> OrdinaryTrustSetAPIClient {
            let http = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
                PCAHTTPResponse(statusCode: 200, data: data)
            }
            return try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!,
                familyId: "family-test", sessionToken: { "device-session" }, http: http)
        }
        func mustReject(_ data: Data, file: StaticString = #filePath, line: UInt = #line) async throws {
            let api = try client(data)
            do {
                _ = try await api.submit(pending)
                XCTFail("duplicate or unexpected JSON object member was accepted", file: file, line: line)
            } catch let error as PCAAPIError {
                XCTAssertEqual(error, .malformedResponse, file: file, line: line)
            }
        }

        let duplicateTopLevel = "{\"outcome\":\"ACCEPTED\",\"outc\\u006fme\":\"NOT_ACCEPTED\",\"acceptedEpoch\":\(recordJSON),\"acceptedHead\":\(recordJSON)}"
        let extraTopLevel = "{\"outcome\":\"ACCEPTED\",\"acceptedEpoch\":\(recordJSON),\"acceptedHead\":\(recordJSON),\"debug\":true}"
        let duplicateNested = "{\"outcome\":\"ACCEPTED\",\"acceptedEpoch\":\(duplicateRecordJSON),\"acceptedHead\":\(recordJSON)}"
        let extraNested = "{\"outcome\":\"ACCEPTED\",\"acceptedEpoch\":\(extraRecordJSON),\"acceptedHead\":\(recordJSON)}"
        let trailingNonJSON = "{\"outcome\":\"ACCEPTED\",\"acceptedEpoch\":\(recordJSON),\"acceptedHead\":\(recordJSON)} trailing"
        let trailingComma = "{\"outcome\":\"ACCEPTED\",\"acceptedEpoch\":\(recordJSON),\"acceptedHead\":\(recordJSON),}"
        let invalidEscape = "{\"outcome\":\"ACCEPTED\\x\",\"acceptedEpoch\":\(recordJSON),\"acceptedHead\":\(recordJSON)}"
        for body in [duplicateTopLevel, extraTopLevel, duplicateNested, extraNested,
                     trailingNonJSON, trailingComma, invalidEscape] {
            try await mustReject(Data(body.utf8))
        }

        let extraHeadResponse = Data("{\"acceptedHead\":\(extraRecordJSON)}".utf8)
        let badHeadClient = try client(extraHeadResponse)
        do {
            _ = try await badHeadClient.acceptedHead(familyId: "family-test")
            XCTFail("accepted-head read ignored an unexpected record member")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
        let duplicateHeadResponse = Data("{\"acceptedHead\":\(duplicateRecordJSON)}".utf8)
        let duplicateHeadClient = try client(duplicateHeadResponse)
        do {
            _ = try await duplicateHeadClient.acceptedHead(familyId: "family-test")
            XCTFail("accepted-head read accepted a duplicate escaped member")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
        let rootRecord = try apiRecord(XCTUnwrap(store.value.rootAnchor))
        let rootRecordJSON = String(decoding: try JSONSerialization.data(withJSONObject: rootRecord, options: [.sortedKeys]), as: UTF8.self)
        let duplicateRootRecordJSON = String(rootRecordJSON.dropLast()) + ",\"key\\u0045poch\":1}"
        let duplicateRecordResponse = Data("{\"acceptedEpoch\":\(duplicateRootRecordJSON)}".utf8)
        let badRecordClient = try client(duplicateRecordResponse)
        do {
            _ = try await badRecordClient.acceptedRecord(familyId: "family-test", epoch: 1)
            XCTFail("accepted-record read accepted a duplicate escaped member")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
    }

    func testAPIReadsOwnerTransferRecordSignedByOutgoingOwner() async throws {
        let signature = Data(repeating: 9, count: 64).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let transfer = OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(transferredEpoch(2, supersedes: 1, ownerIsNew: true)),
            signature: signature)
        let dto = try apiRecord(transfer) // backend metadata identifies the outgoing Owner
        let http = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { request in
            guard let path = request.url?.path else { throw PCAHTTPTransportError.network }
            let body: [String: Any]
            if path.hasSuffix("/head") { body = ["acceptedHead": dto] }
            else if path.hasSuffix("/records/2") { body = ["acceptedEpoch": dto] }
            else { throw PCAHTTPTransportError.network }
            return PCAHTTPResponse(statusCode: 200, data: try JSONSerialization.data(withJSONObject: body))
        }
        let client = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!,
            familyId: "family-test", sessionToken: { "device-session" }, http: http)

        let acceptedHead = try await client.acceptedHead(familyId: "family-test")
        let acceptedEpoch = try await client.acceptedRecord(familyId: "family-test", epoch: 2)
        XCTAssertEqual(acceptedHead, transfer)
        XCTAssertEqual(acceptedEpoch, transfer)
    }

    func testAPIRejectsAcceptedHeadWithOlderKeyEpochDuringStatus() async throws {
        let (store, _, _, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2, key: 2))
        let pending = try XCTUnwrap(store.value.pending)
        let headEpoch = epoch(3, key: 1)
        let projectedHead = OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(headEpoch), signature: pending.candidate.signature)
        let body = try JSONSerialization.data(withJSONObject: ["outcome": "ACCEPTED",
            "acceptedEpoch": try apiRecord(pending.candidate), "acceptedHead": try apiRecord(projectedHead)])
        let http = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
            PCAHTTPResponse(statusCode: 200, data: body)
        }
        let client = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!,
            familyId: "family-test", sessionToken: { "device-session" }, http: http)

        do {
            _ = try await client.status(pending)
            XCTFail("a newer trust-set epoch cannot project a lower key epoch")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
    }

    func testAPIRejectsAcceptedHeadWithOlderTrustSetEpochDuringStatus() async throws {
        let (store, _, _, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        let staleHead = OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(1)), signature: pending.candidate.signature)
        let body = try JSONSerialization.data(withJSONObject: ["outcome": "ACCEPTED",
            "acceptedEpoch": try apiRecord(pending.candidate), "acceptedHead": try apiRecord(staleHead)])
        let http = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
            PCAHTTPResponse(statusCode: 200, data: body)
        }
        let client = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!,
            familyId: "family-test", sessionToken: { "device-session" }, http: http)

        do {
            _ = try await client.status(pending)
            XCTFail("accepted-head trust-set epoch cannot precede its accepted record")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
    }

    func testAPIRequiresAcceptedRecordToMatchExactSubmittedRequest() async throws {
        let (store, _, _, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        let alternateSignature = Data(repeating: 8, count: 64).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let conflictingAcceptedRecord = OrdinaryTrustSetHead(familyId: pending.candidate.familyId,
            canonicalBytes: pending.candidate.canonicalBytes, signature: alternateSignature)
        let body = try JSONSerialization.data(withJSONObject: ["outcome": "ACCEPTED",
            "acceptedEpoch": try apiRecord(conflictingAcceptedRecord),
            "acceptedHead": try apiRecord(conflictingAcceptedRecord)])
        let http = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
            PCAHTTPResponse(statusCode: 200, data: body)
        }
        let client = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!,
            familyId: "family-test", sessionToken: { "device-session" }, http: http)

        do {
            _ = try await client.status(pending)
            XCTFail("an accepted record with a different signature is not the exact persisted request")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
    }

    func testAPIStatusRequiresNoAcceptedRecordForNotAcceptedOrConflict() async throws {
        let (store, _, _, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        let acceptedHead = try apiRecord(OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(1)), signature: pending.candidate.signature))

        for outcome in ["NOT_ACCEPTED", "CONFLICT"] {
            let validBody = try JSONSerialization.data(withJSONObject: ["outcome": outcome,
                "acceptedEpoch": NSNull(), "acceptedHead": acceptedHead])
            let validHTTP = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
                PCAHTTPResponse(statusCode: 200, data: validBody)
            }
            let validClient = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!,
                familyId: "family-test", sessionToken: { "device-session" }, http: validHTTP)
            let result = try await validClient.status(pending)
            if outcome == "NOT_ACCEPTED" {
                guard case .unknown = result else { return XCTFail("NOT_ACCEPTED must map to unknown") }
            } else {
                guard case .rejected = result else { return XCTFail("CONFLICT must map to rejected") }
            }

            let missingReceiptBody = try JSONSerialization.data(withJSONObject: ["outcome": outcome,
                "acceptedHead": acceptedHead])
            let missingReceiptHTTP = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
                PCAHTTPResponse(statusCode: 200, data: missingReceiptBody)
            }
            let missingReceiptClient = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!,
                familyId: "family-test", sessionToken: { "device-session" }, http: missingReceiptHTTP)
            do {
                _ = try await missingReceiptClient.status(pending)
                XCTFail("\(outcome) requires acceptedEpoch to be explicitly null")
            } catch let error as PCAAPIError {
                XCTAssertEqual(error, .malformedResponse)
            }

            let contradictoryBody = try JSONSerialization.data(withJSONObject: ["outcome": outcome,
                "acceptedEpoch": try apiRecord(pending.candidate), "acceptedHead": acceptedHead])
            let contradictoryHTTP = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
                PCAHTTPResponse(statusCode: 200, data: contradictoryBody)
            }
            let contradictoryClient = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!,
                familyId: "family-test", sessionToken: { "device-session" }, http: contradictoryHTTP)
            do {
                _ = try await contradictoryClient.status(pending)
                XCTFail("\(outcome) cannot include an accepted record")
            } catch let error as PCAAPIError {
                XCTAssertEqual(error, .malformedResponse)
            }
        }
    }

    func testAPIRejectsDifferentAcceptedHeadRecordAtSameEpochDuringStatus() async throws {
        let (store, _, _, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2, key: 2))
        let pending = try XCTUnwrap(store.value.pending)
        let conflictingEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 2, keyEpoch: 2,
            entries: epoch(1).entries, issuedAt: "2026-10-09T00:01:00.000Z", supersedesEpoch: 1)
        let projectedHead = OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(conflictingEpoch), signature: pending.candidate.signature)
        let body = try JSONSerialization.data(withJSONObject: ["outcome": "ACCEPTED",
            "acceptedEpoch": try apiRecord(pending.candidate), "acceptedHead": try apiRecord(projectedHead)])
        let http = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
            PCAHTTPResponse(statusCode: 200, data: body)
        }
        let client = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!,
            familyId: "family-test", sessionToken: { "device-session" }, http: http)

        do {
            _ = try await client.status(pending)
            XCTFail("an equal-epoch accepted-head projection must equal the accepted record")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
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

        let forbiddenRecordHTTP = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
            PCAHTTPResponse(statusCode: 403, data: Data())
        }
        let forbiddenRecord = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!, familyId: "family-test",
            sessionToken: { "still-valid-device-session" }, http: forbiddenRecordHTTP)
        do {
            _ = try await forbiddenRecord.acceptedRecord(familyId: "family-test", epoch: 1)
            XCTFail("forbidden accepted-record response must be rejected")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .forbidden)
        }

        let unauthorizedHeadHTTP = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
            PCAHTTPResponse(statusCode: 401, data: Data())
        }
        let unauthorizedHead = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!, familyId: "family-test",
            sessionToken: { "expired-device-session" }, http: unauthorizedHeadHTTP)
        do {
            _ = try await unauthorizedHead.acceptedHead(familyId: "family-test")
            XCTFail("unauthorized accepted-head response must be rejected")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .unauthorized)
        }

        let unauthorizedRecordHTTP = InMemoryPCAHTTPTransport(autoAcceptEnrollmentPreparation: false) { _ in
            PCAHTTPResponse(statusCode: 401, data: Data())
        }
        let unauthorizedRecord = try OrdinaryTrustSetAPIClient(baseURL: URL(string: "https://api.example.test")!, familyId: "family-test",
            sessionToken: { "expired-device-session" }, http: unauthorizedRecordHTTP)
        do {
            _ = try await unauthorizedRecord.acceptedRecord(familyId: "family-test", epoch: 1)
            XCTFail("unauthorized accepted-record response must be rejected")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .unauthorized)
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
    func testCatchUpRejectsTargetLineagePointerOlderThanVerifiedLocalFloor() async throws {
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
        let original = store.value

        let caughtUp = try await coordinator.catchUp()
        XCTAssertFalse(caughtUp, "a valid signature cannot bridge a lineage pointer below the trusted floor")
        XCTAssertEqual(store.value, original)
        XCTAssertTrue(transport.records.isEmpty)
    }
    func testCatchUpDoesNotAdoptChainWhoseIntermediateLineageSkipsTrustedFloor() async throws {
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
        let original = store.value

        let caughtUp = try await coordinator.catchUp()
        XCTAssertFalse(caughtUp, "every linked record must ultimately point to the exact local head")
        XCTAssertEqual(store.value, original, "an unanchored fetched chain must not advance local custody")
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
    func testCatchUpRejectsUnlinkedNonGenesisHeadEvenWithRootOwnerSignature() async throws {
        let (store, _, transport, coordinator) = try fixture(verifier: Verifier(expectedPublicKey: "public-dsk"))
        let unlinkedEpoch = UntrustedTrustSetEpoch(familyId: "family-test", trustSetEpoch: 3, keyEpoch: 2,
            entries: epoch(1).entries, issuedAt: epoch(1).issuedAt, supersedesEpoch: nil)
        let target = OrdinaryTrustSetHead(familyId: "family-test", canonicalBytes: try FamilyTrustSetCodec.canonicalize(unlinkedEpoch), signature: "root-signed-current")
        transport.head = target
        let original = store.value

        let caughtUp = try await coordinator.catchUp()
        XCTAssertFalse(caughtUp, "an owner signature alone does not prove descent from the local trusted head")
        XCTAssertEqual(store.value, original)
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
        let replacedRootHeadWasAdopted = try await coordinator.catchUp()
        XCTAssertFalse(replacedRootHeadWasAdopted, "an unanchored owner-replacement projection cannot be adopted")
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

    func testCatchUpOwnerTransferPersistsCheckpointAndValidatesAfterRestart() async throws {
        let verifier = Verifier(acceptedSignerKeys: [
            "accepted-root": "public-dsk",
            "transfer-by-genesis": "public-dsk",
            "next-by-new-owner": "new-public-dsk",
        ])
        let (store, signer, transport, coordinator) = try fixture(verifier: verifier)
        let transfer = try signedHead(transferredEpoch(2, supersedes: 1, ownerIsNew: true), signature: "transfer-by-genesis")
        let next = try signedHead(transferredEpoch(3, supersedes: 2, ownerIsNew: true), signature: "next-by-new-owner")
        transport.head = transfer

        let migratedLegacyHead = try await coordinator.catchUp(maximumRecords: 4)
        XCTAssertTrue(migratedLegacyHead)
        XCTAssertEqual(store.value.acceptedBase, try XCTUnwrap(store.value.rootAnchor),
            "the first verified advance materializes the acceptedBase for a legacy root-only record")
        XCTAssertEqual(store.value.head, transfer)

        transport.records[2] = transfer
        transport.head = next

        let caughtUp = try await coordinator.catchUp(maximumRecords: 4)
        XCTAssertTrue(caughtUp)
        XCTAssertEqual(store.value.acceptedBase, transfer)
        XCTAssertEqual(store.value.head, next)
        XCTAssertEqual(try store.value.head.epoch().entries.first(where: { $0.role == .owner })?.deviceId, "new-owner-device")

        // The protected acceptedBase is the immediate verified predecessor;
        // restart validates the current Owner's signature without requiring
        // the genesis Owner to remain the current role holder.
        let restarted = OrdinaryTrustSetCoordinator(store: store, signer: signer, verifier: verifier, transport: transport,
            trustedRootAnchor: try XCTUnwrap(store.value.rootAnchor), familyId: "family-test",
            deviceId: "owner-device", dskKeyId: "owner-dsk", dskAlias: "pca.dsk.attempt")
        let restartedAtHead = try await restarted.catchUp()
        XCTAssertTrue(restartedAtHead)

        do {
            try await restarted.prepare(transferredEpoch(4, supersedes: 3, ownerIsNew: true))
            XCTFail("the former Owner device cannot sign the next epoch")
        } catch let error as OrdinaryTrustSetError {
            XCTAssertEqual(error, .unauthorizedSigner)
        }
        XCTAssertEqual(signer.calls, 0)

        let newOwnerCoordinator = OrdinaryTrustSetCoordinator(store: store, signer: signer, verifier: verifier,
            transport: transport, trustedRootAnchor: try XCTUnwrap(store.value.rootAnchor), familyId: "family-test",
            deviceId: "new-owner-device", dskKeyId: "new-owner-dsk", dskAlias: "pca.dsk.new-owner")
        try await newOwnerCoordinator.prepare(transferredEpoch(4, supersedes: 3, ownerIsNew: true))
        XCTAssertEqual(signer.calls, 1)
        XCTAssertEqual(store.value.pending?.previousHead, next)
        XCTAssertEqual(store.value.acceptedBase, transfer,
            "preparing a candidate does not replace the accepted checkpoint")
    }

    func testCatchUpOwnerCanTransferAwayAndBackAcrossVerifiedHops() async throws {
        let verifier = Verifier(acceptedSignerKeys: [
            "accepted-root": "public-dsk",
            "to-new-owner": "public-dsk",
            "back-to-genesis": "new-public-dsk",
            "genesis-next": "public-dsk",
        ])
        let (store, _, transport, coordinator) = try fixture(verifier: verifier)
        let second = try signedHead(transferredEpoch(2, supersedes: 1, ownerIsNew: true), signature: "to-new-owner")
        let third = try signedHead(transferredEpoch(3, supersedes: 2, ownerIsNew: false), signature: "back-to-genesis")
        let fourth = try signedHead(transferredEpoch(4, supersedes: 3, ownerIsNew: false), signature: "genesis-next")
        transport.records[2] = second
        transport.records[3] = third
        transport.head = fourth

        let caughtUp = try await coordinator.catchUp(maximumRecords: 4)
        XCTAssertTrue(caughtUp)
        XCTAssertEqual(store.value.acceptedBase, third)
        XCTAssertEqual(store.value.head, fourth)
        let restarted = OrdinaryTrustSetCoordinator(store: store, signer: Signer(), verifier: verifier, transport: transport,
            trustedRootAnchor: try XCTUnwrap(store.value.rootAnchor), familyId: "family-test",
            deviceId: "owner-device", dskKeyId: "owner-dsk", dskAlias: "pca.dsk.attempt")
        let restartedAtHead = try await restarted.catchUp()
        XCTAssertTrue(restartedAtHead)
    }

    func testCatchUpClearsConflictingPendingBranchAtAcceptedEpoch() async throws {
        let (store, _, transport, coordinator) = try fixture()
        let root = try XCTUnwrap(store.value.rootAnchor)
        let localCandidate = try signedHead(epoch(2), signature: "locally-pending-branch")
        let acceptedBranch = try signedHead(epoch(2), signature: "server-accepted-branch")
        store.value.pending = OrdinaryTrustSetPending(previousHead: root, candidate: localCandidate,
            signerDeviceId: "owner-device", signerKeyId: "owner-dsk")
        transport.head = acceptedBranch

        let caughtUp = try await coordinator.catchUp()
        XCTAssertTrue(caughtUp)
        XCTAssertEqual(store.value.head, acceptedBranch)
        XCTAssertNil(store.value.pending, "a conflicting branch at the accepted floor cannot remain retryable")
        do {
            _ = try await coordinator.submitPending()
            XCTFail("a request made against the old root floor must not be replayable after catch-up")
        } catch let error as OrdinaryTrustSetError {
            XCTAssertEqual(error, .pendingSubmission)
        }
        XCTAssertTrue(transport.sent.isEmpty)
    }

    func testCatchUpClearsHigherEpochPendingCandidateWhoseBaseWasSuperseded() async throws {
        let (store, _, transport, coordinator) = try fixture()
        let root = try XCTUnwrap(store.value.rootAnchor)
        let staleHigherCandidate = try signedHead(epoch(3), signature: "stale-higher-candidate")
        let accepted = try signedHead(epoch(2), signature: "server-accepted")
        store.value.pending = OrdinaryTrustSetPending(previousHead: root, candidate: staleHigherCandidate,
            signerDeviceId: "owner-device", signerKeyId: "owner-dsk")
        transport.head = accepted
        transport.records[2] = accepted

        let caughtUp = try await coordinator.catchUp()
        XCTAssertTrue(caughtUp)
        XCTAssertEqual(store.value.head, accepted)
        XCTAssertNil(store.value.pending, "candidate epoch alone cannot preserve a request after its base advances")
        do {
            _ = try await coordinator.submitPending()
            XCTFail("a higher-epoch candidate with a stale predecessor must not be replayable")
        } catch let error as OrdinaryTrustSetError {
            XCTAssertEqual(error, .pendingSubmission)
        }
        XCTAssertTrue(transport.sent.isEmpty)
    }

    func testIncomingOwnerCatchUpRetiresPriorOwnersStalePendingAttempt() async throws {
        let (store, signer, transport, _) = try fixture()
        let root = try XCTUnwrap(store.value.rootAnchor)
        let transfer = try signedHead(transferredEpoch(2, supersedes: 1, ownerIsNew: true), signature: "owner-transfer")
        store.value = OrdinaryTrustSetRecord(head: transfer,
            pending: OrdinaryTrustSetPending(previousHead: root, candidate: try signedHead(epoch(2), signature: "old-owner-pending"),
                signerDeviceId: "owner-device", signerKeyId: "owner-dsk"),
            rootAnchor: root, acceptedBase: root)
        transport.head = transfer
        let incomingOwner = OrdinaryTrustSetCoordinator(store: store, signer: signer, verifier: Verifier(),
            transport: transport, trustedRootAnchor: root, familyId: "family-test",
            deviceId: "new-owner-device", dskKeyId: "new-owner-dsk", dskAlias: "pca.dsk.new-owner")

        let caughtUp = try await incomingOwner.catchUp()
        XCTAssertTrue(caughtUp)
        XCTAssertEqual(store.value.head, transfer)
        XCTAssertNil(store.value.pending, "a stale attempt owned by the former Owner cannot strand the incoming Owner")
        XCTAssertTrue(transport.sent.isEmpty)
    }

    func testTransferMustBeSignedByOutgoingOwnerAndCheckpointCannotSkipBase() async throws {
        let verifier = Verifier(acceptedSignerKeys: [
            "accepted-root": "public-dsk",
            "transfer-by-new-owner": "new-public-dsk",
            "transfer-by-genesis": "public-dsk",
            "next-by-new-owner": "new-public-dsk",
        ])
        let (store, signer, transport, coordinator) = try fixture(verifier: verifier)
        let invalidTransfer = try signedHead(transferredEpoch(2, supersedes: 1, ownerIsNew: true),
            signature: "transfer-by-new-owner")
        transport.head = invalidTransfer
        do {
            _ = try await coordinator.catchUp()
            XCTFail("the incoming Owner cannot self-authorize a transfer")
        } catch let error as OrdinaryTrustSetError {
            XCTAssertEqual(error, .unauthorizedSigner)
        }
        XCTAssertEqual(store.value.head, try XCTUnwrap(store.value.rootAnchor))

        let transfer = try signedHead(transferredEpoch(2, supersedes: 1, ownerIsNew: true), signature: "transfer-by-genesis")
        let next = try signedHead(transferredEpoch(3, supersedes: 2, ownerIsNew: true), signature: "next-by-new-owner")
        transport.records[2] = transfer
        transport.head = next
        let caughtUp = try await coordinator.catchUp(maximumRecords: 4)
        XCTAssertTrue(caughtUp)
        let accepted = store.value
        store.value.acceptedBase = try XCTUnwrap(store.value.rootAnchor)
        let staleCheckpoint = store.value
        do {
            _ = try await coordinator.catchUp()
            XCTFail("a checkpoint that skips the exact accepted predecessor must fail closed")
        } catch {}
        XCTAssertEqual(store.value, staleCheckpoint)
        XCTAssertEqual(signer.calls, 0)
        XCTAssertNotEqual(accepted, staleCheckpoint)
    }

    func testPrepareDoesNotSignAgainstStaleRemoteHead() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        transport.head = try signedHead(epoch(2), signature: "server-ahead")
        do {
            try await coordinator.prepare(epoch(2))
            XCTFail("a stale local snapshot must not be signed")
        } catch let error as OrdinaryTrustSetError {
            XCTAssertEqual(error, .responseMismatch)
        }
        XCTAssertEqual(signer.calls, 0)
        XCTAssertNil(store.value.pending)
    }

    func testSubmitDoesNotRetryPendingAgainstDifferentRemoteHead() async throws {
        let (store, signer, transport, coordinator) = try fixture()
        try await coordinator.prepare(epoch(2))
        let pending = try XCTUnwrap(store.value.pending)
        transport.head = try signedHead(epoch(3), signature: "server-advanced")

        do {
            _ = try await coordinator.submitPending()
            XCTFail("a pending request must not be replayed against a different accepted head")
        } catch let error as OrdinaryTrustSetError {
            XCTAssertEqual(error, .responseMismatch)
        }
        XCTAssertTrue(transport.sent.isEmpty)
        XCTAssertEqual(store.value.pending, pending)
        XCTAssertEqual(signer.calls, 1, "exact persisted bytes remain available without re-signing")
    }

    func testKeychainStoreRequiresExactAcceptedBaseOnAdvanceAndKeepsRootImmutable() throws {
        let root = try rootHead()
        let custody = KeychainOrdinaryTrustSetStore(keychain: InMemoryKeychainStore(), account: "owner-device")
        XCTAssertTrue(try custody.compareAndSetDurably(expected: nil,
            next: OrdinaryTrustSetRecord(head: root, rootAnchor: root)))
        let current = try custody.load()
        let successor = try signedHead(epoch(2), signature: "next")
        XCTAssertThrowsError(try custody.compareAndSetDurably(expected: current,
            next: OrdinaryTrustSetRecord(head: successor, rootAnchor: root))) {
            XCTAssertEqual($0 as? OrdinaryTrustSetError, .responseMismatch,
                "advancement without the exact previously trusted acceptedBase is rejected")
        }
        XCTAssertTrue(try custody.compareAndSetDurably(expected: current,
            next: OrdinaryTrustSetRecord(head: successor, rootAnchor: root, acceptedBase: root)))
        let advanced = try custody.load()
        let changedRoot = OrdinaryTrustSetHead(familyId: root.familyId, canonicalBytes: root.canonicalBytes, signature: "changed-root")
        XCTAssertThrowsError(try custody.compareAndSetDurably(expected: advanced,
            next: OrdinaryTrustSetRecord(head: successor, rootAnchor: changedRoot, acceptedBase: root))) {
            XCTAssertEqual($0 as? OrdinaryTrustSetError, .responseMismatch)
        }
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
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(2)), signature: "epoch-two"), rootAnchor: head,
            acceptedBase: head)
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
        let originalHead = OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(1)), signature: "root")
        let original = OrdinaryTrustSetRecord(head: originalHead, rootAnchor: originalHead)
        XCTAssertTrue(try first.compareAndSetDurably(expected: nil, next: original))
        let advanced = OrdinaryTrustSetRecord(head: OrdinaryTrustSetHead(familyId: "family-test",
            canonicalBytes: try FamilyTrustSetCodec.canonicalize(epoch(2)), signature: "next"), rootAnchor: original.head,
            acceptedBase: original.head)
        XCTAssertTrue(try second.compareAndSetDurably(expected: original, next: advanced))
        XCTAssertFalse(try first.compareAndSetDurably(expected: original, next: original))
        XCTAssertThrowsError(try first.compareAndSetDurably(expected: advanced, next: original))
        XCTAssertEqual(try first.load(), advanced)
    }

    func testKeychainPersistedTrustSetRejectsEscapedDuplicateMembers() throws {
        let root = try rootHead()
        let encodedRoot = String(decoding: try JSONEncoder().encode(root), as: UTF8.self)
        let headWithEscapedDuplicate = "{\"familyId\":\"family-test\",\"canonicalBytes\":\"\(root.canonicalBytes.base64EncodedString())\",\"signature\":\"accepted-root\",\"sign\\u0061ture\":\"accepted-root\"}"
        let duplicateHeadBytes = Data(headWithEscapedDuplicate.utf8)
        if let directDecode = try? JSONDecoder().decode(OrdinaryTrustSetHead.self, from: duplicateHeadBytes) {
            XCTAssertEqual(directDecode, root, "If Codable accepts the escaped duplicate, it must resolve to the valid root")
        }
        let persisted = "{\"head\":\(headWithEscapedDuplicate),\"rootAnchor\":\(encodedRoot),\"pending\":null}"
        let keychain = InMemoryKeychainStore()
        try keychain.store(Data(persisted.utf8), forAccount: "owner-device",
            service: "org.pca.ordinary-trust-set.v1", accessibility: .whenUnlockedThisDeviceOnly)
        let store = KeychainOrdinaryTrustSetStore(keychain: keychain, account: "owner-device")

        XCTAssertThrowsError(try store.load()) { error in
            XCTAssertEqual(error as? OrdinaryTrustSetError, .malformedState)
        }
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
