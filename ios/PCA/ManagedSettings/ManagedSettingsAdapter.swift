import Foundation
#if canImport(ManagedSettings)
import ManagedSettings
import FamilyControls
#endif

/// What the adapter is being asked to do -- deliberately NOT a bare
/// boolean, so "why" survives into logging/parent status even though the
/// shield mechanics themselves are binary (doc 07 Section 7).
public enum ShieldIntent: Equatable {
    case applyAll
    case removeAll
}

public enum ManagedSettingsAdapterError: Error, Equatable {
    case rejectedByEmergencySafetyFloor(reasons: [String])
    case entitlementUnavailable
}

#if canImport(ManagedSettings) && canImport(FamilyControls)
/// Thin wrapper around `ManagedSettingsStore` -- contains no policy
/// decision logic of its own (that is Schedule/ScheduleEngine.swift's
/// job, consuming the SAME PCA policy the backend/Android adapters
/// consume, per doc 07 Section 7's "no separate policy authority"
/// requirement). This type only ever does two things: run the emergency
/// safety floor check (PCA-IOS-003), then apply or clear the store.
public final class ManagedSettingsAdapter {
    private let store: ManagedSettingsStore
    private let safetyValidator: ShieldPolicyValidator<ApplicationToken>
    private let categorySafetyValidator: ShieldPolicyValidator<ActivityCategoryToken>

    public init(
        store: ManagedSettingsStore = ManagedSettingsStore(),
        protectedApplicationTokens: Set<ApplicationToken>,
        protectedCategoryTokens: Set<ActivityCategoryToken>
    ) {
        self.store = store
        self.safetyValidator = ShieldPolicyValidator(protectedApplicationTokens: protectedApplicationTokens, protectedCategoryTokens: [])
        self.categorySafetyValidator = ShieldPolicyValidator(protectedApplicationTokens: [], protectedCategoryTokens: protectedCategoryTokens)
    }

    /// Applies a shield covering exactly the given tokens, after
    /// independently validating BOTH the application and category
    /// dimensions against their own protected sets (PCA-IOS-003). Domain
    /// shielding uses `Set<WebDomainToken>` and is validated the same way
    /// by the caller composing a `ShieldPolicyValidator<WebDomainToken>`
    /// separately, since `ManagedSettingsAdapter` is generic only over the
    /// two token kinds `ManagedSettingsStore.shield` actually gates
    /// per-call in this slice; extending to domains is a mechanical
    /// repeat of this same pattern once the web-domain product surface
    /// (doc 07 Section 8 / doc 14) is implemented.
    public func apply(applications: Set<ApplicationToken>, categories: Set<ActivityCategoryToken>) throws {
        let appOutcome = safetyValidator.validate(applications: applications, categories: [], domains: [])
        if case .rejected(let reasons) = appOutcome {
            throw ManagedSettingsAdapterError.rejectedByEmergencySafetyFloor(reasons: reasons)
        }
        let categoryOutcome = categorySafetyValidator.validate(applications: [], categories: categories, domains: [])
        if case .rejected(let reasons) = categoryOutcome {
            throw ManagedSettingsAdapterError.rejectedByEmergencySafetyFloor(reasons: reasons)
        }

        store.shield.applications = applications.isEmpty ? nil : applications
        store.shield.applicationCategories = categories.isEmpty ? nil : .specific(categories)
    }

    /// doc 07 Section 14: on authorization revocation, shields must not
    /// silently keep reporting themselves as active -- callers observing
    /// `ChildAuthorizationState.revoked` should call this so the device's
    /// own restriction state matches the now-unenforceable authorization,
    /// rather than leaving a stale shield the OS may or may not still
    /// honor without valid authorization.
    public func removeAll() {
        store.shield.applications = nil
        store.shield.applicationCategories = nil
        store.shield.webDomains = nil
    }
}
#endif
