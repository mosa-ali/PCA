import Foundation
#if canImport(SwiftUI)
import SwiftUI
#endif

/// Controlled child-side contract for the backend bootstrap profile. The child
/// receives only the opaque profile reference and allowlisted defaults; no
/// display name or family activity is part of this value.
public enum PCAAgeUxTier: String, Codable {
    case youngChild = "YOUNG_CHILD"
    case teen = "TEEN"
}

public enum PCAInitialPolicyProfile: String, Codable {
    case balanced = "BALANCED"
    case strict = "STRICT"
}

public struct PCAEnrollmentProfile: Codable, Equatable {
    public let childProfileId: String?
    public let ageUxTier: PCAAgeUxTier
    public let initialPolicyProfile: PCAInitialPolicyProfile

    public init(childProfileId: String?, ageUxTier: PCAAgeUxTier, initialPolicyProfile: PCAInitialPolicyProfile) {
        self.childProfileId = childProfileId
        self.ageUxTier = ageUxTier
        self.initialPolicyProfile = initialPolicyProfile
    }
}

/// PCA-FR-008 / PCA-FR-133: the only age/profile-dependent values that this enrollment slice may
/// choose locally. The signed family policy remains authoritative after
/// enrollment; these are bounded starting defaults, not a second policy
/// authority.
public enum PCAContentFilterDefault: String, Codable, Equatable {
    case moderate = "MODERATE"
    case strict = "STRICT"
}

public struct PCAEnrollmentRuntimeDefaults: Codable, Equatable {
    public let contentFilterDefault: PCAContentFilterDefault
    public let activeUseThresholdMinutes: Int
    public let breakDurationMinutes: Int

    public init(
        contentFilterDefault: PCAContentFilterDefault,
        activeUseThresholdMinutes: Int,
        breakDurationMinutes: Int
    ) {
        self.contentFilterDefault = contentFilterDefault
        self.activeUseThresholdMinutes = activeUseThresholdMinutes
        self.breakDurationMinutes = breakDurationMinutes
    }
}

/// Child-facing copy is selected from the parent-authorized profile, never
/// from a child-editable control. The reading-level label is a source-level
/// accessibility contract; final English/Arabic language review remains a
/// release gate owned by the localization lane.
public enum PCAChildReadingLevel: String, Codable, Equatable {
    case simple
    case clear
}

/// Plain-language enrollment disclosure for the child-facing confirmation
/// step (PCA-FR-008 / PCA-NFR-044 / PCA-FR-121). The privacy and emergency
/// fields are intentionally identical for every age tier: age changes
/// defaults and wording length, never the E2EE/privacy boundary.
public struct PCAEnrollmentDisclosure: Codable, Equatable {
    public let readingLevel: PCAChildReadingLevel
    public let title: String
    public let summary: String
    public let selectedAgeLabel: String
    public let startingSafetyLabel: String
    public let monitoredSummary: String
    public let notMonitoredSummary: String
    public let emergencySummary: String
    public let authorizationSummary: String
    public let confirmLabel: String
    public let parentSelectedProfile: Bool

    public static func forProfile(_ profile: PCAEnrollmentProfile) -> PCAEnrollmentDisclosure {
        let youngChild = profile.ageUxTier == .youngChild
        let strict = profile.initialPolicyProfile == .strict

        return PCAEnrollmentDisclosure(
            readingLevel: youngChild ? .simple : .clear,
            title: youngChild ? "Check your safety settings" : "Review your safety settings",
            summary: "Your parent chose these starting settings for this device. Check them, then confirm to finish setup.",
            selectedAgeLabel: youngChild ? "Young child" : "Teen",
            startingSafetyLabel: strict ? "Stricter starting settings" : "Starting settings",
            monitoredSummary: "PCA may show your parent protection status, screen-time totals, selected app or website categories, and requests you send.",
            notMonitoredSummary: "PCA does not read your message or call content, save camera images, or keep a readable history of exact searches.",
            emergencySummary: "Emergency calling and emergency help remain available.",
            authorizationSummary: "Apple authorization is required before iOS protection controls can run.",
            confirmLabel: "Confirm these settings",
            parentSelectedProfile: true
        )
    }
}

/// Result of consuming a parent-authorized enrollment profile. Defaults may
/// be calculated before authorization is available, but callers must not
/// apply enforcement-dependent settings until the result is `.ready`.
public enum PCAEnrollmentProfileConsumption: Equatable {
    case ready(PCAEnrollmentRuntimeDefaults)
    case authorizationRequired(PCAEnrollmentRuntimeDefaults)
}

