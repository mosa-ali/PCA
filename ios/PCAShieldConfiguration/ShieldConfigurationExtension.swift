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
    override func configuration(shielding application: ApplicationToken) -> ShieldConfiguration {
        ShieldConfiguration()
    }

    override func configuration(shielding application: ApplicationToken, in category: ActivityCategoryToken) -> ShieldConfiguration {
        ShieldConfiguration()
    }

    override func configuration(shielding webDomain: WebDomainToken) -> ShieldConfiguration {
        ShieldConfiguration()
    }

    override func configuration(shielding webDomain: WebDomainToken, in category: ActivityCategoryToken) -> ShieldConfiguration {
        ShieldConfiguration()
    }
}
#endif
