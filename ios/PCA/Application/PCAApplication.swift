import Foundation
import Combine
import SwiftUI
#if canImport(ManagedSettings) && canImport(FamilyControls)
import ManagedSettings
import FamilyControls
#endif

public enum PCAProtectionStatus: Equatable {
    case notReady
    case active
    case degraded
}

public enum PCAApplicationState: Equatable {
    case initializing
    case notEnrolled
    case authorizationRequired
    case enrollmentInProgress
    case enrollmentBlockedBySecurityGate
    case enrolled
    case protectionActive
    case protectionDegraded
    case offline
    case recovering
    case error(PCAApplicationErrorCategory)
}

public enum PCAApplicationErrorCategory: Equatable {
    case recoverable
    case session
    case authorization
    case configuration
    case network
    case securityGate
    case permanent
}

public protocol PCAProtectionRuntime {
    var status: PCAProtectionStatus { get }
    func authorizationChanged(_ state: ChildAuthorizationState)
    func recordPolicyApplication(_ result: PCAProtectionStatus)
}

public protocol PCADeviceIdentityStore {
    func loadDeviceId() -> String?
    func saveDeviceId(_ deviceId: String)
}

public final class UserDefaultsPCADeviceIdentityStore: PCADeviceIdentityStore {
    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = "org.pca.device.id") {
        self.defaults = defaults
        self.key = key
    }

    public func loadDeviceId() -> String? { defaults.string(forKey: key) }
    public func saveDeviceId(_ deviceId: String) { defaults.set(deviceId, forKey: key) }
}

/// This coordinator owns the host-app side of the fail-closed boundary. It
/// never reports active merely because Family Controls is approved; a real
/// policy application result must be recorded by the sync/application layer.
public final class PCAHostProtectionRuntime: PCAProtectionRuntime {
    #if canImport(ManagedSettings) && canImport(FamilyControls)
    private let managedSettings = ManagedSettingsStore()
    #endif
    public private(set) var status: PCAProtectionStatus = .notReady

    public init() {}

    public func authorizationChanged(_ state: ChildAuthorizationState) {
        guard state.permitsEnforcement else {
            #if canImport(ManagedSettings) && canImport(FamilyControls)
            managedSettings.shield.applications = nil
            managedSettings.shield.applicationCategories = nil
            managedSettings.shield.webDomains = nil
            #endif
            status = .degraded
            return
        }
        status = .notReady
    }

    public func recordPolicyApplication(_ result: PCAProtectionStatus) {
        status = result
    }
}

public struct PCAProductionDependencies {
    public let authorizationCenter: ChildAuthorizationCenter
    public let enrollmentCoordinator: ChildEnrollmentCoordinator
    public let enrollmentClient: PCAEnrollmentBootstrapClient
    public let sessionClient: PCADeviceSessionClient?
    public let runtimeSyncClient: PCADeviceRuntimeSyncClient?
    public let sessionStore: PCADeviceSessionStore
    public let attemptStore: PCAEnrollmentAttemptStore
    public let profileStore: PCAEnrollmentProfileStore
    public let proofProvider: PCADeviceProofProvider
    public let policyRuntime: PCAProtectionPolicyRuntime
    public let protectionRuntime: PCAHostProtectionRuntime
    public let deviceIdentityStore: PCADeviceIdentityStore
    public let deviceId: String?