/// Maps the controlled enrollment profile into the small, privacy-neutral
/// default catalogue used by the iOS runtime. `childProfileId` is
/// deliberately not copied into the result: it is an opaque bootstrap
/// correlation value, not runtime policy data.
public struct PCAEnrollmentProfileConsumer {
    public init() {}

    public func disclosure(for profile: PCAEnrollmentProfile) -> PCAEnrollmentDisclosure {
        PCAEnrollmentDisclosure.forProfile(profile)
    }

    public func defaults(for profile: PCAEnrollmentProfile) -> PCAEnrollmentRuntimeDefaults {
        let isStrict = profile.ageUxTier == .youngChild || profile.initialPolicyProfile == .strict
        return PCAEnrollmentRuntimeDefaults(
            contentFilterDefault: isStrict ? .strict : .moderate,
            activeUseThresholdMinutes: isStrict ? 45 : 60,
            breakDurationMinutes: 30
        )
    }

    public func consume(
        _ profile: PCAEnrollmentProfile,
        authorization: ChildAuthorizationState
    ) -> PCAEnrollmentProfileConsumption {
        let defaults = defaults(for: profile)
        guard authorization.permitsEnforcement else {
            return .authorizationRequired(defaults)
        }
        return .ready(defaults)
    }
}

/// Universal Link/custom-scheme continuation accepted by the iOS enrollment
/// entry point. Only the canonical opaque invitation token is extracted;
/// family, child, role, policy, and recovery material never come from the
/// link. The bootstrap service remains the authority for those values.
public struct PCAEnrollmentLink: Equatable {
    public let serverBaseURL: URL
    public let rawInvitationToken: String

    public init(serverBaseURL: URL, rawInvitationToken: String) {
        self.serverBaseURL = serverBaseURL
        self.rawInvitationToken = rawInvitationToken
    }
}

public struct PCAEnrollmentLinkParser {
    public static let customScheme = "pca"
    public static let customHost = "enroll"
    public static let universalLinkScheme = "https"
    public static let universalLinkHost = "enroll.pca.app"
    private static let tokenLength = 43

    public init() {}

    public func parse(_ url: URL) -> PCAEnrollmentLink? {
        guard url.fragment == nil else { return nil }
        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()

        if scheme == Self.customScheme && host == Self.customHost {
            guard url.path.isEmpty,
                  let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
                  let token = queryItems.first(where: { $0.name == "token" })?.value,
                  Self.isCanonicalToken(token) else {
                return nil
            }
            return PCAEnrollmentLink(
                serverBaseURL: URL(string: "\(Self.customScheme)://\(Self.customHost)")!,
                rawInvitationToken: token
            )
        }

        guard scheme == Self.universalLinkScheme,
              host == Self.universalLinkHost,
              url.query == nil,
              url.path.split(separator: "/").count == 1,
              let token = url.path.split(separator: "/").first.map(String.init),
              Self.isCanonicalToken(token) else {
            return nil
        }
        return PCAEnrollmentLink(
            serverBaseURL: URL(string: "\(Self.universalLinkScheme)://\(Self.universalLinkHost)")!,
            rawInvitationToken: token
        )
    }

    private static func isCanonicalToken(_ token: String) -> Bool {
        token.count == tokenLength && token.unicodeScalars.allSatisfy {
            ($0.value >= 48 && $0.value <= 57) ||
            ($0.value >= 65 && $0.value <= 90) ||
            ($0.value >= 97 && $0.value <= 122) ||
            $0.value == 45 || $0.value == 95
        }
    }
}

/// Small, non-persistent handoff object for SwiftUI's `onOpenURL` binding.
/// The host app/coordinator must consume the link and clear it; this router
/// never logs, persists, or treats the link as anything beyond an opaque
/// bootstrap input.
public final class PCAEnrollmentLinkRouter {
    private let parser: PCAEnrollmentLinkParser
    public private(set) var pendingLink: PCAEnrollmentLink?

    public init(parser: PCAEnrollmentLinkParser = PCAEnrollmentLinkParser()) {
        self.parser = parser
    }

    @discardableResult
    public func receive(_ url: URL) -> Bool {
        guard let link = parser.parse(url) else { return false }
        pendingLink = link
        return true
    }

    public func takePendingLink() -> PCAEnrollmentLink? {
        defer { pendingLink = nil }
        return pendingLink
    }
}

public enum PCAEnrollmentProfileStoreError: Error, Equatable {
    case invalidDeviceId
    case invalidStoredProfile
}

