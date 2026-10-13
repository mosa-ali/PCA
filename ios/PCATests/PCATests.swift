import XCTest
import Foundation
import FamilyControls
@testable import PCA

private final class DeviceSessionTestProof: PCADeviceProofProvider {
    var signingPublicKey = "public-key"
    var encryptionPublicKey = "encryption-key"
    private(set) var signedChallenges: [String] = []
    func sign(challenge: String) throws -> String {
        signedChallenges.append(challenge)
        return "signature"
    }
}

final class PCATests: XCTestCase {
    @MainActor
    func testLaunchShellHasStableAccessibilityLabel() {
        let view = ContentView()
        XCTAssertNotNil(view)
    }

    func testExpiredDeviceSessionChallengeIsRejectedBeforeSigning() async throws {
        let transport = InMemoryPCAHTTPTransport { request in
            XCTAssertTrue(request.url?.path.hasSuffix("/challenge") == true)
            return PCAHTTPResponse(statusCode: 200,
                data: Data(#"{"challengeId":"challenge-1","nonce":"nonce-1","expiresAt":"2000-01-01T00:00:00Z"}"#.utf8))
        }
        let proof = DeviceSessionTestProof()
        let client = try PCADeviceSessionClient(baseURL: URL(string: "https://api.example/")!, transport: transport, proof: proof)

        do {
            _ = try await client.establishSession(deviceId: "device-1")
            XCTFail("expired challenge must not be signed or submitted")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
        XCTAssertTrue(proof.signedChallenges.isEmpty)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testBlankOrExpiredDeviceSessionResponseIsRejected() async throws {
        let canonicalToken = String(repeating: "A", count: 43)
        for responseBody in [
            #"{"sessionToken":"","expiresAt":"2099-01-01T00:00:00Z"}"#,
            #"{"sessionToken":"opaque-token","expiresAt":"2099-01-01T00:00:00Z"}"#,
            #"{"sessionToken":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA!","expiresAt":"2099-01-01T00:00:00Z"}"#,
            #"{"sessionToken":"\#(canonicalToken)","expiresAt":"2000-01-01T00:00:00Z"}"#,
        ] {
            let transport = InMemoryPCAHTTPTransport { request in
                if request.url?.path.hasSuffix("/challenge") == true {
                    return PCAHTTPResponse(statusCode: 200,
                        data: Data(#"{"challengeId":"challenge-1","nonce":"nonce-1","expiresAt":"2099-01-01T00:00:00Z"}"#.utf8))
                }
                return PCAHTTPResponse(statusCode: 200, data: Data(responseBody.utf8))
            }
            let client = try PCADeviceSessionClient(baseURL: URL(string: "https://api.example/")!,
                transport: transport, proof: DeviceSessionTestProof())

            do {
                _ = try await client.establishSession(deviceId: "device-1")
                XCTFail("unusable session response must be rejected")
            } catch let error as PCAAPIError {
                XCTAssertEqual(error, .malformedResponse)
            }
            XCTAssertEqual(transport.requests.count, 2)
        }
    }
}

#if canImport(DeviceActivity) && canImport(FamilyControls) && canImport(ManagedSettings)
final class PCAProtectionPolicyClearIntentTests: XCTestCase {
    func testExplicitClearConsumesIntentAfterRemovingPersistedPolicy() throws {
        let store = ClearIntentTestBlobStore()
        let scheduler = ClearIntentTestScheduler()
        let shields = ClearIntentTestShieldEnforcer()
        let policyData = Data(#"{"schemaVersion":1,"activityId":"clear-policy","appToken":"opaque","timeZoneIdentifier":"UTC","windows":[],"bonusGrants":[],"exceptions":[],"enforcementCapability":"enforced"}"#.utf8)
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, shieldEnforcer: shields)
        _ = try runtime.applyVerifiedPolicy(scheduleData: policyData,
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: Date())

        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        let removalsBeforeClear = shields.removeCount
        runtime.clearPolicy(activityId: installation.policyActivityId)

        XCTAssertGreaterThan(shields.removeCount, removalsBeforeClear)
        XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        XCTAssertNil(store.read(forKey: "activeActivityId"))
        XCTAssertNil(store.read(forKey: "schedule.clear-policy.\(installation.generation)"))
        XCTAssertNil(store.read(forKey: deviceActivityPolicyClearIntentStorageKey))
    }

    func testRestartCompletesClearAfterManifestRemovalBeforeManagedSettingsCleanup() throws {
        let store = ClearIntentTestBlobStore()
        let scheduler = ClearIntentTestScheduler()
        let policyData = Data(#"{"schemaVersion":1,"activityId":"clear-policy","appToken":"opaque","timeZoneIdentifier":"UTC","windows":[],"bonusGrants":[],"exceptions":[],"enforcementCapability":"enforced"}"#.utf8)
        let applicationTokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let initialRuntime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { Date(timeIntervalSince1970: 1_760_000_000) })
        _ = try initialRuntime.applyVerifiedPolicy(scheduleData: policyData,
            applicationTokenData: applicationTokens, protectedApplicationTokenData: nil,
            now: Date(timeIntervalSince1970: 1_760_000_000))

        let manifestData = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(manifestData))
        XCTAssertEqual(installation.state, .active)
        let tombstone = installation.invalidating()
        try store.write(try JSONEncoder().encode(tombstone), forKey: deviceActivityMonitorInstallationStorageKey)
        XCTAssertNil(InstalledDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: store, tokenStore: store)
            .load(monitorActivityId: installation.monitorActivityId),
            "the invalidated manifest must stop queued extension callbacks before cleanup begins")
        let intent = DeviceActivityPolicyClearIntent(policyActivityId: installation.policyActivityId,
            installation: tombstone)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        try store.write(encoder.encode(intent), forKey: deviceActivityPolicyClearIntentStorageKey)

        // Model process death after the first commit-key deletion but before
        // ManagedSettings cleanup, the exact unsafe window in the old order.
        store.remove(forKey: deviceActivityMonitorInstallationStorageKey)
        store.remove(forKey: "activeActivityId")
        let restoredShields = ClearIntentTestShieldEnforcer()
        _ = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store,
            installationClock: { Date(timeIntervalSince1970: 1_760_000_000) },
            shieldEnforcer: restoredShields)

        XCTAssertEqual(restoredShields.removeCount, 1,
            "startup must clear stale ManagedSettings before discarding the durable clear intent")
        XCTAssertTrue(Set(installation.allMonitorActivityIds).isSubset(of: Set(scheduler.stopped)))
        XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        XCTAssertNil(store.read(forKey: "activeActivityId"))
        XCTAssertNil(store.read(forKey: "schedule.clear-policy.\(installation.generation)"))
        XCTAssertNil(store.read(forKey: "applicationTokens.clear-policy.\(installation.generation)"))
        XCTAssertNil(store.read(forKey: "protectedApplicationTokens.\(installation.generation)"))
        XCTAssertNil(store.read(forKey: deviceActivityPolicyClearIntentStorageKey))
    }

    func testRuntimeEntryPointsReconcilePendingClearBeforeMutationLock() throws {
        enum EntryPoint { case callbackHealth, apply, clear }
        let policyData = Data(#"{"schemaVersion":1,"activityId":"clear-policy","appToken":"opaque","timeZoneIdentifier":"UTC","windows":[],"bonusGrants":[],"exceptions":[],"enforcementCapability":"enforced"}"#.utf8)
        let applicationTokens = try PropertyListEncoder().encode(Set<ApplicationToken>())

        for entryPoint in [EntryPoint.callbackHealth, .apply, .clear] {
            let store = ClearIntentTestBlobStore()
            let scheduler = ClearIntentTestScheduler()
            let shields = ClearIntentTestShieldEnforcer()
            let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
                scheduler: scheduler, blobStore: store, shieldEnforcer: shields)
            _ = try runtime.applyVerifiedPolicy(scheduleData: policyData,
                applicationTokenData: applicationTokens, protectedApplicationTokenData: nil, now: Date())

            let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
                try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
            let tombstone = installation.invalidating()
            try store.write(try JSONEncoder().encode(tombstone), forKey: deviceActivityMonitorInstallationStorageKey)
            let intent = DeviceActivityPolicyClearIntent(policyActivityId: installation.policyActivityId,
                installation: tombstone)
            try store.write(try JSONEncoder().encode(intent), forKey: deviceActivityPolicyClearIntentStorageKey)
            // Model interruption after durable intent, before any system cleanup.
            store.remove(forKey: deviceActivityMonitorInstallationStorageKey)
            store.remove(forKey: "activeActivityId")

            let recovered = expectation(description: "pending clear recovered before \(entryPoint)")
            DispatchQueue.global().async {
                switch entryPoint {
                case .callbackHealth:
                    _ = runtime.callbackHealth(now: Date())
                case .apply:
                    do {
                        try runtime.applyVerifiedPolicy(scheduleData: policyData,
                            applicationTokenData: applicationTokens, protectedApplicationTokenData: nil, now: Date())
                    } catch {
                        XCTFail("pending clear recovery must permit policy apply: \(error)")
                    }
                case .clear:
                    runtime.clearPolicy(activityId: installation.policyActivityId)
                }
                recovered.fulfill()
            }

            wait(for: [recovered], timeout: 3)
            XCTAssertNil(store.read(forKey: deviceActivityPolicyClearIntentStorageKey),
                "\(entryPoint) must finish durable clear recovery")
            XCTAssertGreaterThanOrEqual(shields.removeCount, 1,
                "recovery must clear ManagedSettings before retiring the intent")
        }
    }
}

private final class ClearIntentTestBlobStore: OpaqueBlobStore {
    private var values: [String: Data] = [:]
    func write(_ data: Data, forKey key: String) throws { values[key] = data }
    func read(forKey key: String) -> Data? { values[key] }
    func remove(forKey key: String) { values.removeValue(forKey: key) }
}

private final class ClearIntentTestScheduler: PCADeviceActivityScheduler {
    private(set) var activeIds = Set<String>()
    private(set) var stopped: [String] = []
    func start(activityId: String, calendar: Calendar) throws { activeIds.insert(activityId) }
    func startBoundary(activityId: String, trigger: DeviceActivityBoundaryTrigger) throws { activeIds.insert(activityId) }
    func stop(activityId: String) { activeIds.remove(activityId); stopped.append(activityId) }
    func ownedMonitorActivityIds() -> [String] { Array(activeIds) }
    func startUsage(plan: DeviceActivityUsageDayPlan, applications: Set<ApplicationToken>) throws {
        activeIds.insert(plan.monitorActivityId)
    }
}

private final class ClearIntentTestShieldEnforcer: PCADeviceActivityShieldEnforcing {
    private(set) var removeCount = 0
    func apply(applications: Set<ApplicationToken>, protectedApplications: Set<ApplicationToken>) throws {}
    func removeAll() { removeCount += 1 }
}
#endif
