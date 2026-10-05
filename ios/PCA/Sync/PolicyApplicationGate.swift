import Foundation

/// Device-side defense-in-depth epoch/replay floor, consumed on top of
/// (never instead of) the envelope-level checks the backend
/// FamilyEnvelopeVerifier already performs before this device's payload
/// ever gets decrypted (doc 22; backend/src/familyenvelope). This type
/// exists because a decrypted, already-envelope-accepted policy can still
/// pass through additional local caching/storage before
/// `ScheduleEngine`/the DeviceActivity extension actually apply it -- this
/// gate is the LAST local check before that application, mirroring the
/// same "never move the floor backward" anti-downgrade discipline as the
/// backend's own trustSetEpoch/keyEpoch checks (never reimplementing
/// their cryptographic verification, only re-asserting the ordering
/// invariant once more at the point of local use).
public struct PolicyEpochStamp: Equatable {
    public let trustSetEpoch: Int
    public let keyEpoch: Int
    public init(trustSetEpoch: Int, keyEpoch: Int) {
        self.trustSetEpoch = trustSetEpoch
        self.keyEpoch = keyEpoch
    }
}

public enum PolicyApplicationDecision: Equatable {
    case apply
    case rejectMissingTrustedEpochFloor
    case rejectInvalidCandidateEpoch
    case rejectInvalidTrustedEpochFloor
    case rejectStaleTrustSetEpoch
    case rejectStaleKeyEpoch
}

public enum PolicyApplicationGate {
    /// Family protocol epochs stay inside signed 32-bit range on every
    /// platform. The lower bounds remain field-specific: trust-set epochs
    /// start at 1, while keyEpoch 0 remains a supported initial/sentinel value.
    public static let maximumEpoch = Int(Int32.max)

    /// `currentFloor` must come from a previously verified and durably
    /// accepted Trust Set/policy receipt. An absent floor is not authority
    /// to trust an arbitrary first epoch: the approved first-device root
    /// ceremony and receipt-verification path must establish it before local
    /// policy application is possible. Once a floor exists, both epochs
    /// must be >= the floor; EITHER one regressing is rejected independently.
    public static func evaluate(candidate: PolicyEpochStamp, currentFloor: PolicyEpochStamp?) -> PolicyApplicationDecision {
        guard let floor = currentFloor else { return .rejectMissingTrustedEpochFloor }
        guard isValid(candidate) else { return .rejectInvalidCandidateEpoch }
        guard isValid(floor) else { return .rejectInvalidTrustedEpochFloor }
        if candidate.trustSetEpoch < floor.trustSetEpoch { return .rejectStaleTrustSetEpoch }
        if candidate.keyEpoch < floor.keyEpoch { return .rejectStaleKeyEpoch }
        return .apply
    }

    private static func isValid(_ stamp: PolicyEpochStamp) -> Bool {
        stamp.trustSetEpoch >= 1 && stamp.trustSetEpoch <= maximumEpoch &&
        stamp.keyEpoch >= 0 && stamp.keyEpoch <= maximumEpoch
    }
}
