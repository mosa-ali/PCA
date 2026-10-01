import XCTest
@testable import PCA

final class ProductionIntegrationTests: XCTestCase {
    func testBootstrapBuildsExistingBackendContractWithoutLoggingSecrets() async throws {
        let response = #"{"deviceId":"device-1","status":"PAIRING_PENDING","childProfileId":"child-1","ageUxTier":"TEEN","initialPolicyProfile":"BALANCED"}"#.data(using: .utf8)!
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

    private func makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore, attemptStore: InMemoryPCADeviceStateStore) throws -> PCAApplicationModel {
        let authorizationSource = FakeAuthorizationStatusSource()
        authorizationSource.status = .approved
        let authorizationCenter = ChildAuthorizationCenter(source: authorizationSource)
        let transport = InMemoryPCAHTTPTransport { _ in
            PCAHTTPResponse(statusCode: 200, data: Data(#"{"deviceId":"device-1","status":"PAIRED","childProfileId":"child-1","ageUxTier":"TEEN","initialPolicyProfile":"BALANCED"}"#.utf8))
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
            proofProvider: TestEnrollmentProofProvider(),
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

private struct TestEnrollmentProofProvider: PCADeviceProofProvider {
    let signingPublicKey = "test-signing-public-key"
    let encryptionPublicKey = "test-encryption-public-key"
    func sign(challenge: String) throws -> String { "test-signature" }
}
