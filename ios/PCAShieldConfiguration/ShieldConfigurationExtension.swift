import Foundation
#if canImport(ManagedSettingsUI)
import ManagedSettingsUI
import ManagedSettings
import FamilyControls

/// ShieldConfiguration extension entry point (doc 07 Section 3/4).
///
/// doc 07 Section 18 / PCA-DEC-017 records custom shield branding as
/// OWNER-DECISION-GATED and recommends "(b) Default Apple shield at
/// launch, custom shield as a fast-follow" specifically to reduce initial
/// entitlement/App-Review surface area. This extension therefore returns
/// Apple's own default `ShieldConfiguration()` unconditionally -- it
/// exists as a real, buildable extension target (satisfying "create
/// required extension architecture as applicable") without introducing
/// any custom branding decision this lane is not authorized to make.
/// Switching to custom copy/imagery later is a change confined to the
/// bodies below; no other PCA-15 file depends on this extension's visual
/// output.
final class PCAShieldConfigurationExtension: ShieldConfigurationDataSource {
    // ShieldConfigurationDataSource's real superclass signatures take the
    // resolved `Application`/`ActivityCategory`/`WebDomain` types (which
    // expose display metadata for rendering the shield UI), NOT the opaque
    // `*Token` types `ShieldActionDelegate` uses in the sibling extension
    // (PCAShieldAction/ShieldActionExtension.swift) -- confirmed by CI: the
    // Token-typed overrides here failed to compile with "method does not
    // override any method from its superclass" while the sibling's
    // Token-typed `ShieldActionDelegate` overrides compiled cleanly,
    // proving these are two genuinely different Apple API shapes, not one
    // convention applied inconsistently.
    override func configuration(shielding application: Application) -> ShieldConfiguration {
        ShieldConfiguration()
    }

    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        ShieldConfiguration()
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        ShieldConfiguration()
    }

    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
        ShieldConfiguration()
    }
}
#endif