/// Local profile persistence contains only the opaque child-profile reference
/// and the parent-authorized age/policy defaults. It is written only after
/// explicit child confirmation and never contains activity, policy plaintext,
/// keys, recovery material, or readable child identity fields.
public protocol PCAEnrollmentProfileStore {
    func save(_ profile: PCAEnrollmentProfile, forDeviceId deviceId: String) throws
    func load(forDeviceId deviceId: String) throws -> PCAEnrollmentProfile?
    func remove(forDeviceId deviceId: String) throws
}

public final class UserDefaultsPCAEnrollmentProfileStore: PCAEnrollmentProfileStore {
    private let defaults: UserDefaults
    private let namespace: String

    public init(defaults: UserDefaults = .standard, namespace: String = "org.pca.enrollment.profile") {
        self.defaults = defaults
        self.namespace = namespace
    }

    public func save(_ profile: PCAEnrollmentProfile, forDeviceId deviceId: String) throws {
        guard !deviceId.isEmpty else { throw PCAEnrollmentProfileStoreError.invalidDeviceId }
        do {
            defaults.set(try JSONEncoder().encode(profile), forKey: key(for: deviceId))
        } catch {
            throw PCAEnrollmentProfileStoreError.invalidStoredProfile
        }
    }

    public func load(forDeviceId deviceId: String) throws -> PCAEnrollmentProfile? {
        guard !deviceId.isEmpty else { throw PCAEnrollmentProfileStoreError.invalidDeviceId }
        guard let data = defaults.data(forKey: key(for: deviceId)) else { return nil }
        do {
            return try JSONDecoder().decode(PCAEnrollmentProfile.self, from: data)
        } catch {
            throw PCAEnrollmentProfileStoreError.invalidStoredProfile
        }
    }

    public func remove(forDeviceId deviceId: String) throws {
        guard !deviceId.isEmpty else { throw PCAEnrollmentProfileStoreError.invalidDeviceId }
        defaults.removeObject(forKey: key(for: deviceId))
    }

    private func key(for deviceId: String) -> String {
        "\(namespace).\(deviceId)"
    }
}

public final class InMemoryPCAEnrollmentProfileStore: PCAEnrollmentProfileStore {
    private var profiles: [String: PCAEnrollmentProfile] = [:]

    public init() {}

    public func save(_ profile: PCAEnrollmentProfile, forDeviceId deviceId: String) throws {
        guard !deviceId.isEmpty else { throw PCAEnrollmentProfileStoreError.invalidDeviceId }
        profiles[deviceId] = profile
    }

    public func load(forDeviceId deviceId: String) throws -> PCAEnrollmentProfile? {
        guard !deviceId.isEmpty else { throw PCAEnrollmentProfileStoreError.invalidDeviceId }
        return profiles[deviceId]
    }

    public func remove(forDeviceId deviceId: String) throws {
        guard !deviceId.isEmpty else { throw PCAEnrollmentProfileStoreError.invalidDeviceId }
        profiles.removeValue(forKey: deviceId)
    }
}

public enum PCAEnrollmentAuditTransition: String, Codable, Equatable {
    case parentProfilePresented
    case childProfileConfirmed
    case authorizationRequired
    case authorizationApproved
    case profilePersistenceFailed
}

/// Metadata-only local audit event. The coordinator binding must forward the
/// event into the family E2EE audit log; this type intentionally contains no
/// profile values, activity, location, key material, or recovery material.
public struct PCAEnrollmentAuditEvent: Codable, Equatable {
    public let deviceId: String
    public let transition: PCAEnrollmentAuditTransition
    public let actor: String
    public let occurredAtUtc: Date
    public let reason: String

    public init(
        deviceId: String,
        transition: PCAEnrollmentAuditTransition,
        actor: String = "CHILD_DEVICE",
        occurredAtUtc: Date,
        reason: String
    ) {
        self.deviceId = deviceId
        self.transition = transition
        self.actor = actor
        self.occurredAtUtc = occurredAtUtc
        self.reason = reason
    }
}

public protocol PCAEnrollmentAuditSink {
    func record(_ event: PCAEnrollmentAuditEvent)
}

public struct NoopPCAEnrollmentAuditSink: PCAEnrollmentAuditSink {
    public init() {}
    public func record(_ event: PCAEnrollmentAuditEvent) {}
}

public final class InMemoryPCAEnrollmentAuditSink: PCAEnrollmentAuditSink {
    public private(set) var events: [PCAEnrollmentAuditEvent] = []

    public init() {}
    public func record(_ event: PCAEnrollmentAuditEvent) {
        events.append(event)
    }
}