    public init(
        authorizationCenter: ChildAuthorizationCenter,
        enrollmentCoordinator: ChildEnrollmentCoordinator,
        enrollmentClient: PCAEnrollmentBootstrapClient,
        sessionClient: PCADeviceSessionClient? = nil,
        runtimeSyncClient: PCADeviceRuntimeSyncClient? = nil,
        sessionStore: PCADeviceSessionStore,
        attemptStore: PCAEnrollmentAttemptStore,
        profileStore: PCAEnrollmentProfileStore,
        proofProvider: PCADeviceProofProvider,
        policyRuntime: PCAProtectionPolicyRuntime = PCAUnavailableProtectionPolicyRuntime(),
        protectionRuntime: PCAHostProtectionRuntime,
        deviceIdentityStore: PCADeviceIdentityStore = UserDefaultsPCADeviceIdentityStore(),
        deviceId: String? = nil
    ) {
        self.authorizationCenter = authorizationCenter
        self.enrollmentCoordinator = enrollmentCoordinator
        self.enrollmentClient = enrollmentClient
        self.sessionClient = sessionClient
        self.runtimeSyncClient = runtimeSyncClient
        self.sessionStore = sessionStore
        self.attemptStore = attemptStore
        self.profileStore = profileStore
        self.proofProvider = proofProvider
        self.policyRuntime = policyRuntime
        self.protectionRuntime = protectionRuntime
        self.deviceIdentityStore = deviceIdentityStore
        self.deviceId = deviceId
    }
}

public final class PCAApplicationModel: ObservableObject {
    @Published public private(set) var applicationState: PCAApplicationState = .initializing
    @Published public private(set) var authorization: ChildAuthorizationState = .notDetermined
    @Published public private(set) var profileRuntimeState: PCAEnrollmentProfileRuntimeState = .awaitingProfile
    @Published public private(set) var pendingDisclosure: PCAEnrollmentDisclosure?
    @Published public private(set) var lastError: PCAApplicationErrorCategory?
    @Published public private(set) var syncConnectionState: SyncConnectionState = .stale

    public let dependencies: PCAProductionDependencies
    public let linkRouter: PCAEnrollmentLinkRouter
    private let now: () -> Date
    private var started = false
    private var pendingDeviceId: String?

    public init(dependencies: PCAProductionDependencies, now: @escaping () -> Date = { Date() }) {
        self.dependencies = dependencies
        self.linkRouter = PCAEnrollmentLinkRouter()
        self.now = now
        self.pendingDeviceId = dependencies.deviceId ?? dependencies.deviceIdentityStore.loadDeviceId()
    }

    public func start() {
        guard !started else { return }
        started = true
        authorization = dependencies.authorizationCenter.refresh()
        dependencies.protectionRuntime.authorizationChanged(authorization)
        restoreEnrolledState()
        Task { await self.establishSessionIfNeeded() }
        Task { await self.synchronizeRuntime() }
    }

    public func sceneBecameActive() {
        authorization = dependencies.authorizationCenter.refresh()
        dependencies.protectionRuntime.authorizationChanged(authorization)
        restoreEnrolledState()
        Task { await self.establishSessionIfNeeded() }
        Task { await self.synchronizeRuntime() }
    }

    public func requestAuthorization() async {
        applicationState = .authorizationRequired
        if case let .authorizationState(next) = await dependencies.enrollmentCoordinator.requestChildAuthorization() {
            authorization = next
        }
        dependencies.protectionRuntime.authorizationChanged(authorization)
        restoreEnrolledState()
    }

    @discardableResult
    public func receiveEnrollmentLink(_ url: URL) -> Bool {
        guard linkRouter.receive(url) else { return false }
        applicationState = .enrollmentInProgress
        Task { await self.beginEnrollmentIfPossible() }
        return true
    }

    public func confirmPendingProfile() {
        guard let deviceId = pendingDeviceId,
              case .awaitingChildConfirmation = profileRuntimeState else { return }
        let controller = PCAEnrollmentProfileRuntimeController(
            deviceId: deviceId,
            store: dependencies.profileStore,
            authorization: authorization
        )
        if case let .awaitingChildConfirmation(profile, _) = profileRuntimeState {
            _ = dependencies.enrollmentCoordinator.consumeProfile(profile, authorization: authorization)
            controller.receiveParentAuthorizedProfile(profile)
            profileRuntimeState = controller.confirmChildProfile()
            pendingDisclosure = nil
            applicationState = stateForCurrentData()
        }
    }

