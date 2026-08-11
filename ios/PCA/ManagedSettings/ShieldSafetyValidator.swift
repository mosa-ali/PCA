import Foundation

/// doc 07 PCA-IOS-003: rejects a candidate shield configuration that would
/// cover any protected (emergency-adjacent) token, BEFORE it is ever
/// handed to `ManagedSettingsStore`.
///
/// Generic over `Token: Hashable` rather than any concrete FamilyControls
/// type, for two reasons: (1) it lets this safety-critical rule be
/// unit-tested on any platform, including this Windows workspace, with
/// plain `String`/`Int` stand-in tokens, and (2) it structurally cannot
/// "look inside" a real `ApplicationToken`/`ActivityCategoryToken` --
/// `Hashable` equality is the only operation it ever performs, which is
/// exactly the opacity-preserving comparison Apple's own token model
/// supports (doc 07 Section 5) and never a reverse-lookup.
///
/// The protected set itself is never guessed or reverse-engineered from a
/// private symbol (PCA-IOS-001). It is populated by a legitimate,
/// Apple-supported reference-capture step during setup: the app presents
/// its OWN `FamilyActivityPicker` (or a documented category API) to
/// obtain the exact token(s) representing Phone/Emergency-SOS/FaceTime-
/// emergency-adjacent system functionality, exactly once, and records
/// them here by equality -- this validator's job is solely "was one of
/// those exact tokens included," never "does this token look like the
/// phone app."
public struct ShieldSafetyValidator<Token: Hashable> {
    public let protectedTokens: Set<Token>

    public init(protectedTokens: Set<Token>) {
        self.protectedTokens = protectedTokens
    }

    public enum ValidationResult: Equatable {
        case safe
        case rejected(overlappingCount: Int)
    }

    /// Checked independently for each of applications/categories/domains
    /// -- callers must call this once per shield dimension being
    /// configured, never a single merged check that could silently miss
    /// one dimension.
    public func validate<S: Sequence>(candidateTokens: S) -> ValidationResult where S.Element == Token {
        let candidateSet = Set(candidateTokens)
        let overlap = protectedTokens.intersection(candidateSet)
        return overlap.isEmpty ? .safe : .rejected(overlappingCount: overlap.count)
    }
}

/// Aggregates the three shield dimensions' safety checks into one
/// all-or-nothing decision -- a policy envelope is either fully safe to
/// apply or entirely rejected; this type never applies a "partially safe"
/// shield, since doing so could leave the emergency floor covered on
/// whichever dimension callers forgot to check.
public enum ShieldPolicyValidationOutcome: Equatable {
    case accepted
    case rejected(reasons: [String])
}

public struct ShieldPolicyValidator<Token: Hashable> {
    private let applicationValidator: ShieldSafetyValidator<Token>
    private let categoryValidator: ShieldSafetyValidator<Token>
    private let domainValidator: ShieldSafetyValidator<Token>

    public init(protectedApplicationTokens: Set<Token>, protectedCategoryTokens: Set<Token>, protectedDomainTokens: Set<Token> = []) {
        self.applicationValidator = ShieldSafetyValidator(protectedTokens: protectedApplicationTokens)
        self.categoryValidator = ShieldSafetyValidator(protectedTokens: protectedCategoryTokens)
        self.domainValidator = ShieldSafetyValidator(protectedTokens: protectedDomainTokens)
    }

    public func validate(applications: Set<Token>, categories: Set<Token>, domains: Set<Token>) -> ShieldPolicyValidationOutcome {
        var reasons: [String] = []
        if case .rejected = applicationValidator.validate(candidateTokens: applications) {
            reasons.append("shield application set includes a protected emergency-adjacent application token")
        }
        if case .rejected = categoryValidator.validate(candidateTokens: categories) {
            reasons.append("shield category set includes a protected emergency-adjacent category token")
        }
        if case .rejected = domainValidator.validate(candidateTokens: domains) {
            reasons.append("shield domain set includes a protected domain token")
        }
        return reasons.isEmpty ? .accepted : .rejected(reasons: reasons)
    }
}