public enum PCAEnrollmentProfileRuntimeState: Equatable {
    case awaitingProfile
    case awaitingChildConfirmation(PCAEnrollmentProfile, PCAEnrollmentDisclosure)
    case authorizationRequired(PCAEnrollmentProfile, PCAEnrollmentRuntimeDefaults)
    case ready(PCAEnrollmentProfile, PCAEnrollmentRuntimeDefaults)
    case profilePersistenceFailed
}

/// Local iOS profile/runtime state machine. A parent-authorized profile is
/// displayed exactly as received, the child confirms without an edit path,
/// and only then is the profile persisted. Managed Settings/Device Activity
/// use remains gated until Family Controls reports `.approved`.
public final class PCAEnrollmentProfileRuntimeController {
    private let deviceId: String
    private let store: PCAEnrollmentProfileStore
    private let auditSink: PCAEnrollmentAuditSink
    private let now: () -> Date
    private let consumer = PCAEnrollmentProfileConsumer()
    private var confirmedProfile: PCAEnrollmentProfile?
    private var authorization: ChildAuthorizationState

    public private(set) var state: PCAEnrollmentProfileRuntimeState = .awaitingProfile

    public init(
        deviceId: String,
        store: PCAEnrollmentProfileStore,
        authorization: ChildAuthorizationState = .notDetermined,
        auditSink: PCAEnrollmentAuditSink = NoopPCAEnrollmentAuditSink(),
        now: @escaping () -> Date = { Date() }
    ) {
        self.deviceId = deviceId
        self.store = store
        self.authorization = authorization
        self.auditSink = auditSink
        self.now = now
    }

    public func receiveParentAuthorizedProfile(_ profile: PCAEnrollmentProfile) {
        confirmedProfile = nil
        state = .awaitingChildConfirmation(profile, consumer.disclosure(for: profile))
        record(.parentProfilePresented, reason: "Parent-authorized profile received from enrollment bootstrap.")
    }

    @discardableResult
    public func confirmChildProfile() -> PCAEnrollmentProfileRuntimeState {
        guard case let .awaitingChildConfirmation(profile, _) = state else { return state }
        do {
            try store.save(profile, forDeviceId: deviceId)
        } catch {
            state = .profilePersistenceFailed
            record(.profilePersistenceFailed, reason: "Confirmed profile could not be stored locally.")
            return state
        }

        confirmedProfile = profile
        record(.childProfileConfirmed, reason: "Child confirmed the parent-selected profile without editing it.")
        return applyAuthorizationState()
    }

    @discardableResult
    public func updateAuthorization(_ authorization: ChildAuthorizationState) -> PCAEnrollmentProfileRuntimeState {
        self.authorization = authorization
        guard confirmedProfile != nil else { return state }
        return applyAuthorizationState()
    }

    @discardableResult
    public func restorePersistedProfile() -> PCAEnrollmentProfileRuntimeState {
        do {
            guard let profile = try store.load(forDeviceId: deviceId) else {
                state = .awaitingProfile
                return state
            }
            confirmedProfile = profile
            return applyAuthorizationState()
        } catch {
            state = .profilePersistenceFailed
            record(.profilePersistenceFailed, reason: "Stored profile could not be decoded safely.")
            return state
        }
    }

    private func applyAuthorizationState() -> PCAEnrollmentProfileRuntimeState {
        guard let profile = confirmedProfile else { return state }
        let defaults = consumer.defaults(for: profile)
        if authorization.permitsEnforcement {
            let nextState = PCAEnrollmentProfileRuntimeState.ready(profile, defaults)
            if state != nextState {
                state = nextState
                record(.authorizationApproved, reason: "Family Controls authorization permits the iOS runtime gate.")
            }
        } else {
            let nextState = PCAEnrollmentProfileRuntimeState.authorizationRequired(profile, defaults)
            if state != nextState {
                state = nextState
                record(.authorizationRequired, reason: "Family Controls authorization is not approved; enforcement remains gated.")
            }
        }
        return state
    }

    private func record(_ transition: PCAEnrollmentAuditTransition, reason: String) {
        auditSink.record(PCAEnrollmentAuditEvent(
            deviceId: deviceId,
            transition: transition,
            occurredAtUtc: now(),
            reason: reason
        ))
    }
}

