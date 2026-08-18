import Foundation

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
