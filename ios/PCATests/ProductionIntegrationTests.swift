import XCTest
@testable import PCA

final class ProductionIntegrationTests: XCTestCase {
    func testFirstDeviceTrustRootRequiresExplicitApprovalAndDoesNotPromoteLifecycle() async throws {
        let rootStore = InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(seed: trustRootSeed()))
        let api = TrustRootFlowApi()
        api.challengeResponse = FirstDeviceChallengeResponse(
            ceremonyId: "33333333-3333-4333-8333-333333333333",
            challengeId: "44444444-4444-4444-8444-444444444444",
            nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            expiresAt: "2026-10-02T00:00:00.000Z",
            familyId: "11111111-1111-4111-8111-111111111111",
            deviceId: "device-1"
        )
        api.statusResponse = FirstDeviceStatusResponse(status: "APPROVED", outcome: nil)
        api.submitResponse = FirstDeviceSubmitResponse(status: "ACCEPTED")
        let keyMaterial = TrustRootFlowKeyMaterial()
        let evidence = TrustRootFlowEvidenceBuilder()
        let coordinator = try XCTUnwrap(PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: rootStore,
            apiClient: api,
            keyMaterial: keyMaterial,
            evidenceBuilder: evidence,
            appAttestIsSupported: true
        ))
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(),
            firstDeviceRootStore: rootStore,
            firstDeviceTrustRootCoordinator: coordinator
        )

        model.start()
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(api.challengeCalls, 0, "launch must not request parent approval")
        XCTAssertEqual(api.statusCalls, 0, "launch must not poll for approval")
        XCTAssertTrue(api.submissions.isEmpty)

        await model.submitApprovedFirstDeviceRoot()
        XCTAssertTrue(api.submissions.isEmpty, "submit is forbidden until the durable record is APPROVED")

        await model.requestFirstDeviceParentApproval()
        XCTAssertEqual(api.challengeCalls, 1)
        XCTAssertEqual(rootStore.current()?.state, .awaitingApproval)
        XCTAssertEqual(api.statusCalls, 0)

        await model.checkFirstDeviceParentApproval()
        XCTAssertEqual(api.statusCalls, 1)
        XCTAssertEqual(rootStore.current()?.state, .approved)
        XCTAssertTrue(api.submissions.isEmpty, "observing APPROVED must not auto-submit")

        await model.submitApprovedFirstDeviceRoot()
        XCTAssertEqual(api.submissions.count, 1)
        XCTAssertEqual(rootStore.current()?.state, .rootCommitted)
        XCTAssertEqual(model.firstDeviceRootRecord?.state, .rootCommitted)
        XCTAssertEqual(model.dependencies.protectionRuntime.status, .notReady, "root acceptance does not activate device lifecycle or protection")
        XCTAssertEqual(keyMaterial.signCount, 2)
        XCTAssertEqual(evidence.callCount, 1)
    }

    func testFirstDeviceTrustRootRetryReplaysPersistedSubmissionExactly() async throws {
        let payload = FirstDeviceSubmissionPayload(
            proofBytes: "saved-proof", proofSignature: "saved-proof-signature",
            epoch1Bytes: "saved-epoch", epoch1Signature: "saved-epoch-signature",
            attestationEvidence: "saved-evidence"
        )
        let rootStore = InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(
            seed: trustRootSeed(), state: .unknown,
            ceremonyId: "33333333-3333-4333-8333-333333333333",
            submission: payload
        ))
        let api = TrustRootFlowApi()
        api.submitResponse = FirstDeviceSubmitResponse(status: "ACCEPTED")
        let keyMaterial = TrustRootFlowKeyMaterial()
        let evidence = TrustRootFlowEvidenceBuilder()
        let coordinator = try XCTUnwrap(PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: rootStore,
            apiClient: api,
            keyMaterial: keyMaterial,
            evidenceBuilder: evidence,
            appAttestIsSupported: true
        ))
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(),
            firstDeviceRootStore: rootStore,
            firstDeviceTrustRootCoordinator: coordinator
        )

        await model.retrySavedFirstDeviceRootSubmission()

        XCTAssertEqual(api.submissions, [payload])
        XCTAssertEqual(keyMaterial.signCount, 0, "replay must not sign replacement bytes")
        XCTAssertEqual(evidence.callCount, 0, "replay must not rebuild App Attest evidence")
        XCTAssertEqual(rootStore.current()?.state, .rootCommitted)
    }

    func testExplicitParentApprovalRetryRecoversUnknownWithoutCeremonyId() async throws {
        let rootStore = InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(seed: trustRootSeed()))
        let api = TrustRootFlowApi()
        api.challengeError = .ambiguousOutcome
        let coordinator = try XCTUnwrap(PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: rootStore,
            apiClient: api,
            keyMaterial: TrustRootFlowKeyMaterial(),
            evidenceBuilder: TrustRootFlowEvidenceBuilder(),
            appAttestIsSupported: true
        ))
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(),
            firstDeviceRootStore: rootStore,
            firstDeviceTrustRootCoordinator: coordinator
        )

        await model.requestFirstDeviceParentApproval()
        XCTAssertEqual(rootStore.current()?.state, .unknown)
        XCTAssertNil(rootStore.current()?.ceremonyId)
        XCTAssertNil(rootStore.current()?.submission)
        XCTAssertEqual(api.challengeCalls, 1)

        api.challengeError = nil
        await model.requestFirstDeviceParentApproval()
        XCTAssertEqual(api.challengeCalls, 2, "only another explicit user action retries this ambiguous pre-challenge state")
        XCTAssertEqual(rootStore.current()?.state, .awaitingApproval)
        XCTAssertEqual(api.statusCalls, 0)
        XCTAssertTrue(api.submissions.isEmpty)
    }

    func testUnknownCeremonyWithIdRemainsStatusOnly() async throws {
        let rootStore = InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(
            seed: trustRootSeed(), state: .unknown, ceremonyId: "existing-ceremony"
        ))
        let api = TrustRootFlowApi()
        api.statusResponse = FirstDeviceStatusResponse(status: "APPROVED", outcome: nil)
        let coordinator = try XCTUnwrap(PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: rootStore,
            apiClient: api,
            keyMaterial: TrustRootFlowKeyMaterial(),
            evidenceBuilder: TrustRootFlowEvidenceBuilder(),
            appAttestIsSupported: true
        ))
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(),
            firstDeviceRootStore: rootStore,
            firstDeviceTrustRootCoordinator: coordinator
        )

        await model.requestFirstDeviceParentApproval()
        XCTAssertEqual(api.challengeCalls, 0, "an existing ceremony id must never be replaced by a new challenge")
        XCTAssertEqual(api.statusCalls, 0)

        await model.checkFirstDeviceParentApproval()
        XCTAssertEqual(api.challengeCalls, 0)
        XCTAssertEqual(api.statusCalls, 1)
        XCTAssertEqual(rootStore.current()?.state, .approved)
    }

    func testUnsupportedAppAttestCompositionFailsClosed() throws {
        let result = PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(seed: trustRootSeed())),
            apiClient: TrustRootFlowApi(),
            keyMaterial: TrustRootFlowKeyMaterial(),
            evidenceBuilder: TrustRootFlowEvidenceBuilder(),
            appAttestIsSupported: false
        )
        XCTAssertNil(result)
    }

    func testNullCoordinatorSnapshotRereadsDurableStateAndCannotEraseKnownState() async throws {
        let rootStore = SwitchableFirstDeviceRootStore()
        let coordinator = ManualTrustRootCoordinator()
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(),
            firstDeviceRootStore: rootStore,
            firstDeviceTrustRootCoordinator: coordinator
        )
        let record = FirstDeviceRootRecord(seed: trustRootSeed(), state: .awaitingApproval, ceremonyId: "ceremony")

        XCTAssertNil(model.firstDeviceRootRecord)
        XCTAssertTrue(rootStore.save(record))
        coordinator.onRecordChanged?(nil)
        for _ in 0..<100 where model.firstDeviceRootRecord == nil {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(model.firstDeviceRootRecord, record, "nil coordinator snapshots must trigger a durable-store read")

        rootStore.failCurrent = true
        coordinator.onRecordChanged?(nil)
        try? await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(model.firstDeviceRootRecord, record, "a failed durable read must not erase a previously verified state")
        XCTAssertTrue(model.firstDeviceRootReadUnavailable, "a stale cached record must not be presented as current")
    }

    func testBootstrapBuildsExistingBackendContractWithoutLoggingSecrets() async throws {
        let response = #"{"deviceId":"device-1","signingKeyId":"key-1","encryptionKeyId":"key-2","status":"PAIRING_PENDING","childProfileId":"child-1","ageUxTier":"TEEN","initialPolicyProfile":"BALANCED"}"#.data(using: .utf8)!
        let transport = InMemoryPCAHTTPTransport { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/v1/enrollment/bootstrap")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertFalse(try XCTUnwrap(request.httpBody).isEmpty)
            return PCAHTTPResponse(statusCode: 201, data: response)
        }
        let client = try PCAEnrollmentBootstrapClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
        let result = try await client.bootstrap(PCAEnrollmentBootstrapRequest(
            rawInvitationToken: String(repeating: "a", count: 43),
            signingPublicKey: "dsk-public",
            encryptionPublicKey: "dek-public",
            bootstrapAttemptId: String(repeating: "b", count: 16),
            attemptRecoveryToken: String(repeating: "c", count: 32)
        ))
        XCTAssertEqual(result.deviceId, "device-1")
        XCTAssertEqual(result.signingKeyId, "key-1")
        XCTAssertEqual(result.encryptionKeyId, "key-2")
        XCTAssertEqual(result.status, "PAIRING_PENDING")
        XCTAssertEqual(result.ageUxTier, .teen)
    }

    func testBootstrapMapsUnauthorizedWithoutExposingResponseBody() async throws {
        let secretLookingBody = Data(#"{"error":"session-token-should-never-be-presented"}"#.utf8)
        let transport = InMemoryPCAHTTPTransport { _ in PCAHTTPResponse(statusCode: 401, data: secretLookingBody) }
        let client = try PCAEnrollmentBootstrapClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
        do {
            _ = try await client.bootstrap(PCAEnrollmentBootstrapRequest(rawInvitationToken: "token", signingPublicKey: "dsk", encryptionPublicKey: "dek", bootstrapAttemptId: "attempt", attemptRecoveryToken: "recovery"))
            XCTFail("expected unauthorized")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .unauthorized)
            XCTAssertFalse(String(describing: error).contains("session-token"))
        }
    }

    func testBootstrapAndRecoveryRejectLaterLifecycleStatuses() async throws {
        for status in ["PAIRED", "ACTIVE", "REVOKED"] {
            let response = Data("{\"deviceId\":\"device-1\",\"status\":\"\(status)\",\"childProfileId\":\"child-1\",\"ageUxTier\":\"TEEN\",\"initialPolicyProfile\":\"BALANCED\"}".utf8)
            let transport = InMemoryPCAHTTPTransport { _ in PCAHTTPResponse(statusCode: 200, data: response) }
            let client = try PCAEnrollmentBootstrapClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)

            do {
                _ = try await client.bootstrap(PCAEnrollmentBootstrapRequest(rawInvitationToken: "token", signingPublicKey: "dsk", encryptionPublicKey: "dek", bootstrapAttemptId: "attempt", attemptRecoveryToken: "recovery"))
                XCTFail("bootstrap accepted \(status)")
            } catch let error as PCAAPIError {
                XCTAssertEqual(error, .malformedResponse)
            }

            do {
                _ = try await client.recover(attemptId: "attempt", attemptRecoveryToken: "recovery")
                XCTFail("recovery accepted \(status)")
            } catch let error as PCAAPIError {
                XCTAssertEqual(error, .malformedResponse)
            }
        }
    }

    func testLaterLifecycleBootstrapDoesNotPersistDeviceIdentity() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let model = try makeEnrollmentModel(identityStore: identityStore, attemptStore: InMemoryPCADeviceStateStore())
        model.start()

        let token = String(repeating: "A", count: 43)
        XCTAssertTrue(model.receiveEnrollmentLink(URL(string: "https://enroll.pca.app/\(token)")!))
        await waitForRejectedEnrollment(model)

        XCTAssertNil(identityStore.loadDeviceId())
        XCTAssertTrue(identityStore.savedDeviceIds.isEmpty)
    }

    func testLaterLifecycleRecoveryDoesNotPersistDeviceIdentity() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let attemptStore = InMemoryPCADeviceStateStore()
        try attemptStore.saveAttempt(PCAEnrollmentAttempt(attemptId: "attempt", attemptRecoveryToken: "recovery"))
        let model = try makeEnrollmentModel(identityStore: identityStore, attemptStore: attemptStore)
        model.start()
        await waitForRejectedEnrollment(model)

        XCTAssertNil(identityStore.loadDeviceId())
        XCTAssertTrue(identityStore.savedDeviceIds.isEmpty)
    }

    func testSeedPersistenceFailureKeepsEnrollmentAttemptRecoverableAndDoesNotPublishDeviceIdentity() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let attemptStore = InMemoryPCADeviceStateStore()
        let failedRootStore = SwitchableFirstDeviceRootStore()
        let model = try makeEnrollmentModel(
            identityStore: identityStore,
            attemptStore: attemptStore,
            firstDeviceRootStore: failedRootStore,
            bootstrapStatus: "PAIRING_PENDING"
        )
        model.start()

        let token = String(repeating: "A", count: 43)
        XCTAssertTrue(model.receiveEnrollmentLink(URL(string: "https://enroll.pca.app/\(token)")!))
        await waitForRecoverableEnrollment(model)

        XCTAssertTrue(identityStore.savedDeviceIds.isEmpty, "identity must not be committed before the ceremony seed is durable")
        XCTAssertNotNil(try attemptStore.loadAttempt(), "the recovery credential pair must remain available for a retry")
        XCTAssertNil(failedRootStore.current())
    }

    func testMissingDskOrDekPublicMaterialKeepsEnrollmentAttemptRecoverable() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let attemptStore = InMemoryPCADeviceStateStore()
        let rootStore = InMemoryFirstDeviceRootStore()
        let model = try makeEnrollmentModel(
            identityStore: identityStore,
            attemptStore: attemptStore,
            firstDeviceRootStore: rootStore,
            proofProvider: EmptyEnrollmentProofProvider(),
            bootstrapStatus: "PAIRING_PENDING"
        )
        model.start()
        XCTAssertTrue(model.receiveEnrollmentLink(URL(string: "https://enroll.pca.app/\(String(repeating: "A", count: 43))")!))
        await waitForRecoverableEnrollment(model)

        XCTAssertNil(rootStore.current())
        XCTAssertTrue(identityStore.savedDeviceIds.isEmpty)
        XCTAssertNotNil(try attemptStore.loadAttempt())
    }

    func testSeedPersistenceFailureCanRecoverInTheSameProcessAfterStorageRecovers() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let attemptStore = InMemoryPCADeviceStateStore()
        let rootStore = SwitchableFirstDeviceRootStore()
        let model = try makeEnrollmentModel(
            identityStore: identityStore,
            attemptStore: attemptStore,
            firstDeviceRootStore: rootStore,
            bootstrapStatus: "PAIRING_PENDING"
        )
        model.start()

        let token = String(repeating: "A", count: 43)
        XCTAssertTrue(model.receiveEnrollmentLink(URL(string: "https://enroll.pca.app/\(token)")!))
        await waitForRecoverableEnrollment(model)
        XCTAssertTrue(identityStore.savedDeviceIds.isEmpty)
        XCTAssertNotNil(try attemptStore.loadAttempt())

        rootStore.failCapture = false
        model.sceneBecameActive()
        await waitForEnrollmentInProgress(model)

        XCTAssertEqual(rootStore.current()?.seed.deviceId, "device-1")
        XCTAssertEqual(identityStore.savedDeviceIds, ["device-1"])
        XCTAssertNotNil(try attemptStore.loadAttempt(), "profile confirmation remains the owner of pending-attempt cleanup")
    }

    func testSameAttemptRecoveryPreservesTheCompleteProgressedRootRecord() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let attemptStore = InMemoryPCADeviceStateStore()
        let attempt = PCAEnrollmentAttempt(attemptId: "attempt", attemptRecoveryToken: "recovery")
        try attemptStore.saveAttempt(attempt)
        let seed = FirstDeviceCeremonySeed(
            attemptId: attempt.attemptId,
            attemptRecoveryToken: attempt.attemptRecoveryToken,
            serverBaseUrl: "https://api.example.test",
            deviceId: "device-1",
            signingKeyId: "key-1",
            encryptionKeyId: "key-2",
            dskPublicKeyBase64: "dsk",
            dekPublicKeyBase64: "dek",
            dskAlias: "pca.dsk.attempt",
            dekAlias: "pca.dek.attempt"
        )
        let progressed = FirstDeviceRootRecord(
            seed: seed,
            state: .submitting,
            ceremonyId: "ceremony-1",
            challengeId: "challenge-1",
            nonce: "nonce-1",
            expiresAt: "2026-10-02T01:00:00.000Z",
            familyId: "family-1",
            submission: FirstDeviceSubmissionPayload(
                proofBytes: "proof", proofSignature: "proof-signature",
                epoch1Bytes: "epoch", epoch1Signature: "epoch-signature",
                attestationEvidence: "evidence"
            )
        )
        let rootStore = InMemoryFirstDeviceRootStore(record: progressed)
        let model = try makeEnrollmentModel(
            identityStore: identityStore,
            attemptStore: attemptStore,
            firstDeviceRootStore: rootStore,
            bootstrapStatus: "PAIRING_PENDING"
        )

        model.start()
        await waitForEnrollmentInProgress(model)

        XCTAssertEqual(rootStore.current(), progressed)
        XCTAssertEqual(identityStore.savedDeviceIds, ["device-1"])
    }

    func testCompetingEnrollmentPreservesActiveOrCommittedRoot() async throws {
        for state in [FirstDeviceRootState.awaitingApproval, .approved, .submitting, .unknown, .rootCommitted] {
            let identityStore = RecordingDeviceIdentityStore()
            let attemptStore = InMemoryPCADeviceStateStore()
            try attemptStore.saveAttempt(PCAEnrollmentAttempt(attemptId: "new-attempt", attemptRecoveryToken: "new-recovery"))
            let submission: FirstDeviceSubmissionPayload? = (state == .submitting || state == .unknown)
                ? FirstDeviceSubmissionPayload(
                    proofBytes: "saved-proof", proofSignature: "saved-signature",
                    epoch1Bytes: "saved-epoch", epoch1Signature: "saved-epoch-signature",
                    attestationEvidence: "saved-evidence"
                )
                : nil
            let existing = FirstDeviceRootRecord(
                seed: FirstDeviceCeremonySeed(
                    attemptId: "root-owner",
                    attemptRecoveryToken: state == .rootCommitted ? "" : "owner-recovery",
                    serverBaseUrl: "https://api.example.test",
                    deviceId: "root-device",
                    signingKeyId: "root-dsk",
                    encryptionKeyId: "root-dek",
                    dskPublicKeyBase64: "root-public-dsk",
                    dekPublicKeyBase64: "root-public-dek",
                    dskAlias: "pca.dsk.root-owner",
                    dekAlias: "pca.dek.root-owner"
                ),
                state: state,
                ceremonyId: "root-ceremony",
                submission: submission
            )
            let rootStore = InMemoryFirstDeviceRootStore(record: existing)
            let model = try makeEnrollmentModel(
                identityStore: identityStore,
                attemptStore: attemptStore,
                firstDeviceRootStore: rootStore,
                bootstrapStatus: "PAIRING_PENDING"
            )

            model.start()
            await waitForEnrollmentInProgress(model)

            XCTAssertEqual(rootStore.current(), existing)
        }
    }

    func testNewEnrollmentReplacesOnlyExpiredOrRejectedRoot() async throws {
        for state in [FirstDeviceRootState.expired, .rejected] {
            let identityStore = RecordingDeviceIdentityStore()
            let attemptStore = InMemoryPCADeviceStateStore()
            try attemptStore.saveAttempt(PCAEnrollmentAttempt(attemptId: "new-attempt", attemptRecoveryToken: "new-recovery"))
            let existing = FirstDeviceRootRecord(
                seed: FirstDeviceCeremonySeed(
                    attemptId: "terminal-owner",
                    attemptRecoveryToken: "old-recovery",
                    serverBaseUrl: "https://api.example.test",
                    deviceId: "old-device",
                    signingKeyId: "old-dsk",
                    encryptionKeyId: "old-dek",
                    dskPublicKeyBase64: "old-public-dsk",
                    dekPublicKeyBase64: "old-public-dek",
                    dskAlias: "pca.dsk.terminal-owner",
                    dekAlias: "pca.dek.terminal-owner"
                ),
                state: state,
                ceremonyId: "old-ceremony"
            )
            let rootStore = InMemoryFirstDeviceRootStore(record: existing)
            let model = try makeEnrollmentModel(
                identityStore: identityStore,
                attemptStore: attemptStore,
                firstDeviceRootStore: rootStore,
                bootstrapStatus: "PAIRING_PENDING"
            )

            model.start()
            await waitForEnrollmentInProgress(model)

            XCTAssertEqual(rootStore.current()?.seed.attemptId, "new-attempt")
            XCTAssertEqual(rootStore.current()?.state, .notStarted)
            XCTAssertNil(rootStore.current()?.ceremonyId)
            XCTAssertNotEqual(rootStore.current(), existing)
        }
    }

    private func makeEnrollmentModel(
        identityStore: RecordingDeviceIdentityStore,
        attemptStore: InMemoryPCADeviceStateStore,
        firstDeviceRootStore: FirstDeviceRootStoring? = nil,
        firstDeviceTrustRootCoordinator: FirstDeviceTrustRootCoordinating? = nil,
        proofProvider: PCADeviceProofProvider = TestEnrollmentProofProvider(),
        bootstrapStatus: String = "PAIRED"
    ) throws -> PCAApplicationModel {
        let authorizationSource = FakeAuthorizationStatusSource()
        authorizationSource.status = .approved
        let authorizationCenter = ChildAuthorizationCenter(source: authorizationSource)
        let transport = InMemoryPCAHTTPTransport { _ in
            PCAHTTPResponse(statusCode: 200, data: Data("{\"deviceId\":\"device-1\",\"signingKeyId\":\"key-1\",\"encryptionKeyId\":\"key-2\",\"status\":\"\(bootstrapStatus)\",\"childProfileId\":\"child-1\",\"ageUxTier\":\"TEEN\",\"initialPolicyProfile\":\"BALANCED\"}".utf8))
        }
        let dependencies = PCAProductionDependencies(
            authorizationCenter: authorizationCenter,
            enrollmentCoordinator: ChildEnrollmentCoordinator(
                keyMaterialStore: FamilyKeyMaterialStore(keychain: InMemoryKeychainStore(), serviceNamespace: "org.pca.test"),
                authorizationCenter: authorizationCenter
            ),
            enrollmentClient: try PCAEnrollmentBootstrapClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
            sessionStore: attemptStore,
            attemptStore: attemptStore,
            profileStore: InMemoryPCAEnrollmentProfileStore(),
            proofProvider: proofProvider,
            firstDeviceRootStore: firstDeviceRootStore,
            firstDeviceTrustRootCoordinator: firstDeviceTrustRootCoordinator,
            protectionRuntime: PCAHostProtectionRuntime(),
            deviceIdentityStore: identityStore
        )
        return PCAApplicationModel(dependencies: dependencies)
    }

    private func waitForRejectedEnrollment(_ model: PCAApplicationModel) async {
        for _ in 0..<100 {
            if model.applicationState == .error(.permanent) { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(model.applicationState, .error(.permanent))
        XCTAssertEqual(model.lastError, .permanent)
    }

    private func waitForRecoverableEnrollment(_ model: PCAApplicationModel) async {
        for _ in 0..<100 {
            if model.applicationState == .error(.recoverable) { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(model.applicationState, .error(.recoverable))
        XCTAssertEqual(model.lastError, .recoverable)
    }

    private func waitForEnrollmentInProgress(_ model: PCAApplicationModel) async {
        for _ in 0..<100 {
            if model.applicationState == .enrollmentInProgress { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(model.applicationState, .enrollmentInProgress)
    }

    private func trustRootSeed() -> FirstDeviceCeremonySeed {
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

    func testRuntimeProtectionStatusUsesExistingAuthenticatedRoute() async throws {
        let transport = InMemoryPCAHTTPTransport { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/v1/runtime-sync/protection-status")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer opaque-session")
            XCTAssertEqual(request.httpBody, Data(#"{"protectionLevel":"PROTECTED"}"#.utf8))
            return PCAHTTPResponse(statusCode: 204, data: Data())
        }
        let client = try PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
        let session = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60))
        try await client.reportProtectionStatus(.active, session: session)
    }

    func testProductionBaseURLRejectsHTTP() {
        XCTAssertThrowsError(try PCAEnrollmentBootstrapClient(baseURL: URL(string: "http://localhost:4001")!, transport: InMemoryPCAHTTPTransport { _ in fatalError() })) { error in
            XCTAssertEqual(error as? PCAAPIError, .invalidConfiguration)
        }
    }

    func testSessionAndRecoveryMaterialUseReplacementAndDeletionSemantics() throws {
        let keychain = InMemoryKeychainStore()
        let store = PCAKeychainDeviceStateStore(keychain: keychain, serviceNamespace: "org.pca.test")
        let first = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date(timeIntervalSince1970: 10))
        try store.saveSession(first)
        XCTAssertEqual(try store.loadSession(), first)
        XCTAssertEqual(keychain.storedAccessibility(forAccount: "current.session", service: "org.pca.test.device-state"), .whenUnlockedThisDeviceOnly)
        try store.saveAttempt(PCAEnrollmentAttempt(attemptId: "attempt-1", attemptRecoveryToken: "opaque-recovery"))
        XCTAssertEqual(try store.loadAttempt()?.attemptId, "attempt-1")
        try store.clearSession()
        try store.clearAttempt()
        XCTAssertNil(try store.loadSession())
        XCTAssertNil(try store.loadAttempt())
        XCTAssertEqual(keychain.storedAccessibility(forAccount: "current.session", service: "org.pca.test.device-state"), nil)
    }

    func testCryptoActivationBoundaryFailsClosed() {
        let provider = PendingPCADeviceProofProvider()
        XCTAssertThrowsError(try provider.sign(challenge: "nonce")) { error in
            XCTAssertEqual(error as? PCADeviceProofError, .cryptoActivationPending)
        }
    }

    func testPolicyApplicationBoundaryFailsClosedWithoutApprovedRuntime() {
        let runtime = PCAUnavailableProtectionPolicyRuntime()
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(
            scheduleData: Data("{}".utf8),
            applicationTokenData: Data(),
            protectedApplicationTokenData: nil,
            now: Date()
        )) { error in
            XCTAssertEqual(error as? PCAProtectionPolicyApplicationError, .frameworkUnavailable)
        }
    }

    func testAuthorizationApprovalAloneNeverClaimsProtectionActive() {
        let runtime = PCAHostProtectionRuntime()
        runtime.authorizationChanged(.approved)
        XCTAssertEqual(runtime.status, .notReady)
        runtime.recordPolicyApplication(.active)
        XCTAssertEqual(runtime.status, .active)
        runtime.authorizationChanged(.revoked(to: .denied))
        XCTAssertEqual(runtime.status, .degraded)
    }
}

private final class RecordingDeviceIdentityStore: PCADeviceIdentityStore {
    private(set) var savedDeviceIds: [String] = []
    func loadDeviceId() -> String? { savedDeviceIds.last }
    func saveDeviceId(_ deviceId: String) { savedDeviceIds.append(deviceId) }
}

private final class SwitchableFirstDeviceRootStore: FirstDeviceRootStoring {
    private let backing = InMemoryFirstDeviceRootStore()
    var failCapture = true
    var failCurrent = false
    func current() -> FirstDeviceRootRecord? { failCurrent ? nil : backing.current() }
    func save(_ record: FirstDeviceRootRecord) -> Bool { backing.save(record) }
    func clear() { backing.clear() }
    func writeIfCurrent(expected: FirstDeviceRootRecord?, record: FirstDeviceRootRecord) -> Bool {
        backing.writeIfCurrent(expected: expected, record: record)
    }
    func captureSeed(_ candidate: FirstDeviceRootRecord, replacingTerminalStates: [FirstDeviceRootState]) -> Bool {
        guard !failCapture else { return false }
        return backing.captureSeed(candidate, replacingTerminalStates: replacingTerminalStates)
    }
    func confirmDurable(_ record: FirstDeviceRootRecord) -> Bool { backing.confirmDurable(record) }
    func flush() { backing.flush() }
}

private final class ManualTrustRootCoordinator: FirstDeviceTrustRootCoordinating {
    var record: FirstDeviceRootRecord?
    var onRecordChanged: ((FirstDeviceRootRecord?) -> Void)?
    func beginCeremony() async {}
    func refreshStatus() async {}
    func submit() async {}
    func resubmitExact() async {}
}

private final class TrustRootFlowApi: FirstDeviceBootstrapApiClienting {
    var challengeResponse = FirstDeviceChallengeResponse(
        ceremonyId: "33333333-3333-4333-8333-333333333333",
        challengeId: "44444444-4444-4444-8444-444444444444",
        nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        expiresAt: "2026-10-02T00:00:00.000Z",
        familyId: "11111111-1111-4111-8111-111111111111",
        deviceId: "device-1"
    )
    var statusResponse = FirstDeviceStatusResponse(status: "PENDING", outcome: nil)
    var submitResponse = FirstDeviceSubmitResponse(status: "ACCEPTED")
    var challengeError: FirstDeviceBootstrapError?
    private(set) var challengeCalls = 0
    private(set) var statusCalls = 0
    private(set) var submissions: [FirstDeviceSubmissionPayload] = []

    func challenge(attemptId: String, attemptRecoveryToken: String, dskKeyId: String, dskPublicKeyBase64: String) async throws -> FirstDeviceChallengeResponse {
        challengeCalls += 1
        if let challengeError { throw challengeError }
        return challengeResponse
    }

    func submit(attemptId: String, attemptRecoveryToken: String, ceremonyId: String, proofBytes: String, proofSignature: String, epoch1Bytes: String, epoch1Signature: String, attestationEvidence: String) async throws -> FirstDeviceSubmitResponse {
        submissions.append(FirstDeviceSubmissionPayload(
            proofBytes: proofBytes,
            proofSignature: proofSignature,
            epoch1Bytes: epoch1Bytes,
            epoch1Signature: epoch1Signature,
            attestationEvidence: attestationEvidence
        ))
        return submitResponse
    }

    func status(attemptId: String, attemptRecoveryToken: String, ceremonyId: String) async throws -> FirstDeviceStatusResponse {
        statusCalls += 1
        return statusResponse
    }
}

private final class TrustRootFlowKeyMaterial: FirstDeviceDskKeyMaterial {
    private(set) var signCount = 0

    func signingKeyAlias(attemptId: String) -> String { "pca.dsk." + attemptId }
    func encryptionKeyAlias(attemptId: String) -> String { "pca.dek." + attemptId }
    func loadPublicKeyBase64(alias: String) throws -> String { "unused-test-public-key" }
    func generateSigningKeyPair(attemptId: String) throws -> GeneratedDskKeyPair {
        GeneratedDskKeyPair(publicKeyBase64: "unused-test-public-key", privateKeyAlias: signingKeyAlias(attemptId: attemptId))
    }
    func generateEncryptionKeyPair(attemptId: String) throws -> GeneratedDskKeyPair {
        GeneratedDskKeyPair(publicKeyBase64: "unused-test-public-key", privateKeyAlias: encryptionKeyAlias(attemptId: attemptId))
    }
    func signCanonical(alias: String, message: Data) throws -> Data {
        signCount += 1
        return Data(repeating: 0x33, count: 64)
    }
}

private final class TrustRootFlowEvidenceBuilder: FirstDeviceEvidenceBuilding {
    private(set) var callCount = 0

    func buildEvidence(transcript: String, dskKeyId: String, dskPublicKeyBase64: String) async throws -> IosAppAttestEvidence {
        callCount += 1
        return IosAppAttestEvidence(json: #"{"v":1,"platform":"IOS"}"#, keyIdBase64Url: "test-app-attest-key")
    }
}

private struct TestEnrollmentProofProvider: PCADeviceProofProvider {
    let signingPublicKey = "test-signing-public-key"
    let encryptionPublicKey = "test-encryption-public-key"
    func sign(challenge: String) throws -> String { "test-signature" }
}

private struct EmptyEnrollmentProofProvider: PCADeviceProofProvider {
    let signingPublicKey = ""
    let encryptionPublicKey = ""
    func sign(challenge: String) throws -> String { throw PCADeviceProofError.secureKeyUnavailable }
}