    public func recordPolicyApplication(_ status: PCAProtectionStatus) {
        dependencies.protectionRuntime.recordPolicyApplication(status)
        applicationState = stateForCurrentData()
    }

    /// Entry point for the approved envelope/crypto pipeline once it has
    /// produced a fully verified policy and opaque FamilyControls token
    /// bytes. Receipt alone never calls this method; the runtime-sync
    /// transport intentionally stops before decryption/application.
    @discardableResult
    public func applyVerifiedPolicy(
        scheduleData: Data,
        applicationTokenData: Data,
        protectedApplicationTokenData: Data? = nil,
        now: Date? = nil
    ) -> PCAProtectionPolicyApplicationResult? {
        guard authorization.permitsEnforcement else {
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = stateForCurrentData()
            return .degraded
        }

        do {
            let result = try dependencies.policyRuntime.applyVerifiedPolicy(
                scheduleData: scheduleData,
                applicationTokenData: applicationTokenData,
                protectedApplicationTokenData: protectedApplicationTokenData,
                now: now ?? self.now()
            )
            switch result {
            case .applied:
                dependencies.protectionRuntime.recordPolicyApplication(.active)
            case .scheduledOnly:
                dependencies.protectionRuntime.recordPolicyApplication(.notReady)
            case .degraded:
                dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            }
            applicationState = stateForCurrentData()
            lastError = nil
            Task { await self.reportProtectionStatusIfPossible() }
            return result
        } catch let error as PCAProtectionPolicyApplicationError {
            lastError = (error == .authorizationRequired) ? .authorization : .securityGate
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = error == .authorizationRequired ? .authorizationRequired : .protectionDegraded
            return nil
        } catch {
            lastError = .recoverable
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = .protectionDegraded
            return nil
        }
    }

    private func restoreEnrolledState() {
        guard let deviceId = pendingDeviceId else {
            applicationState = authorization.permitsEnforcement ? .notEnrolled : .authorizationRequired
            return
        }
        let controller = PCAEnrollmentProfileRuntimeController(
            deviceId: deviceId,
            store: dependencies.profileStore,
            authorization: authorization
        )
        profileRuntimeState = controller.restorePersistedProfile()
        applicationState = stateForCurrentData()
    }

    private func beginEnrollmentIfPossible() async {
        guard let link = linkRouter.takePendingLink() else { return }
        guard !dependencies.proofProvider.signingPublicKey.isEmpty,
              !dependencies.proofProvider.encryptionPublicKey.isEmpty else {
            applicationState = .enrollmentBlockedBySecurityGate
            lastError = .securityGate
            return
        }

        let attempt = PCAEnrollmentAttempt(
            attemptId: UUID().uuidString.replacingOccurrences(of: "-", with: ""),
            attemptRecoveryToken: UUID().uuidString + UUID().uuidString
        )
        do {
            try dependencies.attemptStore.saveAttempt(attempt)
            let request = PCAEnrollmentBootstrapRequest(
                rawInvitationToken: link.rawInvitationToken,
                signingPublicKey: dependencies.proofProvider.signingPublicKey,
                encryptionPublicKey: dependencies.proofProvider.encryptionPublicKey,
                bootstrapAttemptId: attempt.attemptId,
                attemptRecoveryToken: attempt.attemptRecoveryToken
            )
            let response = try await dependencies.enrollmentClient.bootstrap(request)
            pendingDeviceId = response.deviceId
            dependencies.deviceIdentityStore.saveDeviceId(response.deviceId)
            let profile = PCAEnrollmentProfile(childProfileId: response.childProfileId, ageUxTier: response.ageUxTier, initialPolicyProfile: response.initialPolicyProfile)
            profileRuntimeState = .awaitingChildConfirmation(profile, PCAEnrollmentDisclosure.forProfile(profile))
            pendingDisclosure = PCAEnrollmentDisclosure.forProfile(profile)
            applicationState = .enrollmentInProgress
        } catch let error as PCAAPIError {
            lastError = Self.category(for: error)
            applicationState = Self.state(for: error)
        } catch is PCADeviceProofError {
            lastError = .securityGate
            applicationState = .enrollmentBlockedBySecurityGate
        } catch {
            lastError = .recoverable
            applicationState = .error(.recoverable)
        }
    }

