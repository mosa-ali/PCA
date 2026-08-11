import Foundation

/// doc 07 Section 10 / PCA-IOS-003: the fixed, non-overridable set of
/// system application categories a shield configuration may NEVER cover,
/// regardless of what a signed parent policy envelope requests. This is a
/// LOCAL, client-side floor -- it is checked independently of, and in
/// addition to, the envelope's own signature/expiry/epoch validity (doc
/// 22's pipeline validates the envelope is authentic; this validates the
/// authenticated CONTENT is still safe to apply, mirroring doc 06's
/// Android PCA-AND-003 pattern for the same requirement on that platform).
///
/// `ActivityCategoryToken` identity for Phone/Emergency-SOS/FaceTime-
/// emergency-adjacent system categories is resolved by the app at
/// configuration time through Apple's own `FamilyActivityPicker`/category
/// APIs (never guessed, never reverse-engineered from a private symbol,
/// per PCA-IOS-001) and supplied to this type by the caller -- this type's
/// own job is only the REJECTION RULE, not resolving which tokens are
/// "the phone app."
public struct EmergencySurfaceExclusionSet {
    /// Opaque identifiers (whatever stable, non-reversed handle the host
    /// app uses internally to recognize "this is the Phone/Emergency-SOS/
    /// FaceTime-emergency surface") that must never appear in an applied
    /// shield's application/category set.
    public let protectedIdentifiers: Set<String>

    public init(protectedIdentifiers: Set<String>) {
        self.protectedIdentifiers = protectedIdentifiers
    }

    public func intersects(_ candidateIdentifiers: Set<String>) -> Bool {
        !protectedIdentifiers.isDisjoint(with: candidateIdentifiers)
    }
}
