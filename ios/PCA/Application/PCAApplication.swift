import Foundation
import Combine
import SwiftUI
#if canImport(ManagedSettings) && canImport(FamilyControls)
import ManagedSettings
import FamilyControls
#endif
#if canImport(DeviceCheck)
import DeviceCheck
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

    /// Short, non-sensitive UI copy. Detailed security/transport errors stay
    /// typed in the model and are never rendered raw.
    var userFacingMessage: String {
        switch self {
        case .initializing, .enrollmentInProgress, .recovering: return "Starting settings"
        case .notEnrolled: return "Enrollment"
        case .authorizationRequired: return "Apple authorization is required before iOS protection controls can run."
        case .enrollmentBlockedBySecurityGate: return "Apple approval is needed before safety controls can start."
        case .enrolled: return "Not yet active"
        case .protectionActive: return "Active on this device"
        case .protectionDegraded, .offline: return "Not active"
        case .error: return "Not available"
        }
    }
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
    public let inboundInbox: PCAInboundInboxStoring?
    public let assertRuntimeKeyCustody: (String) throws -> Void
    public let sessionStore: PCADeviceSessionStore
    public let attemptStore: PCAEnrollmentAttemptStore
    public let profileStore: PCAEnrollmentProfileStore
    public let proofProvider: PCADeviceProofProvider
    /// Wave 6D: the Secure Enclave key-preparation seam (nil keeps the
    /// fail-closed pre-6D posture: without it, no attempt can prepare keys
    /// and the enrollment guard blocks).
    public let enrollmentKeys: FirstDeviceEnrollmentKeyPreparation?
    /// Wave 6D: attempt-scoped key hygiene (nil disables the sweep call).
    public let keyDeletion: FirstDeviceKeyPairDeletion?
    /// Wave 6D: durable first-device root store (nil disables seed capture).
    public let firstDeviceRootStore: FirstDeviceRootStoring?
    /// Wave 6D: explicit UI-driven first-device trust-root ceremony. Nil is
    /// the fail-closed posture when Secure Enclave/App Attest composition is
    /// unavailable on this device.
    public let firstDeviceTrustRootCoordinator: FirstDeviceTrustRootCoordinating?
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
        inboundInbox: PCAInboundInboxStoring? = nil,
        assertRuntimeKeyCustody: @escaping (String) throws -> Void = { _ in throw PCADeviceProofError.secureKeyUnavailable },
        sessionStore: PCADeviceSessionStore,
        attemptStore: PCAEnrollmentAttemptStore,
        profileStore: PCAEnrollmentProfileStore,
        proofProvider: PCADeviceProofProvider,
        enrollmentKeys: FirstDeviceEnrollmentKeyPreparation? = nil,
        keyDeletion: FirstDeviceKeyPairDeletion? = nil,
        firstDeviceRootStore: FirstDeviceRootStoring? = nil,
        firstDeviceTrustRootCoordinator: FirstDeviceTrustRootCoordinating? = nil,
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
        self.inboundInbox = inboundInbox
        self.assertRuntimeKeyCustody = assertRuntimeKeyCustody
        self.sessionStore = sessionStore
        self.attemptStore = attemptStore
        self.profileStore = profileStore
        self.proofProvider = proofProvider
        self.enrollmentKeys = enrollmentKeys
        self.keyDeletion = keyDeletion
        self.firstDeviceRootStore = firstDeviceRootStore
        self.firstDeviceTrustRootCoordinator = firstDeviceTrustRootCoordinator
        self.policyRuntime = policyRuntime
        self.protectionRuntime = protectionRuntime
        self.deviceIdentityStore = deviceIdentityStore
        self.deviceId = deviceId
    }
}

/// The app model uses this narrow seam so UI actions and status rendering can
/// be integration-tested without substituting the production ceremony rules.
public protocol FirstDeviceTrustRootCoordinating: AnyObject {
    var record: FirstDeviceRootRecord? { get }
    var onRecordChanged: ((FirstDeviceRootRecord?) -> Void)? { get set }
    func beginCeremony() async
    func refreshStatus() async
    func submit() async
    func resubmitExact() async
}

extension FirstDeviceTrustRootCoordinator: FirstDeviceTrustRootCoordinating {}