/// The unrecoverable single-parent/no-Recovery-Secret case is disclosed
/// before generation. This gate only authorizes a later owner/coordinator
/// generator; it never creates, stores, logs, or returns the Recovery Secret.
public struct PCARecoverySecretDisclosureGate {
    public static let title = "Keep your Recovery Secret safe"
    public static let summary = "If you are the only parent and you lose the Recovery Secret, no one can recover this family. PCA support cannot recover it. You would need to start a new family enrollment. Keep the secret offline and separate from your devices."
    public static let acknowledgementLabel = "I understand that recovery may be impossible without this secret"

    public private(set) var acknowledged = false

    public init() {}

    public mutating func acknowledge() {
        acknowledged = true
    }

    public func authorizeGeneration() -> Bool {
        acknowledged
    }
}

#if canImport(SwiftUI)
/// Reusable iOS child-facing confirmation view. It has no edit controls and
/// leaves the actual bootstrap/profile persistence to the caller's runtime
/// controller. English copy is intentionally local and must receive an
/// Arabic/RTL translation binding before release.
public struct PCAChildEnrollmentProfileView: View {
    private let disclosure: PCAEnrollmentDisclosure
    private let onConfirm: () -> Void

    public init(disclosure: PCAEnrollmentDisclosure, onConfirm: @escaping () -> Void) {
        self.disclosure = disclosure
        self.onConfirm = onConfirm
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(disclosure.title)
                    .font(.title2.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                Text(disclosure.summary)
                Text("Selected age: \(disclosure.selectedAgeLabel)")
                Text("Starting safety: \(disclosure.startingSafetyLabel)")
                Text(disclosure.monitoredSummary)
                Text(disclosure.notMonitoredSummary)
                Text(disclosure.emergencySummary)
                Text(disclosure.authorizationSummary)
                    .foregroundStyle(.secondary)
                Button(disclosure.confirmLabel, action: onConfirm)
                    .accessibilityHint("Confirms the parent-selected settings without changing them")
            }
            .padding()
        }
        .navigationTitle("Enrollment")
    }
}
#endif

/// iOS-side enrollment steps ONLY (doc 07 Section 19 / doc 08). Consumes
/// the EXISTING Secure Invite / pairing / Family Envelope contracts --
/// this type invents no new protocol message, field, or endpoint. It
/// sequences two iOS-specific steps doc 08's platform-neutral flow
/// delegates to each platform: (1) generate/store this device's DSK/DEK
/// in Keychain, (2) request Family Controls child authorization -- both
/// independently observable, neither silently assumed to have succeeded
/// because the other did.
public enum ChildEnrollmentStepResult: Equatable {
    case keyMaterialReady
    case keyMaterialFailed(String)
    case authorizationState(ChildAuthorizationState)
}

public struct ChildEnrollmentCoordinator {
    private let keyMaterialStore: FamilyKeyMaterialStore
    private let authorizationCenter: ChildAuthorizationCenter

    public init(keyMaterialStore: FamilyKeyMaterialStore, authorizationCenter: ChildAuthorizationCenter) {
        self.keyMaterialStore = keyMaterialStore
        self.authorizationCenter = authorizationCenter
    }

    /// Consumes the parent-authorized age/mode profile without copying child
    /// identity or family data into the runtime defaults. Enforcement remains
    /// fail-closed until Family Controls reports `.approved`.
    public func consumeProfile(
        _ profile: PCAEnrollmentProfile,
        authorization: ChildAuthorizationState
    ) -> PCAEnrollmentProfileConsumption {
        PCAEnrollmentProfileConsumer().consume(profile, authorization: authorization)
    }

    /// Stores ALREADY-GENERATED key bytes (generation/algorithm is
    /// external, `CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW`) under
    /// this device's opaque id. Returns a result rather than throwing so
    /// callers building an enrollment progress UI can render a specific
    /// step's failure without a try/catch at the call site.
    public func persistKeyMaterial(dsk: Data, dek: Data, deviceId: String) -> ChildEnrollmentStepResult {
        do {
            try keyMaterialStore.store(dsk, kind: .deviceSigningKey, deviceId: deviceId)
            try keyMaterialStore.store(dek, kind: .deviceEncryptionKey, deviceId: deviceId)
            return .keyMaterialReady
        } catch {
            return .keyMaterialFailed(String(describing: error))
        }
    }

    /// Requests Family Controls child authorization -- the iOS-specific
    /// authorization step doc 08's enrollment flow expects each platform
    /// to perform on its own terms (doc 07 Section 6's anti-removal
    /// posture only becomes meaningful once this returns `.approved`).
    public func requestChildAuthorization() async -> ChildEnrollmentStepResult {
        .authorizationState(await authorizationCenter.requestAuthorization())
    }
}
