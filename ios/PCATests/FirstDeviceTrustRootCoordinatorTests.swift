import XCTest
@testable import PCA

/// WAVE 6D regression coverage for the ceremony coordinator's iron rules:
/// no optimistic commit, byte-stable replay (never re-sign), status-only
/// resolution once a submission is persisted, EXPIRED trim, rejection
/// sweep, and the exact payload construction (transcript + evidence digest
/// binding). All transports/keys/evidence are in-memory fakes.
final class FirstDeviceTrustRootCoordinatorTests: XCTestCase {

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
        private(set) var submitEntered = false
        private var submitBarrier: CheckedContinuation<Void, Never>?

        func releaseSubmit() {
            submitBarrier?.resume()
            submitBarrier = nil
        }

        func challenge(attemptId: String, attemptRecoveryToken: String, dskKeyId: String, dskPublicKeyBase64: String) async throws -> FirstDeviceChallengeResponse {
            challengeCalls += 1
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
            "26:PCA_IOS_DSK_ATTESTATION_V11:136:11111111-1111-4111-8111-11111111111136:22222222-2222-4222-8222-22222222222236:33333333-3333-4333-8333-33333333333336:44444444-4444-4444-8444-44444444444443:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA17:ECDSA_P256_SHA25636:55555555-5555-4555-8555-55555555555587:BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A"
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
        XCTAssertEqual(store.current()?.state, .unknown, "the ambiguous submit resolved honestly before the waiter ran")
        await statusTask.value

        XCTAssertEqual(api.statusCalls, 1, "the queued operation runs AFTER the first completes -- FIFO, not interleaved")
        XCTAssertEqual(store.current()?.state, .rootCommitted)
        XCTAssertEqual(api.submitCalls.count, 1)
    }
}
