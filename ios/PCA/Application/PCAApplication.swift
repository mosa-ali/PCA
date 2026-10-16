import Foundation
import Combine
import SwiftUI
#if canImport(CryptoKit)
import CryptoKit
#endif

public enum PCARuntimeCustodyOutcome: Equatable { case complete, morePending, retryableFailure, blocked, ineligible }

private func isRetryableOptionalSafeZoneDeliveryFailure(_ error: Error) -> Bool {
    if let apiError = error as? PCAAPIError {
        switch apiError {
        case .invalidConfiguration, .invalidRequest, .unavailable, .rejected, .malformedResponse,
             .transport(.network), .transport(.timeout), .transport(.responseTooLarge), .transport(.invalidResponse):
            return true
        case .unauthorized, .forbidden, .transport(.insecureURL), .attemptAbandoned, .preparationRejected,
             .enrollmentOutcomeUnknown:
            return false
        }
    }
    if let deliveryError = error as? PCADeviceSafeZoneDeliveryError {
        switch deliveryError {
        case .malformedResponse, .staleCursor, .persistenceUnavailable:
            return true
        case .invalidScope, .staleRevision, .conflictingRevision, .scopeChanged, .corruptInbox:
            return false
        }
    }
    return false
}
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

public struct PCADevicePolicyActivationBootstrapResult {
    public let target: PCADevicePolicyActivationTarget
    public let proofChallenge: PCADevicePolicyProofChallenge
    public let session: PCADeviceBootstrapSession

    fileprivate init(target: PCADevicePolicyActivationTarget, proofChallenge: PCADevicePolicyProofChallenge,
                     session: PCADeviceBootstrapSession) {
        self.target = target
        self.proofChallenge = proofChallenge
        self.session = session
    }
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
    public let inboundConsumer: PCAInboundCommandConsumer?
    public let safeZoneDeliveryClient: PCADeviceSafeZoneDeliveryClient?
    public let safeZoneDeliveryInbox: PCAKeychainSafeZoneDeliveryInbox?
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
    /// Ordinary signed Trust Set epoch progression uses the committed first
    /// device root and the same device-session/Secure Enclave custody.
    public let ordinaryTrustSetCoordinator: OrdinaryTrustSetRuntimeManaging?
    /// Production composition may be created before the first-device root is
    /// committed. Retain a factory so the signed epoch coordinator can be
    /// resolved lazily once the same durable root reaches that state.
    public let ordinaryTrustSetCoordinatorFactory: (() throws -> OrdinaryTrustSetRuntimeManaging)?
    public let policyRuntime: PCAProtectionPolicyRuntime
    public let applicationProofStore: PCADeviceApplicationProofStore?
    public let policyEnvelopeProcessor: PCADevicePolicyEnvelopeProcessing?
    public let activationClient: PCADevicePolicyActivationClient?
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
        inboundConsumer: PCAInboundCommandConsumer? = nil,
        safeZoneDeliveryClient: PCADeviceSafeZoneDeliveryClient? = nil,
        safeZoneDeliveryInbox: PCAKeychainSafeZoneDeliveryInbox? = nil,
        assertRuntimeKeyCustody: @escaping (String) throws -> Void = { _ in throw PCADeviceProofError.secureKeyUnavailable },
        sessionStore: PCADeviceSessionStore,
        attemptStore: PCAEnrollmentAttemptStore,
        profileStore: PCAEnrollmentProfileStore,
        proofProvider: PCADeviceProofProvider,
        enrollmentKeys: FirstDeviceEnrollmentKeyPreparation? = nil,
        keyDeletion: FirstDeviceKeyPairDeletion? = nil,
        firstDeviceRootStore: FirstDeviceRootStoring? = nil,
        firstDeviceTrustRootCoordinator: FirstDeviceTrustRootCoordinating? = nil,
        ordinaryTrustSetCoordinator: OrdinaryTrustSetRuntimeManaging? = nil,
        ordinaryTrustSetCoordinatorFactory: (() throws -> OrdinaryTrustSetRuntimeManaging)? = nil,
        policyRuntime: PCAProtectionPolicyRuntime = PCAUnavailableProtectionPolicyRuntime(),
        applicationProofStore: PCADeviceApplicationProofStore? = nil,
        policyEnvelopeProcessor: PCADevicePolicyEnvelopeProcessing? = nil,
        activationClient: PCADevicePolicyActivationClient? = nil,
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
        self.inboundConsumer = inboundConsumer
        self.safeZoneDeliveryClient = safeZoneDeliveryClient
        self.safeZoneDeliveryInbox = safeZoneDeliveryInbox
        self.assertRuntimeKeyCustody = assertRuntimeKeyCustody
        self.sessionStore = sessionStore
        self.attemptStore = attemptStore
        self.profileStore = profileStore
        self.proofProvider = proofProvider
        self.enrollmentKeys = enrollmentKeys
        self.keyDeletion = keyDeletion
        self.firstDeviceRootStore = firstDeviceRootStore
        self.firstDeviceTrustRootCoordinator = firstDeviceTrustRootCoordinator
        self.ordinaryTrustSetCoordinator = ordinaryTrustSetCoordinator
        self.ordinaryTrustSetCoordinatorFactory = ordinaryTrustSetCoordinatorFactory
        self.policyRuntime = policyRuntime
        self.applicationProofStore = applicationProofStore
        self.policyEnvelopeProcessor = policyEnvelopeProcessor
        self.activationClient = activationClient
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

@MainActor public final class PCAApplicationModel: ObservableObject {
    private var pairedBootstrapSessions: [String: PCADeviceBootstrapSession] = [:]
    @Published public private(set) var applicationState: PCAApplicationState = .initializing
    @Published public private(set) var authorization: ChildAuthorizationState = .notDetermined
    @Published public private(set) var profileRuntimeState: PCAEnrollmentProfileRuntimeState = .awaitingProfile
    @Published public private(set) var pendingDisclosure: PCAEnrollmentDisclosure?
    @Published public private(set) var lastError: PCAApplicationErrorCategory?
    @Published public private(set) var syncConnectionState: SyncConnectionState = .stale
    @Published public private(set) var firstDeviceRootRecord: FirstDeviceRootRecord?
    @Published public private(set) var firstDeviceRootReadUnavailable = false
    @Published public private(set) var isFirstDeviceRootActionInProgress = false
    @Published public private(set) var enrollmentOperationInProgress = false
    @Published public private(set) var pairedActivationInProgress = false
    @Published public private(set) var pairedActivationCryptoUnavailable = false
    /// Durable request awaiting a server response. Retained for exact retries
    /// only during the owner-approved 14-day window.
    public private(set) var lastDeviceApplicationProof: PCADeviceApplicationProof?

    public let dependencies: PCAProductionDependencies
    public let linkRouter: PCAEnrollmentLinkRouter
    private let now: () -> Date
    private var resolvedOrdinaryTrustSetCoordinator: OrdinaryTrustSetRuntimeManaging?
    /// A newly received invite may have a durable local attempt before any
    /// bootstrap request reached the server. Do not reinterpret that pre-send
    /// security gate as a remotely recoverable attempt in this process.
    private var localEnrollmentBootstrapNotYetSubmitted = false
    private var started = false
    private var runtimeSyncInProgress = false
    private var sessionEstablishmentInProgress = false
    private var pendingDeviceId: String?
    private var pendingProfileEnrollmentAttempt: PCAEnrollmentAttempt?

    /// True only for an exact durable attempt whose remote outcome can be
    /// resolved safely through the recovery endpoint.
    public var hasPendingEnrollmentStatusCheck: Bool {
        guard authorization.permitsEnforcement,
              pendingProfileEnrollmentAttempt == nil,
              !localEnrollmentBootstrapNotYetSubmitted else { return false }
        do {
            guard let attempt = try dependencies.attemptStore.loadAttempt() else { return false }
            return attempt.submissionState == .submitted || attempt.submissionState == .awaitingInvitation
        } catch {
            return false
        }
    }