    private func establishSessionIfNeeded() async {
        guard let deviceId = pendingDeviceId, let sessionClient = dependencies.sessionClient else { return }
        if let existing = try? dependencies.sessionStore.loadSession(),
           existing.deviceId == deviceId,
           existing.expiresAt > now() {
            return
        }
        guard !dependencies.proofProvider.signingPublicKey.isEmpty else {
            applicationState = .enrollmentBlockedBySecurityGate
            lastError = .securityGate
            return
        }
        applicationState = .recovering
        do {
            let response = try await sessionClient.establishSession(deviceId: deviceId)
            try dependencies.sessionStore.saveSession(PCADeviceSession(deviceId: deviceId, sessionToken: response.sessionToken, expiresAt: response.expiresAt))
            applicationState = stateForCurrentData()
        } catch is PCADeviceProofError {
            applicationState = .enrollmentBlockedBySecurityGate
            lastError = .securityGate
        } catch let error as PCAAPIError {
            lastError = Self.category(for: error)
            applicationState = Self.state(for: error)
        } catch {
            lastError = .recoverable
            applicationState = .error(.recoverable)
        }
    }

    private func synchronizeRuntime() async {
        guard let runtimeSyncClient = dependencies.runtimeSyncClient,
              let session = try? dependencies.sessionStore.loadSession(),
              session.expiresAt > now() else {
            syncConnectionState = .stale
            return
        }
        syncConnectionState = .syncing
        do {
            let response = try await runtimeSyncClient.pull(session: session)
            syncConnectionState = SyncConnectionStateComputer.compute(SyncConnectionStateInput(
                isTransportConnected: true,
                isSyncing: false,
                hasPendingLocalWork: !response.applied.isEmpty,
                lastSuccessfulSyncAtUtc: now(),
                nowUtc: now(),
                staleThresholdSeconds: 24 * 60 * 60
            ))
            if !response.applied.isEmpty {
                dependencies.protectionRuntime.recordPolicyApplication(.degraded)
                applicationState = stateForCurrentData()
            }
            await reportProtectionStatusIfPossible(session: session)
        } catch let error as PCAAPIError {
            syncConnectionState = (error == .unauthorized) ? .stale : .offline
            if error == .unauthorized { try? dependencies.sessionStore.clearSession() }
            applicationState = error == .unauthorized ? .recovering : .offline
        } catch {
            syncConnectionState = .offline
            applicationState = .offline
        }
    }

    private func reportProtectionStatusIfPossible(session suppliedSession: PCADeviceSession? = nil) async {
        guard let runtimeSyncClient = dependencies.runtimeSyncClient,
              let session = suppliedSession ?? (try? dependencies.sessionStore.loadSession()),
              session.expiresAt > now() else { return }
        try? await runtimeSyncClient.reportProtectionStatus(dependencies.protectionRuntime.status, session: session)
    }

    private func stateForCurrentData() -> PCAApplicationState {
        guard authorization.permitsEnforcement else { return .authorizationRequired }
        switch profileRuntimeState {
        case .awaitingProfile: return .notEnrolled
        case .awaitingChildConfirmation: return .enrollmentInProgress
        case .authorizationRequired: return .authorizationRequired
        case .profilePersistenceFailed: return .error(.recoverable)
        case .ready: break
        }
        switch dependencies.protectionRuntime.status {
        case .active: return .protectionActive
        case .degraded: return .protectionDegraded
        case .notReady: return .enrolled
        }
    }

