import XCTest
@testable import PCA

/// WAVE 6D regression coverage for the ceremony coordinator's iron rules:
/// no optimistic commit, byte-stable replay (never re-sign), status-only
/// resolution once a submission is persisted, EXPIRED trim, rejection
/// sweep, and the exact payload construction (transcript + evidence digest
/// binding). All transports/keys/evidence are in-memory fakes.
final class FirstDeviceTrustRootCoordinatorTests: XCTestCase {

    private final class RootLockTestContext: @unchecked Sendable {
        let store: FirstDeviceRootStoring
        let replacement: FirstDeviceRootRecord
        init(store: FirstDeviceRootStoring, replacement: FirstDeviceRootRecord) {
            self.store = store
            self.replacement = replacement
        }
    }

    func testConfirmedCleanupSerializesConcurrentRootReplacement() throws {
        let retained = approvedRecord()
        var replacement = retained
        replacement.seed = makeSeed().replacingAttemptId("replacement-attempt")
        let keychain = FailingOverwriteKeychainStore()
        keychain.storedData = try JSONEncoder().encode(retained)
        let stores: [FirstDeviceRootStoring] = [
            InMemoryFirstDeviceRootStore(record: retained),
            KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.test")
        ]
        for store in stores {
            let context = RootLockTestContext(store: store, replacement: replacement)
            let entered = DispatchSemaphore(value: 0)
            let release = DispatchSemaphore(value: 0)
            let sweepDone = DispatchSemaphore(value: 0)
            let writerStarted = DispatchSemaphore(value: 0)
            let writerDone = DispatchSemaphore(value: 0)
            defer { release.signal() }
            DispatchQueue.global().async {
                context.store.withConfirmedCurrentRecord { _ in
                    entered.signal()
                    _ = release.wait(timeout: .now() + 3)
                }
                sweepDone.signal()
            }
            XCTAssertEqual(entered.wait(timeout: .now() + 2), .success)
            DispatchQueue.global().async {
                writerStarted.signal()
                _ = context.store.save(context.replacement)
                writerDone.signal()
            }
            XCTAssertEqual(writerStarted.wait(timeout: .now() + 2), .success)
            XCTAssertEqual(writerDone.wait(timeout: .now() + 0.1), .timedOut)
            release.signal()
            XCTAssertEqual(sweepDone.wait(timeout: .now() + 2), .success)
            XCTAssertEqual(writerDone.wait(timeout: .now() + 2), .success)
            XCTAssertEqual(store.current(), replacement)
        }
    }

    // MARK: - Fakes

    private final class FakeApiClient: FirstDeviceBootstrapApiClienting {
        var challengeResult: Result<FirstDeviceChallengeResponse, FirstDeviceBootstrapError> = .failure(.unavailable)
        var submitResult: Result<FirstDeviceSubmitResponse, FirstDeviceBootstrapError> = .failure(.rejected)
        var statusResult: Result<FirstDeviceStatusResponse, FirstDeviceBootstrapError> = .failure(.unavailable)
        private(set) var challengeCalls = 0
        private(set) var submitCalls: [[String: String]] = []
        private(set) var statusCalls = 0
        private(set) var statusCeremonyIds: [String] = []
        /// Test barrier: when true, `submit` suspends until `releaseSubmit()`.
        var holdSubmit = false
        var beforeChallengeReturn: (() -> Void)?
        private(set) var submitEntered = false
        private var submitBarrier: CheckedContinuation<Void, Never>?

        func releaseSubmit() {
            submitBarrier?.resume()
            submitBarrier = nil
        }

        func challenge(attemptId: String, attemptRecoveryToken: String, dskKeyId: String, dskPublicKeyBase64: String) async throws -> FirstDeviceChallengeResponse {
            challengeCalls += 1
            beforeChallengeReturn?()
            switch challengeResult {
            case .success(let value): return value
            case .failure(let error): throw error
            }
        }