    /// A parent invitation may be entered only before a device identity is
    /// bound locally. If a durable first-device ceremony exists, expose the
    /// link entry only for its exact unresolved enrollment attempt; a committed
    /// root or an orphaned root record must never look like a fresh setup path.
    public var canEnterEnrollmentLink: Bool {
        guard pendingDeviceId == nil, !enrollmentOperationInProgress,
              !firstDeviceRootReadUnavailable else { return false }
        if let rootStore = dependencies.firstDeviceRootStore {
            guard let root = rootStore.current() else {
                // The root may become unreadable after launch (for example,
                // while Keychain is temporarily unavailable). Do not let a
                // stale "fresh install" view authorize a new invitation.
                return rootStore.withConfirmedNoCurrentRecord({})
            }
            guard root.state != .rootCommitted,
                  let attempt = try? dependencies.attemptStore.loadAttempt(),
                  attempt.attemptId == root.seed.attemptId,
                  attempt.invitationTokenSHA256 != nil else { return false }
        }
        return true
    }

    /// Bootstrap, restart recovery and repeated foreground notifications share
    /// one admission slot. Main-actor isolation protects the slot between awaits.
    private func acquireEnrollmentAdmission() -> Bool {
        guard !enrollmentOperationInProgress else { return false }
        enrollmentOperationInProgress = true
        return true
    }

    private func releaseEnrollmentAdmission() {
        enrollmentOperationInProgress = false
    }

    private func stillOwnsEnrollmentAttempt(_ attempt: PCAEnrollmentAttempt) -> Bool {
        do {
            guard try dependencies.attemptStore.loadAttempt() == attempt else {
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return false
            }
            return true
        } catch {
            lastError = .recoverable
            applicationState = .error(.recoverable)
            return false
        }
    }