    private static func category(for error: PCAAPIError) -> PCAApplicationErrorCategory {
        switch error {
        case .invalidConfiguration: return .configuration
        case .unauthorized: return .session
        case .transport(.timeout), .transport(.network), .unavailable: return .network
        case .malformedResponse: return .permanent
        case .invalidRequest, .rejected, .transport(_): return .recoverable
        }
    }

    private static func state(for error: PCAAPIError) -> PCAApplicationState {
        switch error {
        case .transport(.timeout), .transport(.network), .unavailable: return .offline
        case .unauthorized: return .recovering
        case .invalidConfiguration: return .error(.configuration)
        case .malformedResponse: return .error(.permanent)
        case .invalidRequest, .rejected, .transport(_): return .error(.recoverable)
        }
    }
}

public enum PCAProductionCompositionRoot {
    public static let productionAPIBaseURL = URL(string: "https://api.pcasafe.com")!

    public static func make() -> PCAApplicationModel {
        #if canImport(Security)
        let keychain: KeychainStoreProtocol = SystemKeychainStore()
        #else
        let keychain: KeychainStoreProtocol = InMemoryKeychainStore()
        #endif
        #if canImport(FamilyControls)
        let authorizationCenter = ChildAuthorizationCenter(source: SystemAuthorizationSource())
        #else
        let authorizationCenter = ChildAuthorizationCenter(source: UnavailableAuthorizationStatusSource())
        #endif
        let stateStore = PCAKeychainDeviceStateStore(keychain: keychain, serviceNamespace: "org.pca.app")
        let keyMaterial = FamilyKeyMaterialStore(keychain: keychain, serviceNamespace: "org.pca.app")
        let enrollmentCoordinator = ChildEnrollmentCoordinator(keyMaterialStore: keyMaterial, authorizationCenter: authorizationCenter)
        let transport = PCAURLSessionTransport()
        let client = try! PCAEnrollmentBootstrapClient(baseURL: productionAPIBaseURL, transport: transport)
        let sessionClient = try! PCADeviceSessionClient(baseURL: productionAPIBaseURL, transport: transport, proof: PendingPCADeviceProofProvider())
        let runtimeSyncClient = try! PCADeviceRuntimeSyncClient(baseURL: productionAPIBaseURL, transport: transport)
        let profileStore = UserDefaultsPCAEnrollmentProfileStore()
        #if canImport(DeviceActivity) && canImport(FamilyControls) && canImport(ManagedSettings)
        let policyRuntime: PCAProtectionPolicyRuntime = (try? PCAProductionProtectionPolicyRuntime.production(
            authorizationIsApproved: { authorizationCenter.refresh().permitsEnforcement },
            appGroupIdentifier: "group.org.pca.app"
        )) ?? PCAUnavailableProtectionPolicyRuntime()
        #else
        let policyRuntime: PCAProtectionPolicyRuntime = PCAUnavailableProtectionPolicyRuntime()
        #endif
        let dependencies = PCAProductionDependencies(
            authorizationCenter: authorizationCenter,
            enrollmentCoordinator: enrollmentCoordinator,
            enrollmentClient: client,
            sessionClient: sessionClient,
            runtimeSyncClient: runtimeSyncClient,
            sessionStore: stateStore,
            attemptStore: stateStore,
            profileStore: profileStore,
            proofProvider: PendingPCADeviceProofProvider(),
            policyRuntime: policyRuntime,
            protectionRuntime: PCAHostProtectionRuntime(),
            deviceIdentityStore: UserDefaultsPCADeviceIdentityStore()
        )
        return PCAApplicationModel(dependencies: dependencies)
    }
}

public struct UnavailableAuthorizationStatusSource: AuthorizationStatusSource {
    public init() {}
    public func currentRawStatus() -> RawAuthorizationStatus { .notDetermined }
    public func requestChildAuthorization() async throws { throw PCAAPIError.invalidConfiguration }
}