enum PCAFirstDeviceTrustRootComposition {
    static func makeCoordinator(
        rootStore: FirstDeviceRootStoring?,
        apiClient: FirstDeviceBootstrapApiClienting?,
        keyMaterial: FirstDeviceDskKeyMaterial?,
        evidenceBuilder: FirstDeviceEvidenceBuilding?,
        appAttestIsSupported: Bool
    ) -> FirstDeviceTrustRootCoordinator? {
        guard appAttestIsSupported,
              let rootStore,
              let apiClient,
              let keyMaterial,
              let evidenceBuilder else { return nil }
        return FirstDeviceTrustRootCoordinator(
            rootStore: rootStore,
            apiClient: apiClient,
            keyMaterial: keyMaterial,
            evidenceBuilder: evidenceBuilder
        )
    }
}

public final class PCAApplicationModel: ObservableObject {
    @Published public private(set) var applicationState: PCAApplicationState = .initializing
    @Published public private(set) var authorization: ChildAuthorizationState = .notDetermined
    @Published public private(set) var profileRuntimeState: PCAEnrollmentProfileRuntimeState = .awaitingProfile
    @Published public private(set) var pendingDisclosure: PCAEnrollmentDisclosure?
    @Published public private(set) var lastError: PCAApplicationErrorCategory?
    @Published public private(set) var syncConnectionState: SyncConnectionState = .stale
    @Published public private(set) var firstDeviceRootRecord: FirstDeviceRootRecord?
    @Published public private(set) var firstDeviceRootReadUnavailable = false
    @Published public private(set) var isFirstDeviceRootActionInProgress = false

    public let dependencies: PCAProductionDependencies
    public let linkRouter: PCAEnrollmentLinkRouter
    private let now: () -> Date
    private var started = false
    private var runtimeSyncInProgress = false
    private var pendingDeviceId: String?

    public init(dependencies: PCAProductionDependencies, now: @escaping () -> Date = { Date() }) {
        self.dependencies = dependencies
        self.linkRouter = PCAEnrollmentLinkRouter()
        self.now = now
        self.pendingDeviceId = dependencies.deviceId ?? dependencies.deviceIdentityStore.loadDeviceId()
        self.firstDeviceRootRecord = dependencies.firstDeviceRootStore?.current()
        dependencies.firstDeviceTrustRootCoordinator?.onRecordChanged = { [weak self] _ in
            DispatchQueue.main.async {
                // Coordinator callbacks are only a signal to re-read. The
                // durable store is authoritative; never publish a stale or
                // nil coordinator snapshot as if the ceremony were absent.
                self?.publishFirstDeviceRootRecord()
            }
        }
    }

    public func start() {
        guard !started else { return }
        started = true
        publishFirstDeviceRootRecord()
        authorization = dependencies.authorizationCenter.refresh()
        dependencies.protectionRuntime.authorizationChanged(authorization)
        restoreEnrolledState()
        reconcileCallbackHealth()
        Task { await self.resumeEnrollmentIfPossible() }
        if authorization.permitsEnforcement {
            Task { await self.beginEnrollmentIfPossible() }
        }
        Task { await self.establishSessionIfNeeded() }
        Task { await self.synchronizeRuntime() }
    }