    public init(dependencies: PCAProductionDependencies, now: @escaping () -> Date = { Date() }) {
        self.dependencies = dependencies
        self.resolvedOrdinaryTrustSetCoordinator = dependencies.ordinaryTrustSetCoordinator
        self.linkRouter = PCAEnrollmentLinkRouter()
        self.now = now
        let durableRoot = dependencies.firstDeviceRootStore?.current()
        self.firstDeviceRootRecord = durableRoot
        let retainedDeviceId = dependencies.deviceId ?? dependencies.deviceIdentityStore.loadDeviceId()
        if let retainedDeviceId {
            self.pendingDeviceId = retainedDeviceId
        } else if let durableRoot,
                  durableRoot.state == .rootCommitted,
                  dependencies.firstDeviceRootStore?.confirmDurable(durableRoot) == true {
            // UserDefaults is only a convenience mirror. A committed, freshly
            // confirmed Keychain root is the durable source of device identity
            // after the mirror is lost; never derive it from an unreadable,
            // pending, or unconfirmed root.
            self.pendingDeviceId = durableRoot.seed.deviceId
        } else {
            self.pendingDeviceId = nil
        }
        if self.firstDeviceRootRecord == nil,
           let rootStore = dependencies.firstDeviceRootStore {
            // `current()` uses nil for both a genuinely empty store and an
            // unreadable/corrupt Keychain item. Fresh setup is allowed only
            // after the store proves absence under its read lock; otherwise
            // a damaged retained root could be mistaken for a fresh install.
            self.firstDeviceRootReadUnavailable = !rootStore.withConfirmedNoCurrentRecord({})
        }
        dependencies.firstDeviceTrustRootCoordinator?.onRecordChanged = { [weak self] _ in
            Task { @MainActor [weak self] in
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
        Task {
            await self.resumeEnrollmentIfPossible()
            if self.authorization.permitsEnforcement {
                await self.beginEnrollmentIfPossible()
            }
        }
        Task { await self.establishSessionIfNeeded(); await self.synchronizeRuntime() }
    }

    public func sceneBecameActive() {
        publishFirstDeviceRootRecord()
        authorization = dependencies.authorizationCenter.refresh()
        dependencies.protectionRuntime.authorizationChanged(authorization)
        restoreEnrolledState()
        reconcileCallbackHealth()
        Task {
            await self.resumeEnrollmentIfPossible()
            if self.authorization.permitsEnforcement {
                await self.beginEnrollmentIfPossible()
            }
        }
        Task { await self.establishSessionIfNeeded(); await self.synchronizeRuntime() }
    }

    public func requestAuthorization() async {
        applicationState = .authorizationRequired
        if case let .authorizationState(next) = await dependencies.enrollmentCoordinator.requestChildAuthorization() {
            authorization = next
        }
        dependencies.protectionRuntime.authorizationChanged(authorization)
        restoreEnrolledState()
        if !authorization.permitsEnforcement {
            // An authorization request can itself observe revocation while the
            // app is active. Drive the installed runtime gate immediately so
            // stale ManagedSettings do not wait for another foreground or OS
            // DeviceActivity callback to be removed.
            reconcileInstalledProtectionPolicy(now: now())
        }
        if authorization.permitsEnforcement {
            Task {
                await self.resumeEnrollmentIfPossible()
                await self.beginEnrollmentIfPossible()
            }
        }
    }

    /// Resolves the exact persisted attempt. It never creates or submits a
    /// replacement invitation/bootstrap request.
    public func checkEnrollmentStatus() {
        guard hasPendingEnrollmentStatusCheck, !enrollmentOperationInProgress else { return }
        Task { await self.resumeEnrollmentIfPossible() }
    }

    @discardableResult
    public func receiveEnrollmentLink(_ url: URL) -> Bool {
        // Main-actor isolation and the operation flag make the durable check
        // plus router insertion one admission step relative to bootstrap and
        // recovery. An unresolved attempt accepts only its bound invitation.
        guard canEnterEnrollmentLink else { return false }
        guard let link = PCAEnrollmentLinkParser().parse(url) else { return false }
        let invitationTokenSHA256 = FirstDeviceCanonical.sha256Hex(link.rawInvitationToken)
        var existingAttempt: PCAEnrollmentAttempt?
        do {
            let storedAttempt = try dependencies.attemptStore.loadAttempt()
            existingAttempt = storedAttempt
            if let storedAttempt {
                guard let boundDigest = storedAttempt.invitationTokenSHA256,
                      pcaOpaqueEqual(boundDigest, invitationTokenSHA256) else {
                    lastError = .recoverable
                    applicationState = .error(.recoverable)
                    return false
                }
            }
            guard linkRouter.receive(url) else { return false }
        } catch {
            lastError = .recoverable
            applicationState = .error(.recoverable)
            return false
        }
        applicationState = .enrollmentInProgress
        if existingAttempt?.submissionState == .submitted || existingAttempt?.submissionState == .awaitingInvitation {
            // An ambiguous request must resolve through the recovery endpoint
            // before any bootstrap retry can be considered.
            localEnrollmentBootstrapNotYetSubmitted = false
            Task {
                await self.resumeEnrollmentIfPossible()
                await self.beginEnrollmentIfPossible()
            }
        } else {
            localEnrollmentBootstrapNotYetSubmitted = true
            Task { await self.beginEnrollmentIfPossible() }
        }
        return true
    }

    public func confirmPendingProfile() {
        guard let deviceId = pendingDeviceId,
              case .awaitingChildConfirmation = profileRuntimeState else { return }
        guard let attempt = pendingProfileEnrollmentAttempt else {
            lastError = .recoverable
            applicationState = .error(.recoverable)
            return
        }
        guard stillOwnsEnrollmentAttempt(attempt) else { return }
        let controller = PCAEnrollmentProfileRuntimeController(
            deviceId: deviceId,
            store: dependencies.profileStore,
            authorization: authorization
        )
        if case let .awaitingChildConfirmation(profile, _) = profileRuntimeState {
            var confirmedState: PCAEnrollmentProfileRuntimeState?
            do {
                guard try dependencies.attemptStore.performIfCurrent(attempt, {
                    _ = dependencies.enrollmentCoordinator.consumeProfile(profile, authorization: authorization)
                    controller.receiveParentAuthorizedProfile(profile)
                    let result = controller.confirmChildProfile()
                    confirmedState = result
                    return result != .profilePersistenceFailed
                }) else {
                    _ = stillOwnsEnrollmentAttempt(attempt)
                    return
                }
            } catch {
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return
            }
            guard let confirmedState, confirmedState != .profilePersistenceFailed else {
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return
            }
            profileRuntimeState = confirmedState
            pendingProfileEnrollmentAttempt = nil
            pendingDisclosure = nil
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
            if firstDeviceRootRecord != nil {
                firstDeviceRootReadUnavailable = true
            } else {
                // An initial nil is not proof that the Keychain item is
                // absent: corrupt and temporarily unavailable reads also
                // return nil. Only the store's atomic missing-state check
                // can keep fresh enrollment enabled.
                firstDeviceRootReadUnavailable = !rootStore.withConfirmedNoCurrentRecord({})
            }
            return
        }
        firstDeviceRootReadUnavailable = false
        firstDeviceRootRecord = durableRecord
    }

    public func recordPolicyApplication(_ status: PCAProtectionStatus) {
        dependencies.protectionRuntime.recordPolicyApplication(status)
        applicationState = stateForCurrentData()
    }

    /// Performs only the narrow PAIRED bootstrap: request this device's
    /// challenge, prove possession with its current DSK, then fetch the single
    /// activation target. The returned target remains untrusted ciphertext;
    /// no policy can be applied until the configured production processor
    /// verifies and decrypts it.
    public func fetchPairedActivationTarget() async throws -> PCADevicePolicyActivationBootstrapResult {
        guard let client = dependencies.activationClient,
              let rootStore = dependencies.firstDeviceRootStore,
              let root = rootStore.current(), root.state == .rootCommitted,
              rootStore.confirmDurable(root),
              let familyId = root.familyId,
              let deviceId = pendingDeviceId,
              pcaOpaqueEqual(root.seed.deviceId, deviceId),
              !dependencies.proofProvider.signingPublicKey.isEmpty else {
            throw PCAAPIError.unavailable
        }
        try dependencies.assertRuntimeKeyCustody(deviceId)
        let firstChallenge = try await client.challenge(familyId: familyId, deviceId: deviceId)
        guard rootStore.current() == root, rootStore.confirmDurable(root) else {
            throw PCADeviceProofError.secureKeyUnavailable
        }
        try dependencies.assertRuntimeKeyCustody(deviceId)
        // Backend bootstrap PoP is explicitly the UTF-8 bytes of this nonce
        // string. The DSK provider returns canonical low-S P1363 base64url.
        let possessionSignature = try dependencies.proofProvider.sign(challenge: firstChallenge.nonce)
        guard rootStore.current() == root, rootStore.confirmDurable(root) else {
            throw PCADeviceProofError.secureKeyUnavailable
        }
        try dependencies.assertRuntimeKeyCustody(deviceId)
        let session = try await client.complete(familyId: familyId, deviceId: deviceId,
            challenge: firstChallenge, signature: possessionSignature)
        let target = try await client.fetch(familyId: familyId, deviceId: deviceId, session: session)
        guard target.challengeId == session.challengeId,
              target.policyEnvelopeMessageId == session.policyEnvelopeMessageId,
              target.policyEnvelopeSha256 == session.policyEnvelopeSha256,
              target.trustSetEpoch == session.trustSetEpoch,
              target.keyEpoch == session.keyEpoch,
              rootStore.current() == root, rootStore.confirmDurable(root) else {
            throw PCAAPIError.malformedResponse
        }
        try dependencies.assertRuntimeKeyCustody(deviceId)
        pairedBootstrapSessions[session.challengeId] = session
        return PCADevicePolicyActivationBootstrapResult(target: target, proofChallenge: session.proofChallenge, session: session)
    }

    /// Production entry point for the narrow paired activation flow. The
    /// server challenge/DSK ceremony creates a PAIRED_BOOTSTRAP session; the
    /// returned ciphertext is then handed directly to the existing receiver
    /// boundary. No proof is submitted unless that boundary verifies and
    /// decrypts the envelope and the local runtime reports successful
    /// enforcement.
    @MainActor public func checkPairedActivation() async {
        guard !pairedActivationInProgress else { return }
        pairedActivationInProgress = true
        pairedActivationCryptoUnavailable = false
        defer { pairedActivationInProgress = false }
        do {
            let bootstrap = try await fetchPairedActivationTarget()
            guard let result = applyVerifiedPolicy(
                activationTarget: bootstrap.target,
                proofChallenge: bootstrap.proofChallenge
            ), result == .applied else {
                // The bootstrap token is deliberately discarded when the
                // receiver gate cannot produce an APPLIED proof. A future
                // approved receiver must obtain a fresh challenge/session.
                pairedBootstrapSessions.removeValue(forKey: bootstrap.session.challengeId)
                pairedActivationCryptoUnavailable = dependencies.policyEnvelopeProcessor == nil
                return
            }
            _ = try await submitDeviceApplicationProof(challengeId: bootstrap.session.challengeId)
        } catch let error as PCAAPIError {
            lastError = Self.category(for: error)
        } catch {
            lastError = .recoverable
        }
    }

    private func reconcileCallbackHealth() {
        let currentTime = now()
        switch dependencies.policyRuntime.usageMonitorStatus(now: currentTime) {
        case .expired, .deviceTimeZoneChanged:
            guard authorization.permitsEnforcement else {
                dependencies.protectionRuntime.recordPolicyApplication(.degraded)
                applicationState = stateForCurrentData()
                return
            }
            do {
                let result = try dependencies.policyRuntime.renewInstalledUsageMonitor(now: currentTime)
                if result != .applied {
                    dependencies.protectionRuntime.recordPolicyApplication(.degraded)
                    applicationState = stateForCurrentData()
                }
            } catch {
                dependencies.protectionRuntime.recordPolicyApplication(.degraded)
                applicationState = stateForCurrentData()
            }
        case .unavailable, .planned: break
        }
        reconcileInstalledProtectionPolicy(now: currentTime)
        if dependencies.policyRuntime.callbackHealth(now: now()).indicatesProtectionDegraded {
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = stateForCurrentData()
        }
    }

    private func reconcileInstalledProtectionPolicy(now: Date) {
        do {
            guard let result = try dependencies.policyRuntime.reconcileInstalledPolicy(now: now) else { return }
            switch result {
            case .applied: dependencies.protectionRuntime.recordPolicyApplication(.active)
            case .scheduledOnly: dependencies.protectionRuntime.recordPolicyApplication(.notReady)
            case .degraded: dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            }
            applicationState = stateForCurrentData()
        } catch {
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = stateForCurrentData()
        }
    }

    /// PAIRED activation application boundary. The injected envelope processor
    /// must verify the exact canonical target, decrypt it, and decode policy
    /// before the durable Trust Set gate and production runtime are reached.
    /// No general relay item or local receipt is accepted here.
    @discardableResult
    public func applyVerifiedPolicy(
        activationTarget: PCADevicePolicyActivationTarget,
        proofChallenge: PCADevicePolicyProofChallenge,
        now: Date? = nil
    ) -> PCAProtectionPolicyApplicationResult? {
        guard let deviceId = pendingDeviceId,
              let familyId = firstDeviceRootRecord?.familyId,
              let processor = dependencies.policyEnvelopeProcessor else {
            pairedBootstrapSessions.removeValue(forKey: activationTarget.challengeId)
            lastError = .securityGate
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = .protectionDegraded
            return .degraded
        }
        let payload: PCADecryptedPolicyApplicationPayload
        let targetCanonicalBytes: Data
        do {
            targetCanonicalBytes = try activationTarget.canonicalBytes()
            payload = try processor.verifyDecryptAndDecode(target: activationTarget,
                expectedFamilyId: familyId, expectedDeviceId: deviceId)
        } catch {
            lastError = .securityGate
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = .protectionDegraded
            return .degraded
        }
        guard payload.envelope.messageId == activationTarget.policyEnvelopeMessageId,
              payload.envelope.signature == activationTarget.envelopeSignature,
              (try? PCADevicePolicyEnvelopeCanonicalizer.canonicalBytes(payload.envelope)) == targetCanonicalBytes,
              payload.envelope.trustSetEpoch == activationTarget.trustSetEpoch,
              payload.envelope.keyEpoch == activationTarget.keyEpoch else {
            lastError = .securityGate
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = .protectionDegraded
            return .degraded
        }
        let verifiedEnvelope = payload.envelope

        let currentFloor: PolicyEpochStamp
        do {
            guard let trustSet = try ordinaryTrustSetRuntimeManagerIfAvailable(),
                  let floor = try trustSet.acceptedEpochFloor(familyId: verifiedEnvelope.familyId) else {
                throw OrdinaryTrustSetError.malformedState
            }
            currentFloor = floor
        } catch {
            lastError = .securityGate
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = .protectionDegraded
            return .degraded
        }

        // This is the production last-use gate: no policy reaches durable
        // persistence or ManagedSettings unless the injected receiver has
        // verified/decrypted/decoded this exact envelope and its immutable
        // scope/epochs match the durable Trust Set floor.
        guard verifiedEnvelope.messageType == "POLICY_UPDATE",
              let recipient = verifiedEnvelope.recipientDeviceId,
              pcaOpaqueEqual(recipient, pendingDeviceId),
              let acceptedFamilyId = firstDeviceRootRecord?.familyId,
              pcaOpaqueEqual(verifiedEnvelope.familyId, acceptedFamilyId),
              PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: verifiedEnvelope.trustSetEpoch, keyEpoch: verifiedEnvelope.keyEpoch),
                currentFloor: currentFloor
              ) == .apply,
              let canonicalEnvelope = try? PCADevicePolicyEnvelopeCanonicalizer.canonicalBytes(verifiedEnvelope),
              let envelopeDigest = try? PCADevicePolicyEnvelopeCanonicalizer.sha256(canonicalEnvelope) else {
            lastError = .securityGate
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = .protectionDegraded
            return .degraded
        }

        do {
            let digest = PCADevicePolicyProofCodec.base64URL(envelopeDigest)
            guard proofChallenge.challengeId == activationTarget.challengeId,
                  pcaOpaqueEqual(proofChallenge.familyId, verifiedEnvelope.familyId),
                  pcaOpaqueEqual(proofChallenge.deviceId, recipient),
                  pcaOpaqueEqual(proofChallenge.policyEnvelopeMessageId, verifiedEnvelope.messageId),
                  pcaOpaqueEqual(proofChallenge.policyEnvelopeSha256, digest),
                  proofChallenge.trustSetEpoch == verifiedEnvelope.trustSetEpoch,
                  proofChallenge.keyEpoch == verifiedEnvelope.keyEpoch else {
                lastError = .securityGate
                dependencies.protectionRuntime.recordPolicyApplication(.degraded)
                applicationState = .protectionDegraded
                return .degraded
            }
        }

        let applicationTime = now ?? self.now()
        do {
            guard let challengeExpiry = PCADevicePolicyProofCodec.canonicalDate(proofChallenge.expiresAt),
                  challengeExpiry > applicationTime,
                  (try? PCADevicePolicyProofCodec.encode(proofChallenge, result: .applied)) != nil else {
                lastError = .securityGate
                dependencies.protectionRuntime.recordPolicyApplication(.degraded)
                applicationState = .protectionDegraded
                return .degraded
            }
        }

        guard authorization.permitsEnforcement else {
            dependencies.protectionRuntime.recordPolicyApplication(.degraded)
            applicationState = stateForCurrentData()
            return .degraded
        }

        do {
            let result = try dependencies.policyRuntime.applyVerifiedPolicy(
                scheduleData: payload.scheduleData,
                applicationTokenData: payload.applicationTokenData,
                protectedApplicationTokenData: payload.protectedApplicationTokenData,
                now: applicationTime
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
            guard let store = dependencies.applicationProofStore else {
                throw PCAInboundInboxError.unavailable
            }
            let proofResult: PCADevicePolicyApplicationResult
            switch result {
            case .applied: proofResult = .applied
            case .scheduledOnly, .degraded: proofResult = .degraded
            }
            lastDeviceApplicationProof = try store.proofOrCreate(
                challenge: proofChallenge, result: proofResult,
                dsk: dependencies.proofProvider, now: applicationTime
            )
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

    /// Replays the exact durable signed request after response loss. This does
    /// not regenerate the ECDSA signature and the backend enforces its
    /// 14-day idempotency/conflict window.
    public func submitDeviceApplicationProof(challengeId: String, now: Date? = nil) async throws
        -> PCADevicePolicyApplicationProofResponse {
        guard let store = dependencies.applicationProofStore,
              let client = dependencies.activationClient,
              let proof = try store.proof(challengeId: challengeId, now: now ?? self.now()) else {
            throw PCAAPIError.unavailable
        }
        let session = pairedBootstrapSessions[challengeId]
        do {
            let response = try await client.submit(proof, session: session)
            pairedBootstrapSessions.removeValue(forKey: challengeId)
            return response
        }
        catch let error as PCAAPIError {
            let outcomeMayBeUnknown: Bool
            switch error {
            case .malformedResponse, .rejected,
                 .transport(.network), .transport(.timeout), .transport(.invalidResponse),
                 .transport(.responseTooLarge): outcomeMayBeUnknown = true
            default: outcomeMayBeUnknown = false
            }
            guard outcomeMayBeUnknown else { throw error }
            do {
                let response = try await client.recoverExactProof(proof, session: session)
                pairedBootstrapSessions.removeValue(forKey: challengeId)
                return response
            }
            catch let recoveryError as PCAAPIError where recoveryError == .unavailable {
                // A status miss means no durable commit was found. Re-submit
                // the exact stored request; the server handles a race with a
                // concurrent first commit idempotently.
                let response = try await client.submit(proof, session: session)
                pairedBootstrapSessions.removeValue(forKey: challengeId)
                return response
            }
        }
    }

    private func restoreEnrolledState() {
        // Foreground refresh must not replace a live, explicitly pending child
        // confirmation with an empty profile-store read.
        if pendingProfileEnrollmentAttempt != nil,
           case .awaitingChildConfirmation = profileRuntimeState {
            return
        }
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
        guard !Task.isCancelled else { return }
        guard authorization.permitsEnforcement else {
            applicationState = .authorizationRequired
            lastError = .authorization
            return
        }
        guard acquireEnrollmentAdmission() else { return }
        defer { releaseEnrollmentAdmission() }
        var submittedAttemptForFailure: PCAEnrollmentAttempt?
        var attemptForFailure: PCAEnrollmentAttempt?
        var activeAttempt: PCAEnrollmentAttempt?
        var recoveringFromPreflightFailure = false
        do {
            guard pendingDeviceId == nil, let link = linkRouter.pendingLink else { return }
            let storedAttempt = try dependencies.attemptStore.loadAttempt()
            let attempt: PCAEnrollmentAttempt
            let invitationTokenSHA256 = FirstDeviceCanonical.sha256Hex(link.rawInvitationToken)
            if let storedAttempt {
                if let boundDigest = storedAttempt.invitationTokenSHA256 {
                    // A restarted process resumes only from the exact invite
                    // bound to this attempt while its outcome is unresolved.
                    guard pcaOpaqueEqual(boundDigest, invitationTokenSHA256) else {
                        lastError = .recoverable
                        applicationState = .error(.recoverable)
                        return
                    }
                    guard storedAttempt.submissionState == .prepared else { return }
                    attempt = storedAttempt
                } else {
                    lastError = .recoverable
                    applicationState = .error(.recoverable)
                    return
                }
            } else {
                attempt = Self.makeEnrollmentAttempt(invitationTokenSHA256: invitationTokenSHA256)
                try dependencies.attemptStore.saveAttempt(attempt)
            }
            attemptForFailure = attempt
            activeAttempt = attempt
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
            let submittedAttempt = attempt.markingSubmitted()
            let response = try await dependencies.enrollmentClient.bootstrap(
                request,
                willRecoverFromPreflightFailure: { @MainActor [self] in
                    guard let currentlyActiveAttempt = activeAttempt,
                          try dependencies.attemptStore.loadAttempt() == currentlyActiveAttempt else {
                        throw PCAAPIError.invalidRequest
                    }
                    let recoveryAttempt = currentlyActiveAttempt.markingAwaitingInvitation()
                    try dependencies.attemptStore.saveAttempt(recoveryAttempt)
                    activeAttempt = recoveryAttempt
                    attemptForFailure = recoveryAttempt
                    recoveringFromPreflightFailure = true
                    localEnrollmentBootstrapNotYetSubmitted = false
                },
                didConfirmNoPreflightAttempt: { @MainActor [self] in
                    guard let currentlyActiveAttempt = activeAttempt,
                          try dependencies.attemptStore.loadAttempt() == currentlyActiveAttempt else {
                        throw PCAAPIError.invalidRequest
                    }
                    try dependencies.attemptStore.saveAttempt(attempt)
                    activeAttempt = attempt
                    attemptForFailure = attempt
                    recoveringFromPreflightFailure = false
                    localEnrollmentBootstrapNotYetSubmitted = true
                },
                willSubmit: { @MainActor [self] in
                    guard let currentlyActiveAttempt = activeAttempt,
                          try dependencies.attemptStore.loadAttempt() == currentlyActiveAttempt else {
                        throw PCAAPIError.invalidRequest
                    }
                    let submittedAttempt = currentlyActiveAttempt.markingSubmitted()
                    try dependencies.attemptStore.saveAttempt(submittedAttempt)
                    activeAttempt = submittedAttempt
                    attemptForFailure = submittedAttempt
                    submittedAttemptForFailure = submittedAttempt
                    localEnrollmentBootstrapNotYetSubmitted = false
                    if recoveringFromPreflightFailure {
                        // The recovery result is already authoritative for this
                        // exact attempt; consuming a still-pending matching link
                        // is cleanup, not a condition for accepting that result.
                        _ = linkRouter.takePendingLink(ifEqualTo: link)
                    } else {
                        guard linkRouter.takePendingLink(ifEqualTo: link) else {
                            try dependencies.attemptStore.saveAttempt(currentlyActiveAttempt)
                            activeAttempt = currentlyActiveAttempt
                            attemptForFailure = currentlyActiveAttempt
                            submittedAttemptForFailure = nil
                            localEnrollmentBootstrapNotYetSubmitted = true
                            throw PCAAPIError.invalidRequest
                        }
                    }
                }
            )
            try Task.checkCancellation()
            guard stillOwnsEnrollmentAttempt(submittedAttempt) else { return }
            // Wave 6D seed capture: durably record the ceremony credentials
            // and the M1-minted key ids NOW (before any later clear), so a
            // process death can never strand a committed-capable device
            // with no way to reach its own first-device ceremony.
            guard captureFirstDeviceSeed(attempt: submittedAttempt, response: response) else {
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return
            }
            publishFirstDeviceRootRecord()
            pendingDeviceId = response.deviceId
            pendingProfileEnrollmentAttempt = submittedAttempt
            dependencies.deviceIdentityStore.saveDeviceId(response.deviceId)
            cleanupConfirmedEnrollmentKeys(attempt: submittedAttempt)
            let profile = PCAEnrollmentProfile(childProfileId: response.childProfileId, ageUxTier: response.ageUxTier, initialPolicyProfile: response.initialPolicyProfile)
            profileRuntimeState = .awaitingChildConfirmation(profile, PCAEnrollmentDisclosure.forProfile(profile))
            pendingDisclosure = PCAEnrollmentDisclosure.forProfile(profile)
            applicationState = .enrollmentInProgress
        } catch is CancellationError {
            // A cancelled POST may still have reached the server. Keep the
            // persisted attempt and keys for its existing recovery endpoint.
            lastError = .recoverable
            applicationState = .error(.recoverable)
        } catch let error as PCAAPIError {
            if error == .attemptAbandoned,
               let abandonedAttempt = submittedAttemptForFailure ?? attemptForFailure {
                _ = clearAbandonedEnrollmentAttempt(abandonedAttempt)
                return
            }
            if error == .preparationRejected,
               let preparedAttempt = attemptForFailure,
               (try? dependencies.attemptStore.loadAttempt()) == preparedAttempt,
               preparedAttempt.submissionState == .prepared {
                // Recovery proved no reservation exists, and this durable
                // phase proves bootstrap was never sent. Releasing only this
                // exact prepared attempt permits a different invitation.
                _ = clearAbandonedEnrollmentAttempt(preparedAttempt)
                return
            }
            if error == .unavailable,
               let submittedAttempt = submittedAttemptForFailure {
                guard stillOwnsEnrollmentAttempt(submittedAttempt) else { return }
                // A generic 404 may race an uncommitted bootstrap transaction.
                // Keep the invitation digest and recovery credentials bound;
                // it cannot authorize a different invitation for this attempt.
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return
            }
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

    /// Clears only a server-resolved abandoned attempt after its exact durable
    /// record is removed. Alias deletion is gated by a confirmed root record
    /// (or a confirmed empty root store), so unreadable root custody is kept.
    private func clearAbandonedEnrollmentAttempt(_ attempt: PCAEnrollmentAttempt) -> Bool {
        guard stillOwnsEnrollmentAttempt(attempt) else { return false }
        do {
            guard try dependencies.attemptStore.clearAttempt(ifCurrent: attempt) else {
                _ = stillOwnsEnrollmentAttempt(attempt)
                return false
            }
        } catch {
            lastError = .recoverable
            applicationState = .error(.recoverable)
            return false
        }
        cleanupAbandonedEnrollmentKeys(attempt: attempt)
        if let pending = linkRouter.pendingLink,
           let digest = attempt.invitationTokenSHA256,
           pcaOpaqueEqual(FirstDeviceCanonical.sha256Hex(pending.rawInvitationToken), digest) {
            _ = linkRouter.takePendingLink(ifEqualTo: pending)
        }
        pendingProfileEnrollmentAttempt = nil
        pendingDisclosure = nil
        profileRuntimeState = .awaitingProfile
        lastError = nil
        applicationState = .notEnrolled
        return true
    }

    private func cleanupAbandonedEnrollmentKeys(attempt: PCAEnrollmentAttempt) {
        let releaseAndDeleteExactAttemptKeys = {
            self.dependencies.enrollmentKeys?.abandonPreparedEnrollmentKeys(attemptId: attempt.attemptId)
            self.dependencies.keyDeletion?.deleteKeyPair(alias: "pca.dsk." + attempt.attemptId)
            self.dependencies.keyDeletion?.deleteKeyPair(alias: "pca.dek." + attempt.attemptId)
        }
        guard let rootStore = dependencies.firstDeviceRootStore else {
            releaseAndDeleteExactAttemptKeys()
            return
        }
        if rootStore.withConfirmedCurrentRecord({ retained in
            if !pcaOpaqueEqual(retained.seed.attemptId, attempt.attemptId) {
                releaseAndDeleteExactAttemptKeys()
            }
        }) {
            return
        }
        _ = rootStore.withConfirmedNoCurrentRecord(releaseAndDeleteExactAttemptKeys)
    }

    private func resumeEnrollmentIfPossible() async {
        guard !Task.isCancelled else { return }
        guard authorization.permitsEnforcement,
               !localEnrollmentBootstrapNotYetSubmitted,
               pendingProfileEnrollmentAttempt == nil,
               acquireEnrollmentAdmission() else { return }
        defer { releaseEnrollmentAdmission() }
        let attempt: PCAEnrollmentAttempt
        do {
            guard let stored = try dependencies.attemptStore.loadAttempt() else { return }
            guard stored.submissionState == .submitted || stored.submissionState == .awaitingInvitation else {
                if stored.submissionState == .prepared {
                    applicationState = .notEnrolled
                    lastError = nil
                } else {
                    applicationState = .error(.recoverable)
                    lastError = .recoverable
                }
                return
            }
            attempt = stored
        } catch {
            lastError = .recoverable
            applicationState = .error(.recoverable)
            return
        }
        applicationState = .recovering
        let retainedDeviceId = pendingDeviceId
        do {
            let response = try await dependencies.enrollmentClient.recover(
                attemptId: attempt.attemptId,
                attemptRecoveryToken: attempt.attemptRecoveryToken
            )
            try Task.checkCancellation()
            guard stillOwnsEnrollmentAttempt(attempt) else { return }
            if let retainedDeviceId,
               !pcaOpaqueEqual(response.deviceId, retainedDeviceId) {
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return
            }
            let previouslyConfirmedProfile: Bool
            switch profileRuntimeState {
            case .ready, .authorizationRequired:
                previouslyConfirmedProfile = retainedDeviceId != nil
            case .awaitingProfile, .awaitingChildConfirmation:
                previouslyConfirmedProfile = false
            case .profilePersistenceFailed:
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return
            }
            // Wave 6D: the recovery path restores the SAME ceremony seed the
            // original bootstrap would have captured (idempotent capture).
            if let preparation = dependencies.enrollmentKeys {
                do {
                    try preparation.prepareEnrollmentKeys(attemptId: attempt.attemptId)
                } catch {
                    // A recovered server response is not usable local
                    // enrollment authority until this exact attempt's keys
                    // are readable again. Keep the submitted attempt for a
                    // later recovery retry; do not capture the seed or show
                    // the recovered profile without its key custody.
                    lastError = .securityGate
                    applicationState = .enrollmentBlockedBySecurityGate
                    return
                }
            }
            guard captureFirstDeviceSeed(attempt: attempt, response: response) else {
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return
            }
            if let pendingLink = linkRouter.pendingLink,
               pcaOpaqueEqual(FirstDeviceCanonical.sha256Hex(pendingLink.rawInvitationToken), attempt.invitationTokenSHA256) {
                _ = linkRouter.takePendingLink(ifEqualTo: pendingLink)
            }
            publishFirstDeviceRootRecord()
            pendingDeviceId = response.deviceId
            if retainedDeviceId == nil {
                dependencies.deviceIdentityStore.saveDeviceId(response.deviceId)
            }
            cleanupConfirmedEnrollmentKeys(attempt: attempt)
            if previouslyConfirmedProfile {
                do {
                    guard try dependencies.attemptStore.clearAttempt(ifCurrent: attempt) else {
                        _ = stillOwnsEnrollmentAttempt(attempt)
                        return
                    }
                } catch {
                    lastError = .recoverable
                    applicationState = .error(.recoverable)
                    return
                }
                pendingProfileEnrollmentAttempt = nil
                lastError = nil
                applicationState = stateForCurrentData()
                return
            }
            pendingProfileEnrollmentAttempt = attempt
            let profile = PCAEnrollmentProfile(
                childProfileId: response.childProfileId,
                ageUxTier: response.ageUxTier,
                initialPolicyProfile: response.initialPolicyProfile
            )
            profileRuntimeState = .awaitingChildConfirmation(profile, PCAEnrollmentDisclosure.forProfile(profile))
            pendingDisclosure = PCAEnrollmentDisclosure.forProfile(profile)
            applicationState = .enrollmentInProgress
        } catch is CancellationError {
            lastError = .recoverable
            applicationState = .error(.recoverable)
        } catch let error as PCAAPIError {
            if error == .attemptAbandoned {
                _ = clearAbandonedEnrollmentAttempt(attempt)
                return
            }
            if error == .unavailable {
                guard stillOwnsEnrollmentAttempt(attempt) else { return }
                // A recovery 404 cannot prove the prior bootstrap transaction
                // is finished; preserve its invitation binding for later recovery.
                lastError = .recoverable
                applicationState = .error(.recoverable)
                return
            }
            lastError = Self.category(for: error)
            applicationState = Self.state(for: error)
        } catch {
            lastError = .recoverable
            applicationState = .error(.recoverable)
        }
    }

    private static func makeEnrollmentAttempt(invitationTokenSHA256: String) -> PCAEnrollmentAttempt {
        PCAEnrollmentAttempt(
            attemptId: UUID().uuidString.replacingOccurrences(of: "-", with: ""),
            attemptRecoveryToken: UUID().uuidString + UUID().uuidString,
            submissionState: .prepared,
            invitationTokenSHA256: invitationTokenSHA256
        )
    }

    @MainActor func establishSessionIfNeeded() async {
        guard !sessionEstablishmentInProgress, !Task.isCancelled else { return }
        sessionEstablishmentInProgress = true
        defer { sessionEstablishmentInProgress = false }
        guard let deviceId = pendingDeviceId, let sessionClient = dependencies.sessionClient else { return }
        let priorSession: PCADeviceSession?
        do { priorSession = try dependencies.sessionStore.loadSession() }
        catch { lastError = .recoverable; return }
        if let existing = priorSession,
           pcaOpaqueEqual(existing.deviceId, deviceId),
           existing.expiresAt > now() {
            return
        }
        guard !dependencies.proofProvider.signingPublicKey.isEmpty else {
            applicationState = .enrollmentBlockedBySecurityGate
            lastError = .securityGate
            return
        }
        applicationState = .recovering
        let capturedRoot = dependencies.firstDeviceRootStore?.current()
        do {
            try Task.checkCancellation()
            if dependencies.firstDeviceRootStore != nil {
                guard let capturedRoot, capturedRoot.state == .rootCommitted,
                      pcaOpaqueEqual(capturedRoot.seed.deviceId, deviceId) else { throw PCADeviceProofError.secureKeyUnavailable }
            }
            try dependencies.assertRuntimeKeyCustody(deviceId)
            let response = try await sessionClient.establishSession(deviceId: deviceId, assertContinuity: {
                try Task.checkCancellation()
                guard pcaOpaqueEqual(self.pendingDeviceId, deviceId),
                      self.dependencies.firstDeviceRootStore?.current() == capturedRoot,
                      try self.dependencies.sessionStore.loadSession() == priorSession else { throw PCADeviceProofError.secureKeyUnavailable }
                try self.dependencies.assertRuntimeKeyCustody(deviceId)
            })
            try Task.checkCancellation()
            guard pcaOpaqueEqual(pendingDeviceId, deviceId),
                  dependencies.firstDeviceRootStore?.current() == capturedRoot else { throw PCADeviceProofError.secureKeyUnavailable }
            // A completion cannot overwrite a session published by another caller.
            guard try dependencies.sessionStore.loadSession() == priorSession else { return }
            try dependencies.assertRuntimeKeyCustody(deviceId)
            let session = PCADeviceSession(deviceId: deviceId, sessionToken: response.sessionToken, expiresAt: response.expiresAt)
            try dependencies.sessionStore.saveSession(session)
            await reportProtectionStatusIfPossible(session: session)
            try Task.checkCancellation()
            guard pcaOpaqueEqual(pendingDeviceId, deviceId), dependencies.firstDeviceRootStore?.current() == capturedRoot,
                  try dependencies.sessionStore.loadSession() == session else { return }
            try dependencies.assertRuntimeKeyCustody(deviceId)
            applicationState = stateForCurrentData()
        } catch is CancellationError {
            return
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
        do { _ = try await synchronizeRuntimeCampaign() }
        catch is CancellationError { syncConnectionState = .stale }
        catch { syncConnectionState = .stale }
    }

    /// Submits an already-authorized next epoch through the durable, device-
    /// signed coordinator. Candidate creation remains with the product flow;
    /// this boundary never accepts Parent/browser credentials or raw keys.
    @MainActor public func submitOrdinaryTrustSetEpoch(_ candidate: UntrustedTrustSetEpoch) async throws -> OrdinaryTrustSetSubmissionResult {
        guard let rootStore = dependencies.firstDeviceRootStore,
              let root = rootStore.current(), root.state == .rootCommitted,
              let familyId = root.familyId,
              let session = try dependencies.sessionStore.loadSession(),
              session.expiresAt > now(),
              pcaOpaqueEqual(session.deviceId, root.seed.deviceId),
              pcaOpaqueEqual(candidate.familyId, familyId),
              rootStore.confirmDurable(root) else {
            throw PCADeviceProofError.secureKeyUnavailable
        }
        guard let coordinator = try ordinaryTrustSetRuntimeManagerIfAvailable() else {
            throw PCADeviceProofError.secureKeyUnavailable
        }
        do {
            let resumed = try await coordinator.resumePending()
            // A server-authoritative rejection is terminal for this exact
            // persisted request. Reconcile the current accepted head, but do
            // not discard the rejection and continue as if no request existed.
            // The caller must surface it and obtain a fresh candidate from the
            // current accepted floor before another attempt can be signed.
            guard try await coordinator.catchUp(maximumRecords: 32) else { throw OrdinaryTrustSetError.staleCandidate }
            try dependencies.assertRuntimeKeyCustody(session.deviceId)
            guard rootStore.current() == root, rootStore.confirmDurable(root),
                  try dependencies.sessionStore.loadSession() == session else {
                throw PCADeviceProofError.secureKeyUnavailable
            }
            if case .rejected? = resumed { return .rejected }
            return try await coordinator.prepareAndSubmit(candidate)
        } catch let error as PCAAPIError {
            switch error {
            case .unauthorized:
                if (try? dependencies.sessionStore.clearSession(ifCurrent: session)) == true {
                    syncConnectionState = .stale
                    applicationState = .recovering
                }
            case .forbidden:
                if (try? dependencies.sessionStore.loadSession()) == session {
                    syncConnectionState = .stale
                    applicationState = .error(.authorization)
                }
            default: break
            }
            throw error
        }
    }

    private func ordinaryTrustSetRuntimeManagerIfAvailable() throws -> OrdinaryTrustSetRuntimeManaging? {
        if let resolvedOrdinaryTrustSetCoordinator { return resolvedOrdinaryTrustSetCoordinator }
        guard let rootStore = dependencies.firstDeviceRootStore,
              rootStore.current()?.state == .rootCommitted,
              let factory = dependencies.ordinaryTrustSetCoordinatorFactory else { return nil }
        let coordinator = try factory()
        resolvedOrdinaryTrustSetCoordinator = coordinator
        return coordinator
    }

    /// Existing-session-only transport campaign, shared with OS background recovery.
    /// No enrollment, authentication creation, permission prompt or crypto application.
    @MainActor func synchronizeRuntimeCampaign() async throws -> PCARuntimeCustodyOutcome {
        try Task.checkCancellation()
        guard !runtimeSyncInProgress else { return .retryableFailure }
        runtimeSyncInProgress = true
        defer { runtimeSyncInProgress = false }
        guard let runtimeSyncClient = dependencies.runtimeSyncClient,
              let inbox = dependencies.inboundInbox else {
            syncConnectionState = .stale
            return .blocked
        }
        let retainedSession: PCADeviceSession?
        do { retainedSession = try dependencies.sessionStore.loadSession() }
        catch {
            // Locked or corrupt Keychain state is retained; it is not missing enrollment.
            syncConnectionState = .stale
            return .blocked
        }
        guard let session = retainedSession,
              session.expiresAt > now() else {
            syncConnectionState = .stale
            return .ineligible
        }
        guard let rootStore = dependencies.firstDeviceRootStore,
              let capturedRoot = rootStore.current(), capturedRoot.state == .rootCommitted,
              pcaOpaqueEqual(capturedRoot.seed.deviceId, session.deviceId),
              let expectedFamilyId = capturedRoot.familyId, !expectedFamilyId.isEmpty else {
            syncConnectionState = .stale
            return .blocked
        }
        // Background refreshes may run without a SwiftUI scene becoming
        // active. Reconcile only the already committed local generation so a
        // wake can restore a missed edge or OS-cleared ManagedSettings state;
        // failure degrades reporting but does not discard durable inbox work.
        reconcileInstalledProtectionPolicy(now: now())
        let incarnation: String
        #if canImport(CryptoKit)
        incarnation = SHA256.hash(data: Data(session.sessionToken.utf8)).map { String(format: "%02x", $0) }.joined()
        #else
        return .blocked
        #endif
        let started = ProcessInfo.processInfo.systemUptime
        var ackCount = 0
        var safeZoneDeliveryPending = false
        func assertContinuity() throws {
            try Task.checkCancellation()
            guard try dependencies.sessionStore.loadSession() == session, session.expiresAt > now() else { throw PCAAPIError.unauthorized }
            guard rootStore.current() == capturedRoot else { throw PCADeviceProofError.secureKeyUnavailable }
            try dependencies.assertRuntimeKeyCustody(session.deviceId)
        }
        func validateScope(_ scope: PCAInboundScope) throws {
            guard pcaOpaqueEqual(scope.recipientDeviceId, session.deviceId),
                  pcaOpaqueEqual(scope.familyId, expectedFamilyId) else { throw PCAInboundInboxError.unavailable }
        }
        func acknowledgeStored(_ scope: PCAInboundScope) async throws -> Bool {
            try validateScope(scope)
            try assertContinuity()
            for record in try inbox.pendingAcknowledgements(scope: scope) {
                try assertContinuity()
                guard ackCount < 100, ProcessInfo.processInfo.systemUptime - started < 30 else { return false }
                try await runtimeSyncClient.acknowledge(messageId: record.envelope.messageId, session: session)
                try assertContinuity()
                try inbox.markAcknowledged(record.envelope, scope: scope)
                ackCount += 1
            }
            return true
        }
        func consumeStored(_ scope: PCAInboundScope) async throws {
            try validateScope(scope)
            try assertContinuity()
            guard let consumer = dependencies.inboundConsumer else { return }
            guard ProcessInfo.processInfo.systemUptime - started < 30 else { return }
            guard let trustSet = try ordinaryTrustSetRuntimeManagerIfAvailable(),
                  try await trustSet.catchUp(maximumRecords: 32) else {
                throw PCAInboundInboxError.unavailable
            }
            try assertContinuity()
            _ = try await consumer.consume(try inbox.pendingCrypto(scope: scope), scope: scope,
                now: { self.now() }, assertAuthority: {
                    try assertContinuity()
                    guard ProcessInfo.processInfo.systemUptime - started < 30 else { throw PCAInboundInboxError.unavailable }
                })
            try assertContinuity()
        }
        func acknowledgeCustodyThenConsume(_ scope: PCAInboundScope) async throws -> Bool {
            let acknowledgementComplete: Bool
            do { acknowledgementComplete = try await acknowledgeStored(scope) }
            catch {
                let acknowledgementError = error
                // Durable local work remains useful while the relay is
                // unavailable. Preserve the prior recovery behavior, then
                // surface the transport/authority failure for retry.
                try await consumeStored(scope)
                throw acknowledgementError
            }
            // Application readiness is independent of the transport custody
            // ACK. The exact ciphertext was persisted and read back before
            // acknowledgeStored can run.
            try await consumeStored(scope)
            return acknowledgementComplete
        }
        syncConnectionState = .syncing
        do {
            try assertContinuity()
            if let trustSet = try ordinaryTrustSetRuntimeManagerIfAvailable() {
                _ = try await trustSet.resumePending()
                try assertContinuity()
                guard try await trustSet.catchUp(maximumRecords: 32) else { throw PCAInboundInboxError.unavailable }
                try assertContinuity()
            }
            if let safeZoneClient = dependencies.safeZoneDeliveryClient,
               let safeZoneInbox = dependencies.safeZoneDeliveryInbox {
                let scope = PCADeviceSafeZoneDeliveryScope(familyId: expectedFamilyId, deviceId: session.deviceId)
                do {
                    safeZoneDeliveryPending = !(try await safeZoneClient.synchronize(
                        scope: scope,
                        inbox: safeZoneInbox,
                        absoluteMonotonicDeadline: started + 30
                    ))
                } catch {
                    guard isRetryableOptionalSafeZoneDeliveryFailure(error) else { throw error }
                    safeZoneDeliveryPending = true
                }
                try assertContinuity()
            } else if dependencies.safeZoneDeliveryClient != nil || dependencies.safeZoneDeliveryInbox != nil {
                // A partially wired optional subsystem cannot complete delivery.
                // Keep overall runtime sync pending while unrelated work proceeds.
                safeZoneDeliveryPending = true
            }
            var cursor = try inbox.navigation(sessionIncarnation: incarnation)?.nextCursor
            var resetRejectedCursor = false
            if let scope = try inbox.retainedScope() {
                guard try await acknowledgeCustodyThenConsume(scope) else {
                    syncConnectionState = .syncPending
                    return .morePending
                }
            }
            for _ in 0..<4 {
                try assertContinuity()
                guard ProcessInfo.processInfo.systemUptime - started < 30 else {
                    syncConnectionState = .syncPending
                    return .morePending
                }
                let response: PCAInboundRuntimeSyncResponse
                do { response = try await runtimeSyncClient.pull(session: session, cursor: cursor) }
                catch PCAInboundNavigationError.invalidCursor {
                    try assertContinuity()
                    guard let rejected = cursor, !resetRejectedCursor else { throw PCAInboundInboxError.unavailable }
                    try inbox.resetRejectedNavigation(sessionIncarnation: incarnation, cursor: rejected)
                    cursor = nil; resetRejectedCursor = true
                    continue
                }
                try assertContinuity()
                try validateScope(response.scope)
                try inbox.capture(response, sessionDeviceId: session.deviceId, sessionIncarnation: incarnation, requestedCursor: cursor)
                guard try await acknowledgeCustodyThenConsume(response.scope) else {
                    syncConnectionState = .syncPending
                    return .morePending
                }
                if let navigation = response.navigation, navigation.hasMore {
                    guard let next = navigation.nextCursor, next != cursor else { throw PCAInboundInboxError.unavailable }
                    cursor = next
                    continue
                }
                try assertContinuity()
                let retainedCrypto = try inbox.pendingCrypto(scope: response.scope)
                let pendingCrypto = try dependencies.inboundConsumer?.pending(retainedCrypto, scope: response.scope) ?? retainedCrypto
                let unresolved = try inbox.hasUnresolvedRelayWork()
                syncConnectionState = SyncConnectionStateComputer.compute(SyncConnectionStateInput(
                    isTransportConnected: true,
                    isSyncing: false,
                    hasPendingLocalWork: !pendingCrypto.isEmpty || response.hasMore || unresolved || safeZoneDeliveryPending ||
                        !response.unparseableMessageIds.isEmpty || !response.droppedForListBound.isEmpty,
                    lastSuccessfulSyncAtUtc: now(),
                    nowUtc: now(),
                    staleThresholdSeconds: 24 * 60 * 60
                ))
                if !pendingCrypto.isEmpty {
                    dependencies.protectionRuntime.recordPolicyApplication(.degraded)
                    applicationState = stateForCurrentData()
                }
                if ProcessInfo.processInfo.systemUptime - started < 30 {
                    try assertContinuity()
                    let statusError = await reportProtectionStatusIfPossible(session: session)
                    try assertContinuity()
                    if let statusError, statusError == .unauthorized || statusError == .forbidden {
                        throw statusError
                    }
                    if let statusError {
                        switch statusError {
                        case .rejected, .unavailable, .transport(.network), .transport(.timeout):
                            // This endpoint is an idempotent projection of the
                            // current local protection state. A failed POST is
                            // recoverable by reporting that current state on
                            // the next sync, including after process restart.
                            // Keep this campaign pending instead of presenting
                            // a successful sync while the projection is stale.
                            syncConnectionState = .syncPending
                            return .morePending
                        default:
                            syncConnectionState = .stale
                            return .blocked
                        }
                    }
                }
                if safeZoneDeliveryPending {
                    syncConnectionState = .syncPending
                    return .morePending
                }
                return .complete
            }
            syncConnectionState = .syncPending
            return .morePending
        } catch is CancellationError {
            syncConnectionState = .stale
            throw CancellationError()
        } catch let error as PCAAPIError {
            if error == .unauthorized {
                if (try? dependencies.sessionStore.clearSession(ifCurrent: session)) == true {
                    syncConnectionState = .stale
                    applicationState = .recovering
                }
                return .retryableFailure
            }
            syncConnectionState = error == .forbidden ? .stale : .offline
            if error == .forbidden {
                applicationState = .error(.authorization)
                return .blocked
            }
            applicationState = .offline
            switch error {
            case .rejected, .unavailable, .transport(.network), .transport(.timeout): return .retryableFailure
            default: return .blocked
            }
        } catch is PCADeviceProofError {
            syncConnectionState = .stale
            applicationState = .enrollmentBlockedBySecurityGate
            lastError = .securityGate
            return .blocked
        } catch {
            syncConnectionState = .stale
            return .blocked
        }
    }

    private func reportProtectionStatusIfPossible(session suppliedSession: PCADeviceSession? = nil) async -> PCAAPIError? {
        guard let runtimeSyncClient = dependencies.runtimeSyncClient,
              let session = suppliedSession ?? (try? dependencies.sessionStore.loadSession()),
              session.expiresAt > now() else { return nil }
        do {
            try await runtimeSyncClient.reportProtectionStatus(dependencies.protectionRuntime.status, session: session)
            return nil
        } catch let error as PCAAPIError {
            switch error {
            case .unauthorized:
                if (try? dependencies.sessionStore.clearSession(ifCurrent: session)) == true {
                    syncConnectionState = .stale
                    applicationState = .recovering
                }
            case .forbidden:
                if (try? dependencies.sessionStore.loadSession()) == session {
                    syncConnectionState = .stale
                    applicationState = .error(.authorization)
                }
            default: break
            }
            return error
        } catch {
            return nil
        }
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
        case .forbidden: return .authorization
        case .transport(.timeout), .transport(.network), .unavailable: return .network
        case .malformedResponse: return .permanent
        case .invalidRequest, .rejected, .transport(_), .attemptAbandoned, .preparationRejected, .enrollmentOutcomeUnknown: return .recoverable
        }
    }

    private static func state(for error: PCAAPIError) -> PCAApplicationState {
        switch error {
        case .transport(.timeout), .transport(.network), .unavailable: return .offline
        case .unauthorized: return .recovering
        case .forbidden: return .error(.authorization)
        case .invalidConfiguration: return .error(.configuration)
        case .malformedResponse: return .error(.permanent)
        case .invalidRequest, .rejected, .transport(_), .attemptAbandoned, .preparationRejected, .enrollmentOutcomeUnknown: return .error(.recoverable)
        }
    }
}

public enum PCAProductionCompositionRoot {
    public static let productionAPIBaseURL = URL(string: "https://api.pcasafe.com")!

    @MainActor
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
            persistedAttemptId: { firstDeviceRootStore.current()?.seed.attemptId },
            persistedAttemptMayBeReplaced: { attemptId in
                guard let root = firstDeviceRootStore.current(),
                      pcaOpaqueEqual(root.seed.attemptId, attemptId) else { return false }
                return root.state == .expired || root.state == .rejected
            }
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
        let ordinaryTrustSetCoordinator: OrdinaryTrustSetRuntimeManaging?
        let ordinaryTrustSetCoordinatorFactory: (() throws -> OrdinaryTrustSetRuntimeManaging)?
        #if canImport(Security) && canImport(CryptoKit)
        let coordinatorFactory: () throws -> OrdinaryTrustSetRuntimeManaging = {
            try OrdinaryTrustSetBootstrapAnchor.makeCoordinator(
                rootStore: firstDeviceRootStore,
                keychain: keychain,
                keyMaterial: secureEnclaveProvider,
                sessionStore: stateStore,
                baseURL: productionAPIBaseURL
            )
        }
        ordinaryTrustSetCoordinatorFactory = coordinatorFactory
        ordinaryTrustSetCoordinator = firstDeviceRootStore.current()?.state == .rootCommitted
            ? try? coordinatorFactory() : nil
        #else
        ordinaryTrustSetCoordinator = nil
        ordinaryTrustSetCoordinatorFactory = nil
        #endif
        let sessionClient = try! PCADeviceSessionClient(baseURL: productionAPIBaseURL, transport: transport, proof: deviceProofProvider)
        let runtimeSyncClient = try! PCADeviceRuntimeSyncClient(baseURL: productionAPIBaseURL, transport: transport)
        let activationClient = try? PCADevicePolicyActivationClient(baseURL: productionAPIBaseURL, transport: transport)
        #if canImport(Security) && canImport(CryptoKit)
        let safeZoneDeliveryInbox: PCAKeychainSafeZoneDeliveryInbox? = PCAKeychainSafeZoneDeliveryInbox(
            keychain: keychain,
            serviceNamespace: "org.pca.app",
            scopeProvider: {
                guard let root = firstDeviceRootStore.current(), root.state == .rootCommitted,
                      let familyId = root.familyId else { return nil }
                return PCADeviceSafeZoneDeliveryScope(familyId: familyId, deviceId: root.seed.deviceId)
            }
        )
        let safeZoneDeliveryClient: PCADeviceSafeZoneDeliveryClient? = try? PCADeviceSafeZoneDeliveryClient(
            baseURL: productionAPIBaseURL,
            currentSession: { try stateStore.loadSession() },
            now: Date.init
        )
        #else
        let safeZoneDeliveryInbox: PCAKeychainSafeZoneDeliveryInbox? = nil
        let safeZoneDeliveryClient: PCADeviceSafeZoneDeliveryClient? = nil
        #endif
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
            safeZoneDeliveryClient: safeZoneDeliveryClient,
            safeZoneDeliveryInbox: safeZoneDeliveryInbox,
            assertRuntimeKeyCustody: { deviceId in
                guard let root = firstDeviceRootStore.current(), root.state == .rootCommitted,
                      pcaOpaqueEqual(root.seed.deviceId, deviceId), deviceProofProvider.signingPublicKey == root.seed.dskPublicKeyBase64 else {
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
            ordinaryTrustSetCoordinator: ordinaryTrustSetCoordinator,
            ordinaryTrustSetCoordinatorFactory: ordinaryTrustSetCoordinatorFactory,
            policyRuntime: policyRuntime,
            applicationProofStore: PCADeviceApplicationProofStore(keychain: keychain, serviceNamespace: "org.pca.app"),
            // No approved iOS envelope verifier/decryptor exists in this
            // checkout. Keep this nil so no PAIRED policy can become APPLIED
            // until the real receiver crypto implementation is integrated.
            policyEnvelopeProcessor: nil,
            activationClient: activationClient,
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
