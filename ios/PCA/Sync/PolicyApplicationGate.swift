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
    case rejectStaleTrustSetEpoch
    case rejectStaleKeyEpoch
}

public enum PolicyApplicationGate {
    /// `currentFloor` is `nil` only before this device has ever accepted
    /// any policy (genesis) -- any stamp is accepted then, matching the
    /// same trust-on-first-use posture as the backend's own genesis
    /// handling. Once a floor exists, both epochs must be >= the floor;
    /// EITHER one regressing is rejected independently, mirroring
    /// FamilyEnvelopeVerifier's own "every check is independent" rule.
    public static func evaluate(candidate: PolicyEpochStamp, currentFloor: PolicyEpochStamp?) -> PolicyApplicationDecision {
        guard let floor = currentFloor else { return .apply }
        if candidate.trustSetEpoch < floor.trustSetEpoch { return .rejectStaleTrustSetEpoch }
        if candidate.keyEpoch < floor.keyEpoch { return .rejectStaleKeyEpoch }
        return .apply
    }
}