    public func sceneBecameActive() {
        publishFirstDeviceRootRecord()
        authorization = dependencies.authorizationCenter.refresh()
        dependencies.protectionRuntime.authorizationChanged(authorization)
        restoreEnrolledState()
        reconcileCallbackHealth()
        Task { await self.resumeEnrollmentIfPossible() }
        if authorization.permitsEnforcement {
            Task { await self.beginEnrollmentIfPossible() }
        }
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
        if authorization.permitsEnforcement {
            Task { await self.beginEnrollmentIfPossible() }
        }
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
            try? dependencies.attemptStore.clearAttempt()
            publishFirstDeviceRootRecord()
            applicationState = stateForCurrentData()
            Task {
                await self.establishSessionIfNeeded()
                await self.synchronizeRuntime()
            }
        }
    }

    /// Requests the server ceremony only after the user explicitly taps the
    /// corresponding action. No challenge or approval poll is started by
    /// app launch, enrollment, or scene activation.
    public func requestFirstDeviceParentApproval() async {
        guard let record = dependencies.firstDeviceRootStore?.current() else { return }
        let mayStart = record.state == .notStarted || record.state == .expired
        let mayRetryAmbiguousChallenge = record.state == .unknown
            && record.ceremonyId == nil
            && record.submission == nil
        guard mayStart || mayRetryAmbiguousChallenge else { return }
        await performFirstDeviceRootAction { await $0.beginCeremony() }
    }

    /// Explicitly checks the server's current approval/commit status. A newly
    /// observed APPROVED state never submits automatically; submission is a
    /// separate user action.
    public func checkFirstDeviceParentApproval() async {
        guard let state = dependencies.firstDeviceRootStore?.current()?.state else { return }
        switch state {
        case .awaitingApproval, .approved, .submitting, .unknown:
            await performFirstDeviceRootAction { await $0.refreshStatus() }
        case .notStarted, .rootCommitted, .expired, .rejected:
            return
        }
    }

    /// The model repeats the coordinator's APPROVED guard so no UI path can
    /// submit while approval is pending or unknown.
    public func submitApprovedFirstDeviceRoot() async {
        guard dependencies.firstDeviceRootStore?.current()?.state == .approved else { return }
        await performFirstDeviceRootAction { await $0.submit() }
    }

    /// Retries only the byte-identical payload already durably persisted by
    /// the coordinator. It never rebuilds evidence or signs a new payload.
    public func retrySavedFirstDeviceRootSubmission() async {
        guard let record = dependencies.firstDeviceRootStore?.current(),
              record.submission != nil,
              (record.state == .submitting || record.state == .unknown) else { return }
        await performFirstDeviceRootAction { await $0.resubmitExact() }
    }

    private func performFirstDeviceRootAction(
        _ action: (FirstDeviceTrustRootCoordinating) async -> Void
    ) async {
        guard !isFirstDeviceRootActionInProgress,
              let coordinator = dependencies.firstDeviceTrustRootCoordinator else { return }
        isFirstDeviceRootActionInProgress = true
        await action(coordinator)
        publishFirstDeviceRootRecord()
        isFirstDeviceRootActionInProgress = false
    }

    private func publishFirstDeviceRootRecord() {
        // `current()` is optional both when no seed exists yet and when a
        // durable read fails. Preserve an already observed record on a nil
        // read, but mark it unavailable so the UI cannot present stale state
        // as current or successful.
        guard let rootStore = dependencies.firstDeviceRootStore else { return }
        guard let durableRecord = rootStore.current() else {
            if firstDeviceRootRecord != nil { firstDeviceRootReadUnavailable = true }
            return
        }
        firstDeviceRootReadUnavailable = false
        firstDeviceRootRecord = durableRecord
    }

    public func recordPolicyApplication(_ status: PCAProtectionStatus) {
        dependencies.protectionRuntime.recordPolicyApplication(status)
        applicationState = stateForCurrentData()
    }

    private func reconcileCallbackHealth() {
        if case .degraded = dependencies.policyRuntime.callbackHealth(now: now()) {
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = stateForCurrentData()
        }
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
        guard authorization.permitsEnforcement else {
            applicationState = .authorizationRequired
            lastError = .authorization
            return
        }
        guard let link = linkRouter.takePendingLink() else { return }

        let attempt = PCAEnrollmentAttempt(
            attemptId: UUID().uuidString.replacingOccurrences(of: "-", with: ""),
            attemptRecoveryToken: UUID().uuidString + UUID().uuidString
        )
        do {
            try dependencies.attemptStore.saveAttempt(attempt)
            // Wave 6D ordering: the attempt record exists BEFORE any key is
            // generated (attemptId BEFORE keygen), and the Secure Enclave
            // DSK/DEK preparation happens BEFORE the bootstrap request reads
            // the public keys. Every preparation failure (no Secure
            // Enclave, alias conflict, refused generation) is a typed,
            // fail-closed security-gate block -- never a software fallback.
            if let preparation = dependencies.enrollmentKeys {
                do {
                    try preparation.prepareEnrollmentKeys(attemptId: attempt.attemptId)
                } catch {
                    lastError = .securityGate
                    applicationState = .enrollmentBlockedBySecurityGate
                    return
                }
            }
            guard !dependencies.proofProvider.signingPublicKey.isEmpty,
                  !dependencies.proofProvider.encryptionPublicKey.isEmpty else {
                applicationState = .enrollmentBlockedBySecurityGate
                lastError = .securityGate
                return
            }
            let request = PCAEnrollmentBootstrapRequest(
                rawInvitationToken: link.rawInvitationToken,
                signingPublicKey: dependencies.proofProvider.signingPublicKey,
                encryptionPublicKey: dependencies.proofProvider.encryptionPublicKey,
                bootstrapAttemptId: attempt.attemptId,
                attemptRecoveryToken: attempt.attemptRecoveryToken
            )
            let response = try await dependencies.enrollmentClient.bootstrap(request)
            // Wave 6D seed capture: durably record the ceremony credentials
            // and the M1-minted key ids NOW (before any later clear), so a
            // process death can never strand a committed-capable device
            // with no way to reach its own first-device ceremony.
            guard captureFirstDeviceSeed(attempt: attempt, response: response) else {
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return
            }
            publishFirstDeviceRootRecord()
            pendingDeviceId = response.deviceId
            dependencies.deviceIdentityStore.saveDeviceId(response.deviceId)
            cleanupConfirmedEnrollmentKeys(attempt: attempt)
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

    /// Wave 6D: durable ceremony seed (no private material -- aliases only).
    /// FAIL CLOSED: a seed is persisted only when BOTH Secure Enclave public
    /// keys are actually readable (the Android blank-guard parity); an empty
    /// capture would wedge the ceremony with an unusable identity.
    private func captureFirstDeviceSeed(attempt: PCAEnrollmentAttempt, response: PCAEnrollmentBootstrapResponse) -> Bool {
        guard let rootStore = dependencies.firstDeviceRootStore else { return true }
        let dskPublicKey = dependencies.proofProvider.signingPublicKey
        let dekPublicKey = dependencies.proofProvider.encryptionPublicKey
        guard !dskPublicKey.isEmpty, !dekPublicKey.isEmpty else { return false }
        let seed = FirstDeviceCeremonySeed(
            attemptId: attempt.attemptId,
            attemptRecoveryToken: attempt.attemptRecoveryToken,
            serverBaseUrl: PCAProductionCompositionRoot.productionAPIBaseURL.absoluteString,
            deviceId: response.deviceId,
            signingKeyId: response.signingKeyId,
            encryptionKeyId: response.encryptionKeyId,
            dskPublicKeyBase64: dskPublicKey,
            dekPublicKeyBase64: dekPublicKey,
            dskAlias: "pca.dsk.\(attempt.attemptId)",
            dekAlias: "pca.dek.\(attempt.attemptId)"
        )
        // Same-attempt recovery is idempotent. Another attempt can replace
        // only an authoritatively EXPIRED or REJECTED root; in-progress,
        // ambiguous, and committed records remain owned by their attempt.
        return rootStore.captureSeed(
            FirstDeviceRootRecord(seed: seed),
            replacingTerminalStates: [.expired, .rejected]
        )
    }

    /// Bootstrap and recovery use the same confirmed-root key retention barrier.
    private func cleanupConfirmedEnrollmentKeys(attempt: PCAEnrollmentAttempt) {
        if let rootStore = dependencies.firstDeviceRootStore {
            rootStore.withConfirmedCurrentRecord { retained in
                dependencies.keyDeletion?.deleteOrphanedAttemptKeys(
                    keepAttemptIds: [attempt.attemptId, retained.seed.attemptId]
                )
            }
        } else {
            dependencies.keyDeletion?.deleteOrphanedAttemptKeys(keepAttemptIds: [attempt.attemptId])
        }
    }

    private func resumeEnrollmentIfPossible() async {
        guard authorization.permitsEnforcement,
              pendingDeviceId == nil,
              let attempt = try? dependencies.attemptStore.loadAttempt() else { return }
        applicationState = .recovering
        do {
            let response = try await dependencies.enrollmentClient.recover(
                attemptId: attempt.attemptId,
                attemptRecoveryToken: attempt.attemptRecoveryToken
            )
            // Wave 6D: the recovery path restores the SAME ceremony seed the
            // original bootstrap would have captured (idempotent capture).
            if let preparation = dependencies.enrollmentKeys {
                try? preparation.prepareEnrollmentKeys(attemptId: attempt.attemptId)
            }
            guard captureFirstDeviceSeed(attempt: attempt, response: response) else {
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return
            }
            publishFirstDeviceRootRecord()
            pendingDeviceId = response.deviceId
            dependencies.deviceIdentityStore.saveDeviceId(response.deviceId)
            cleanupConfirmedEnrollmentKeys(attempt: attempt)
            let profile = PCAEnrollmentProfile(
                childProfileId: response.childProfileId,
                ageUxTier: response.ageUxTier,
                initialPolicyProfile: response.initialPolicyProfile
            )
            profileRuntimeState = .awaitingChildConfirmation(profile, PCAEnrollmentDisclosure.forProfile(profile))
            pendingDisclosure = PCAEnrollmentDisclosure.forProfile(profile)
            applicationState = .enrollmentInProgress
        } catch let error as PCAAPIError {
            lastError = Self.category(for: error)
            applicationState = Self.state(for: error)
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
            let session = PCADeviceSession(deviceId: deviceId, sessionToken: response.sessionToken, expiresAt: response.expiresAt)
            try dependencies.sessionStore.saveSession(session)
            await reportProtectionStatusIfPossible(session: session)
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

    @MainActor func synchronizeRuntime() async {
        guard !runtimeSyncInProgress else { return }
        runtimeSyncInProgress = true
        defer { runtimeSyncInProgress = false }
        guard let runtimeSyncClient = dependencies.runtimeSyncClient,
              let inbox = dependencies.inboundInbox,
              let session = try? dependencies.sessionStore.loadSession(),
              session.expiresAt > now() else {
            syncConnectionState = .stale
            return
        }
        syncConnectionState = .syncing
        do {
            try dependencies.assertRuntimeKeyCustody(session.deviceId)
            let response = try await runtimeSyncClient.pull(session: session)
            guard try dependencies.sessionStore.loadSession() == session, session.expiresAt > now() else {
                throw PCAAPIError.unauthorized
            }
            try inbox.capture(response, sessionDeviceId: session.deviceId)
            for record in try inbox.pendingAcknowledgements(scope: response.scope) {
                try dependencies.assertRuntimeKeyCustody(session.deviceId)
                guard try dependencies.sessionStore.loadSession() == session, session.expiresAt > now() else {
                    throw PCAAPIError.unauthorized
                }
                try await runtimeSyncClient.acknowledge(messageId: record.envelope.messageId, session: session)
                try inbox.markAcknowledged(record.envelope, scope: response.scope)
            }
            guard try dependencies.sessionStore.loadSession() == session, session.expiresAt > now() else {
                throw PCAAPIError.unauthorized
            }
            let pendingCrypto = try inbox.pendingCrypto(scope: response.scope)
            try dependencies.assertRuntimeKeyCustody(session.deviceId)
            syncConnectionState = SyncConnectionStateComputer.compute(SyncConnectionStateInput(
                isTransportConnected: true,
                isSyncing: false,
                hasPendingLocalWork: !pendingCrypto.isEmpty || response.hasMore ||
                    !response.unparseableMessageIds.isEmpty || !response.droppedForListBound.isEmpty,
                lastSuccessfulSyncAtUtc: now(),
                nowUtc: now(),
                staleThresholdSeconds: 24 * 60 * 60
            ))
            if !pendingCrypto.isEmpty {
                dependencies.protectionRuntime.recordPolicyApplication(.degraded)
                applicationState = stateForCurrentData()
            }
            await reportProtectionStatusIfPossible(session: session)
        } catch let error as PCAAPIError {
            syncConnectionState = (error == .unauthorized) ? .stale : .offline
            if error == .unauthorized, (try? dependencies.sessionStore.loadSession()) == session {
                try? dependencies.sessionStore.clearSession()
            }
            applicationState = error == .unauthorized ? .recovering : .offline
        } catch is PCADeviceProofError {
            if (try? dependencies.sessionStore.loadSession()) == session { try? dependencies.sessionStore.clearSession() }
            syncConnectionState = .stale
            applicationState = .enrollmentBlockedBySecurityGate
            lastError = .securityGate
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
        #if canImport(Security)
        let inboundInbox: PCAInboundInboxStoring? = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "org.pca.app")
        #else
        let inboundInbox: PCAInboundInboxStoring? = nil
        #endif
        let keyMaterial = FamilyKeyMaterialStore(keychain: keychain, serviceNamespace: "org.pca.app")
        let firstDeviceRootStore = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.app")
        let enrollmentCoordinator = ChildEnrollmentCoordinator(keyMaterialStore: keyMaterial, authorizationCenter: authorizationCenter)
        let transport = PCAURLSessionTransport()
        let client = try! PCAEnrollmentBootstrapClient(baseURL: productionAPIBaseURL, transport: transport)
        // Wave 6D: ONE shared reference-typed device identity -- the
        // Secure Enclave DSK-backed provider -- used by BOTH the enrollment
        // bootstrap path and the runtime-sync session client. It fails
        // closed (empty public keys / typed refusals) until an enrollment
        // attempt has prepared its keys, so nothing permissive can leak
        // into either transport. The persisted attempt seam resolves the
        // enrolled DSK across process restarts through the durable
        // first-device root store.
        #if canImport(Security) && canImport(CryptoKit)
        let secureEnclaveProvider = SecureEnclaveDskProvider()
        let deviceProofProvider = FirstDeviceDskDeviceProofProvider(
            provider: secureEnclaveProvider,
            persistedAttemptId: { firstDeviceRootStore.current()?.seed.attemptId }
        )
        let enrollmentKeyPreparation: FirstDeviceEnrollmentKeyPreparation? = deviceProofProvider
        let keyDeletion: FirstDeviceKeyPairDeletion? = secureEnclaveProvider
        #else
        let deviceProofProvider: PCADeviceProofProvider = PendingPCADeviceProofProvider()
        let enrollmentKeyPreparation: FirstDeviceEnrollmentKeyPreparation? = nil
        let keyDeletion: FirstDeviceKeyPairDeletion? = nil
        #endif
        let firstDeviceBootstrapApiClient = try? FirstDeviceBootstrapApiClient(
            baseURL: productionAPIBaseURL,
            transport: transport
        )
        let firstDeviceTrustRootCoordinator: FirstDeviceTrustRootCoordinating?
        #if canImport(Security) && canImport(CryptoKit) && canImport(DeviceCheck)
        let appAttestService = DCAppAttestService.shared
        let concreteCoordinator = PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: firstDeviceRootStore,
            apiClient: firstDeviceBootstrapApiClient,
            keyMaterial: secureEnclaveProvider,
            evidenceBuilder: IosAppAttestAdapter(service: appAttestService),
            appAttestIsSupported: appAttestService.isSupported
        )
        firstDeviceTrustRootCoordinator = concreteCoordinator
        #else
        firstDeviceTrustRootCoordinator = nil
        #endif
        let sessionClient = try! PCADeviceSessionClient(baseURL: productionAPIBaseURL, transport: transport, proof: deviceProofProvider)
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
            inboundInbox: inboundInbox,
            assertRuntimeKeyCustody: { deviceId in
                guard let root = firstDeviceRootStore.current(), root.state == .rootCommitted,
                      root.seed.deviceId == deviceId, deviceProofProvider.signingPublicKey == root.seed.dskPublicKeyBase64 else {
                    throw PCADeviceProofError.secureKeyUnavailable
                }
                _ = try deviceProofProvider.sign(challenge: "PCA_LOCAL_RUNTIME_KEY_CUSTODY_V1")
            },
            sessionStore: stateStore,
            attemptStore: stateStore,
            profileStore: profileStore,
            proofProvider: deviceProofProvider,
            enrollmentKeys: enrollmentKeyPreparation,
            keyDeletion: keyDeletion,
            firstDeviceRootStore: firstDeviceRootStore,
            firstDeviceTrustRootCoordinator: firstDeviceTrustRootCoordinator,
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