        func submit(attemptId: String, attemptRecoveryToken: String, ceremonyId: String, proofBytes: String, proofSignature: String, epoch1Bytes: String, epoch1Signature: String, attestationEvidence: String) async throws -> FirstDeviceSubmitResponse {
            submitCalls.append([
                "ceremonyId": ceremonyId,
                "proofBytes": proofBytes,
                "proofSignature": proofSignature,
                "epoch1Bytes": epoch1Bytes,
                "epoch1Signature": epoch1Signature,
                "attestationEvidence": attestationEvidence,
            ])
            submitEntered = true
            if holdSubmit {
                await withCheckedContinuation { continuation in
                    submitBarrier = continuation
                }
            }
            switch submitResult {
            case .success(let value): return value
            case .failure(let error): throw error
            }
        }

        func status(attemptId: String, attemptRecoveryToken: String, ceremonyId: String) async throws -> FirstDeviceStatusResponse {
            statusCalls += 1
            statusCeremonyIds.append(ceremonyId)
            switch statusResult {
            case .success(let value): return value
            case .failure(let error): throw error
            }
        }
    }

    private final class FakeKeyMaterial: FirstDeviceDskKeyMaterial {
        var signCount = 0
        var failSigning = false

        func signingKeyAlias(attemptId: String) -> String { "pca.dsk." + attemptId }
        func encryptionKeyAlias(attemptId: String) -> String { "pca.dek." + attemptId }
        func loadPublicKeyBase64(alias: String) throws -> String { "pub-" + alias }
        func generateSigningKeyPair(attemptId: String) throws -> GeneratedDskKeyPair {
            GeneratedDskKeyPair(publicKeyBase64: "pub-dsk", privateKeyAlias: signingKeyAlias(attemptId: attemptId))
        }
        func generateEncryptionKeyPair(attemptId: String) throws -> GeneratedDskKeyPair {
            GeneratedDskKeyPair(publicKeyBase64: "pub-dek", privateKeyAlias: encryptionKeyAlias(attemptId: attemptId))
        }
        func signCanonical(alias: String, message: Data) throws -> Data {
            if failSigning { throw SecureEnclaveDskError.keyMaterialMissing }
            signCount += 1
            // Deterministic pseudo-signature; the tests only compare bytes.
            var digest = Data()
            for byte in message.prefix(8) { digest.append(byte &+ 1) }
            while digest.count < 64 { digest.append(0x5A) }
            return digest
        }
    }

    private final class FakeEvidenceBuilder: FirstDeviceEvidenceBuilding {
        var callCount = 0
        var lastTranscript: String?
        var evidence = #"{"v":1,"platform":"IOS"}"#
        var error: Error?

        func buildEvidence(transcript: String, dskKeyId: String, dskPublicKeyBase64: String) async throws -> IosAppAttestEvidence {
            if let error { throw error }
            callCount += 1
            lastTranscript = transcript
            return IosAppAttestEvidence(json: evidence, keyIdBase64Url: "keyid")
        }
    }

    private final class FailingOverwriteKeychainStore: KeychainStoreProtocol {
        private enum StoreFailure: Error { case injected }
        var storedData: Data?
        var failNextStore = false
        var failNextRetrieve = false
        var failRetrieveOnCall: Int?
        private(set) var retrieveCalls = 0
        private(set) var atomicReplaceCalls = 0

        func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
            if failNextStore {
                failNextStore = false
                throw StoreFailure.injected
            }
            storedData = data
        }

        func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
            atomicReplaceCalls += 1
            // This fake models update/add semantics: failure leaves the old
            // item untouched, as the production SecItemUpdate path must.
            try store(data, forAccount: account, service: service, accessibility: accessibility)
        }

        func retrieve(forAccount account: String, service: String) throws -> Data {
            retrieveCalls += 1
            if failRetrieveOnCall == retrieveCalls {
                throw StoreFailure.injected
            }
            if failNextRetrieve {
                failNextRetrieve = false
                throw StoreFailure.injected
            }
            guard let storedData else { throw KeychainStoreError.itemNotFound }
            return storedData
        }

        func delete(forAccount account: String, service: String) throws {
            storedData = nil
        }
    }

    // MARK: - Builders

    private func makeSeed() -> FirstDeviceCeremonySeed {
        FirstDeviceCeremonySeed(
            attemptId: "attempt0000000001",
            attemptRecoveryToken: "recovery-token",
            serverBaseUrl: "https://api.example.test",
            deviceId: "device-1",
            signingKeyId: "55555555-5555-4555-8555-555555555555",
            encryptionKeyId: "66666666-6666-4666-8666-666666666666",
            dskPublicKeyBase64: "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A",
            dekPublicKeyBase64: "BP_-_fz7-vn49_b19PPy8fDv7u3s6-rp6Ofm5eTj4uHg397d3Nva2djX1tXU09LR0M_OzczLysnIx8bFxMPCwcA",
            dskAlias: "pca.dsk.attempt0000000001",
            dekAlias: "pca.dek.attempt0000000001"
        )
    }

    private func makeCoordinator(
        record: FirstDeviceRootRecord? = nil,
        api: FakeApiClient = FakeApiClient(),
        keyMaterial: FakeKeyMaterial = FakeKeyMaterial(),
        evidence: FakeEvidenceBuilder = FakeEvidenceBuilder()
    ) -> (FirstDeviceTrustRootCoordinator, InMemoryFirstDeviceRootStore, FakeApiClient, FakeKeyMaterial, FakeEvidenceBuilder) {
        let store = InMemoryFirstDeviceRootStore(record: record)
        let coordinator = FirstDeviceTrustRootCoordinator(
            rootStore: store,
            apiClient: api,
            keyMaterial: keyMaterial,
            evidenceBuilder: evidence,
            now: { Date(timeIntervalSince1970: 1_759_766_400) } // 2025-10-04T00:00:00Z
        )
        return (coordinator, store, api, keyMaterial, evidence)
    }

    private func approvedRecord(withSubmission: FirstDeviceSubmissionPayload? = nil) -> FirstDeviceRootRecord {
        FirstDeviceRootRecord(
            seed: makeSeed(),
            state: .approved,
            ceremonyId: "33333333-3333-4333-8333-333333333333",
            challengeId: "44444444-4444-4444-8444-444444444444",
            nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            expiresAt: "2026-10-02T00:00:00.000Z",
            familyId: "11111111-1111-4111-8111-111111111111",
            submission: withSubmission
        )
    }

    // MARK: - Tests

    func testBeginCeremonyPersistsChallengeAndFlushes() async {
        let (coordinator, store, api, _, _) = makeCoordinator(record: FirstDeviceRootRecord(seed: makeSeed()))
        api.challengeResult = .success(FirstDeviceChallengeResponse(
            ceremonyId: "c-1", challengeId: "ch-1", nonce: "n-1",
            expiresAt: "2026-10-02T00:00:00.000Z", familyId: "f-1", deviceId: "device-1"
        ))
        await coordinator.beginCeremony()
        let record = try! XCTUnwrap(store.current())
        XCTAssertEqual(record.state, .awaitingApproval)
        XCTAssertEqual(record.ceremonyId, "c-1")
        XCTAssertEqual(record.challengeId, "ch-1")
        XCTAssertEqual(record.nonce, "n-1")
        XCTAssertEqual(record.expiresAt, "2026-10-02T00:00:00.000Z")
        XCTAssertEqual(record.familyId, "f-1")
        XCTAssertEqual(api.challengeCalls, 1)
    }

    func testBeginCeremonyWithPersistedSubmissionNeverReChallenges() async {
        let payload = FirstDeviceSubmissionPayload(proofBytes: "p", proofSignature: "ps", epoch1Bytes: "e", epoch1Signature: "es", attestationEvidence: "{}")
        var record = approvedRecord(withSubmission: payload)
        record.state = .unknown
        let (coordinator, _, api, _, _) = makeCoordinator(record: record)
        api.statusResult = .success(FirstDeviceStatusResponse(status: "APPROVED", outcome: nil))
        await coordinator.beginCeremony()
        XCTAssertEqual(api.challengeCalls, 0, "a persisted submission must resolve via status only")
        XCTAssertEqual(api.statusCalls, 1)
    }

    func testSubmitBuildsPersistsAndSendsByteStablePayload() async {
        let (coordinator, store, api, keyMaterial, evidence) = makeCoordinator(record: approvedRecord())
        api.submitResult = .success(FirstDeviceSubmitResponse(status: "ACCEPTED"))
        await coordinator.submit()

        XCTAssertEqual(api.submitCalls.count, 1)
        let sent = api.submitCalls[0]
        XCTAssertEqual(sent["ceremonyId"], "33333333-3333-4333-8333-333333333333")
        XCTAssertEqual(evidence.callCount, 1)
        XCTAssertEqual(keyMaterial.signCount, 2, "epoch-1 and proof must each be signed exactly once")
        // The transcript handed to App Attest is the exact canonical 10-field string.
        XCTAssertEqual(
            evidence.lastTranscript,
            "26:PCA_IOS_DSK_ATTESTATION_V11:136:11111111-1111-4111-8111-1111111111118:device-136:33333333-3333-4333-8333-33333333333336:44444444-4444-4444-8444-44444444444443:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA17:ECDSA_P256_SHA25636:55555555-5555-4555-8555-55555555555587:BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A"
        )
        // The evidence digest is bound into the DSK-signed proof (64 hex chars netstring-framed).
        let expectedDigest = FirstDeviceCanonical.sha256Hex(evidence.evidence)
        XCTAssertEqual(expectedDigest.count, 64)
        XCTAssertTrue(sent["proofBytes"]!.contains("64:\(expectedDigest)"), "proof must contain sha256Hex(evidence)")
        // Server-authoritative acceptance: ROOT_COMMITTED with trimmed record.
        let record = try! XCTUnwrap(store.current())
        XCTAssertEqual(record.state, .rootCommitted)
        XCTAssertNil(record.submission)
        XCTAssertNil(record.nonce)
        XCTAssertEqual(record.seed.attemptRecoveryToken, "", "the one-time recovery token must be cleared on commit")
    }

    func testResubmitReplaysExactBytesAndNeverReSigns() async {
        let (coordinator, _, api, keyMaterial, evidence) = makeCoordinator(record: approvedRecord())
        api.submitResult = .failure(.ambiguousOutcome)
        await coordinator.submit()
        let afterFirst = api.submitCalls[0]
        XCTAssertEqual(evidence.callCount, 1)
        let signCountAfterFirst = keyMaterial.signCount

        api.submitResult = .success(FirstDeviceSubmitResponse(status: "ACCEPTED"))
        await coordinator.resubmitExact()

        XCTAssertEqual(api.submitCalls.count, 2)
        XCTAssertEqual(api.submitCalls[1], afterFirst, "the replay must be byte-identical")
        XCTAssertEqual(keyMaterial.signCount, signCountAfterFirst, "a replay must never re-sign")
        XCTAssertEqual(evidence.callCount, 1, "a replay must never rebuild evidence")
    }

    func testAmbiguousSubmitLandsInUnknownAndOnlyStatusResolves() async {
        let (coordinator, store, api, _, _) = makeCoordinator(record: approvedRecord())
        api.submitResult = .failure(.ambiguousOutcome)
        await coordinator.submit()
        XCTAssertEqual(store.current()?.state, .unknown)

        // beginCeremony must NOT mint a new challenge from UNKNOWN with a
        // persisted submission; only status() may resolve it.
        api.statusResult = .success(FirstDeviceStatusResponse(status: "COMMITTED", outcome: "ACCEPTED"))
        await coordinator.beginCeremony()
        XCTAssertEqual(api.challengeCalls, 0)
        XCTAssertEqual(store.current()?.state, .rootCommitted)
    }

    func testRejectedSubmitSweepsToRejectedOnlyWhileStillApproved() async {
        let (coordinator, store, api, _, _) = makeCoordinator(record: approvedRecord())
        api.submitResult = .failure(.rejected)
        api.statusResult = .success(FirstDeviceStatusResponse(status: "APPROVED", outcome: nil))
        await coordinator.submit()
        XCTAssertEqual(store.current()?.state, .rejected)
    }

    func testRejectedSubmitWithCommittedStatusNeverDowngrades() async {
        let (coordinator, store, api, _, _) = makeCoordinator(record: approvedRecord())
        api.submitResult = .failure(.rejected)
        api.statusResult = .success(FirstDeviceStatusResponse(status: "COMMITTED", outcome: "ACCEPTED"))
        await coordinator.submit()
        XCTAssertEqual(store.current()?.state, .rootCommitted)
    }

    func testExpiredStatusTrimsSubmissionAndAllowsRestart() async {
        let payload = FirstDeviceSubmissionPayload(proofBytes: "p", proofSignature: "ps", epoch1Bytes: "e", epoch1Signature: "es", attestationEvidence: "{}")
        var record = approvedRecord(withSubmission: payload)
        record.state = .submitting
        let (coordinator, store, api, _, _) = makeCoordinator(record: record)
        api.statusResult = .success(FirstDeviceStatusResponse(status: "EXPIRED", outcome: nil))
        await coordinator.refreshStatus()
        XCTAssertEqual(store.current()?.state, .expired)
        XCTAssertNil(store.current()?.submission, "an authoritatively expired ceremony trims its persisted submission")
    }

    func testSigningFailureFailsClosedToUnknownWithoutFabrication() async {
        let keyMaterial = FakeKeyMaterial()
        keyMaterial.failSigning = true
        let (coordinator, store, api, _, _) = makeCoordinator(record: approvedRecord(), keyMaterial: keyMaterial)
        await coordinator.submit()
        XCTAssertEqual(store.current()?.state, .unknown)
        XCTAssertEqual(api.submitCalls.count, 0, "nothing may reach the network when signing fails")
    }

    func testRootCommittedIsTerminalForRefresh() async {
        var record = approvedRecord()
        record.state = .rootCommitted
        let (coordinator, store, api, _, _) = makeCoordinator(record: record)
        api.statusResult = .success(FirstDeviceStatusResponse(status: "PENDING", outcome: nil))
        await coordinator.refreshStatus()
        XCTAssertEqual(store.current()?.state, .rootCommitted)
        XCTAssertEqual(api.statusCalls, 0, "a committed root is terminal; no status call is even needed")
    }

    func testStatusUnavailableMovesToUnknown() async {
        let (coordinator, store, api, _, _) = makeCoordinator(record: approvedRecord())
        api.statusResult = .failure(.unavailable)
        await coordinator.refreshStatus()
        XCTAssertEqual(store.current()?.state, .unknown)
    }

    // MARK: - QA gap batch (Stage B): lifecycle paths, gate FIFO, fail-closed

    func testBeginCeremonyFromAwaitingApprovalReusesTheCeremonyViaStatusOnly() async {
        var record = approvedRecord()
        record.state = .awaitingApproval
        let (coordinator, store, api, _, _) = makeCoordinator(record: record)
        api.statusResult = .success(FirstDeviceStatusResponse(status: "APPROVED", outcome: nil))
        await coordinator.beginCeremony()
        XCTAssertEqual(api.challengeCalls, 0, "an existing ceremony is only ever resolved via status")
        XCTAssertEqual(api.statusCalls, 1)
        XCTAssertEqual(store.current()?.state, .approved)
    }

    func testBeginCeremonyFromRootCommittedDoesNothing() async {
        var record = approvedRecord()
        record.state = .rootCommitted
        let (coordinator, _, api, _, _) = makeCoordinator(record: record)
        await coordinator.beginCeremony()
        XCTAssertEqual(api.challengeCalls, 0)
        XCTAssertEqual(api.statusCalls, 0, "a committed root is terminal; no network call may occur")
    }

    func testSubmitWithNonAcceptedSuccessBodyFailsClosedToUnknown() async {
        let (coordinator, store, api, _, _) = makeCoordinator(record: approvedRecord())
        api.submitResult = .success(FirstDeviceSubmitResponse(status: "PENDING"))
        await coordinator.submit()
        XCTAssertEqual(store.current()?.state, .unknown, "only an ACCEPTED body may commit")
    }

    func testEvidenceFailureFailsClosedWithoutSendingAndWithoutWedging() async {
        let evidence = FakeEvidenceBuilder()
        evidence.error = IosAppAttestError.appAttestUnsupported
        let (coordinator, store, api, _, _) = makeCoordinator(record: approvedRecord(), evidence: evidence)
        await coordinator.submit()
        XCTAssertEqual(store.current()?.state, .unknown)
        XCTAssertEqual(api.submitCalls.count, 0, "nothing may reach the network without evidence")

        // The gate must release after the failure: a later status resolves normally.
        api.statusResult = .success(FirstDeviceStatusResponse(status: "PENDING", outcome: nil))
        await coordinator.refreshStatus()
        XCTAssertEqual(api.statusCalls, 1)
        XCTAssertEqual(store.current()?.state, .awaitingApproval)
    }

    func testCancelledWaitingOperationDoesNotRunAndReleasesGate() async throws {
        let gate = FirstDeviceSingleFlightGate()
        await gate.lock()
        let cancelled = Task {
            try await gate.run {
                XCTFail("A cancelled operation must not touch ceremony state or transport")
            }
        }
        cancelled.cancel()
        await gate.unlock()
        do {
            try await cancelled.value
            XCTFail("The gate must preserve cancellation")
        } catch is CancellationError {
            // Expected whether cancellation arrived before or during queueing.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        let subsequent = try await gate.run { 42 }
        XCTAssertEqual(subsequent, 42, "Cancellation must release the gate")
    }

    func testSingleFlightGateSerializesConcurrentOperationsFIFO() async throws {
        let (coordinator, store, api, _, _) = makeCoordinator(record: approvedRecord())
        api.holdSubmit = true
        api.submitResult = .failure(.ambiguousOutcome) // completes to .unknown; no status call of its own
        api.statusResult = .success(FirstDeviceStatusResponse(status: "COMMITTED", outcome: "ACCEPTED"))

        let submitTask = Task { await coordinator.submit() }
        // Wait until the submit is INSIDE the gate (suspended in the fake).
        var spins = 0
        while !api.submitEntered && spins < 10_000 {
            await Task.yield()
            spins += 1
        }
        XCTAssertTrue(api.submitEntered, "submit must reach the fake")

        let statusTask = Task { await coordinator.refreshStatus() }
        var statusSpins = 0
        while statusSpins < 500 {
            await Task.yield()
            statusSpins += 1
        }
        XCTAssertEqual(api.statusCalls, 0, "the FIFO gate must hold the second operation until submit completes")

        api.holdSubmit = false
        api.releaseSubmit()
        await submitTask.value
        XCTAssertEqual(api.submitCalls.count, 1)
        await statusTask.value

        XCTAssertEqual(api.statusCalls, 1, "the queued operation runs AFTER the first completes -- FIFO, not interleaved")
        XCTAssertEqual(store.current()?.state, .rootCommitted)
    }

    func testStaleChallengeResponseCannotOverwriteARecordWrittenDuringNetworkAwait() async {
        let original = FirstDeviceRootRecord(seed: makeSeed())
        let api = FakeApiClient()
        api.challengeResult = .success(FirstDeviceChallengeResponse(
            ceremonyId: "c-1", challengeId: "ch-1", nonce: "n-1",
            expiresAt: "2026-10-02T00:00:00.000Z", familyId: "family-1", deviceId: "device-1"
        ))
        let store = InMemoryFirstDeviceRootStore(record: original)
        let coordinator = FirstDeviceTrustRootCoordinator(
            rootStore: store,
            apiClient: api,
            keyMaterial: FakeKeyMaterial(),
            evidenceBuilder: FakeEvidenceBuilder()
        )
        var concurrentRecord = original
        concurrentRecord.state = .unknown
        concurrentRecord.ceremonyId = "newer-ceremony"
        api.beforeChallengeReturn = {
            XCTAssertTrue(store.writeIfCurrent(expected: original, record: concurrentRecord))
        }

        await coordinator.beginCeremony()

        XCTAssertEqual(api.challengeCalls, 1)
        XCTAssertEqual(store.current(), concurrentRecord)
        XCTAssertEqual(coordinator.record, original, "the stale challenge result must not be published")
    }

    func testKeychainRootStoreReportsFailedOverwriteDespiteOlderReadableRecord() throws {
        let previous = approvedRecord()
        let keychain = FailingOverwriteKeychainStore()
        keychain.storedData = try JSONEncoder().encode(previous)
        keychain.failNextStore = true
        let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.test")

        var submitting = previous
        submitting.state = .submitting
        submitting.submission = FirstDeviceSubmissionPayload(
            proofBytes: "proof",
            proofSignature: "signature",
            epoch1Bytes: "epoch",
            epoch1Signature: "signature",
            attestationEvidence: "evidence"
        )

        XCTAssertFalse(store.save(submitting))
        XCTAssertEqual(store.current(), previous)
        XCTAssertEqual(keychain.atomicReplaceCalls, 1)
    }

    func testRootCleanupRequiresReadableAndConfirmedRetainedRecord() throws {
        let retained = approvedRecord()
        for failingRead in [1, 2] {
            let keychain = FailingOverwriteKeychainStore()
            let original = try JSONEncoder().encode(retained)
            keychain.storedData = original
            keychain.failRetrieveOnCall = failingRead
            let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.test")
            var swept = false
            XCTAssertFalse(store.withConfirmedCurrentRecord { _ in swept = true })
            XCTAssertFalse(swept)
            XCTAssertEqual(keychain.storedData, original)
        }
        for data in [Data?.none, Data("malformed-root".utf8)] {
            let keychain = FailingOverwriteKeychainStore()
            keychain.storedData = data
            let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.test")
            XCTAssertFalse(store.withConfirmedCurrentRecord { _ in XCTFail("unreadable root must never authorize key deletion") })
        }
        let keychain = FailingOverwriteKeychainStore()
        keychain.storedData = try JSONEncoder().encode(retained)
        let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.test")
        var keepAttemptIds: Set<String> = []
        XCTAssertTrue(store.withConfirmedCurrentRecord { record in
            keepAttemptIds = ["new-attempt", record.seed.attemptId]
        })
        XCTAssertEqual(keepAttemptIds, ["new-attempt", retained.seed.attemptId])
        XCTAssertEqual(store.current(), retained)
    }

    func testCoordinatorDoesNotSubmitWhenFailedKeychainOverwriteLeavesOldApprovedRecord() async throws {
        let previous = approvedRecord()
        let keychain = FailingOverwriteKeychainStore()
        keychain.storedData = try JSONEncoder().encode(previous)
        keychain.failNextStore = true
        let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.test")
        let api = FakeApiClient()
        let coordinator = FirstDeviceTrustRootCoordinator(
            rootStore: store,
            apiClient: api,
            keyMaterial: FakeKeyMaterial(),
            evidenceBuilder: FakeEvidenceBuilder(),
            now: { Date(timeIntervalSince1970: 1_759_766_400) }
        )

        await coordinator.submit()

        XCTAssertEqual(api.submitCalls.count, 0)
        XCTAssertEqual(store.current(), previous)
        XCTAssertEqual(coordinator.record, previous)
        XCTAssertEqual(keychain.atomicReplaceCalls, 1)
    }

    func testConditionalWriteAndSeedCaptureFailClosedOnMalformedKeychainValue() throws {
        let malformed = Data("not-json".utf8)
        let keychain = FailingOverwriteKeychainStore()
        keychain.storedData = malformed
        let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.test")
        let candidate = FirstDeviceRootRecord(seed: makeSeed())

        XCTAssertNil(store.current())
        XCTAssertFalse(store.writeIfCurrent(expected: nil, record: candidate))
        XCTAssertFalse(store.captureSeed(candidate, replacingTerminalStates: [.expired, .rejected]))
        XCTAssertEqual(keychain.storedData, malformed, "an unreadable root must not be replaced as if the slot were empty")
    }

    func testConditionalWriteAndSeedCaptureFailClosedOnKeychainReadError() {
        let keychain = FailingOverwriteKeychainStore()
        let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.test")
        let candidate = FirstDeviceRootRecord(seed: makeSeed())

        // A transport/keychain error is not evidence that the slot is empty;
        // only itemNotFound is absence.
        keychain.failNextRetrieve = true
        XCTAssertFalse(store.writeIfCurrent(expected: nil, record: candidate))
        keychain.failNextRetrieve = true
        XCTAssertFalse(store.captureSeed(candidate, replacingTerminalStates: [.expired, .rejected]))
        XCTAssertNil(keychain.storedData)
    }

    func testSameAttemptKeychainCaptureRequiresDurabilityReadbackAndPreservesCompleteRecord() throws {
        let previous = approvedRecord()
        let keychain = FailingOverwriteKeychainStore()
        keychain.storedData = try JSONEncoder().encode(previous)
        let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.test")

        keychain.failRetrieveOnCall = 2 // Existing-record read succeeds; confirmation read fails.
        XCTAssertFalse(store.captureSeed(FirstDeviceRootRecord(seed: previous.seed), replacingTerminalStates: [.expired, .rejected]))
        XCTAssertEqual(store.current(), previous)

        keychain.failRetrieveOnCall = nil
        XCTAssertTrue(store.captureSeed(FirstDeviceRootRecord(seed: previous.seed), replacingTerminalStates: [.expired, .rejected]))
        XCTAssertEqual(store.current(), previous)
    }

    func testCompetingKeychainCaptureConfirmsRetainedNonterminalRecord() throws {
        let previous = approvedRecord()
        let keychain = FailingOverwriteKeychainStore()
        keychain.storedData = try JSONEncoder().encode(previous)
        let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.test")
        let competitor = FirstDeviceRootRecord(seed: makeSeed().replacingAttemptId("different-attempt"))

        keychain.failRetrieveOnCall = 2 // Existing read succeeds; exact retained-record check fails.
        XCTAssertFalse(store.captureSeed(competitor, replacingTerminalStates: [.expired, .rejected]))
        XCTAssertEqual(store.current(), previous)

        keychain.failRetrieveOnCall = nil
        XCTAssertTrue(store.captureSeed(competitor, replacingTerminalStates: [.expired, .rejected]))
        XCTAssertEqual(store.current(), previous)
    }
}

private extension FirstDeviceCeremonySeed {
    func replacingAttemptId(_ attemptId: String) -> FirstDeviceCeremonySeed {
        FirstDeviceCeremonySeed(
            attemptId: attemptId,
            attemptRecoveryToken: attemptRecoveryToken,
            serverBaseUrl: serverBaseUrl,
            deviceId: deviceId,
            signingKeyId: signingKeyId,
            encryptionKeyId: encryptionKeyId,
            dskPublicKeyBase64: dskPublicKeyBase64,
            dekPublicKeyBase64: dekPublicKeyBase64,
            dskAlias: dskAlias,
            dekAlias: dekAlias
        )
    }
}
