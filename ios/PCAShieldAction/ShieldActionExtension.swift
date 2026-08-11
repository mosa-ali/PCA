import Foundation
#if canImport(ManagedSettingsUI)
import ManagedSettingsUI
import ManagedSettings
import FamilyControls

/// ShieldAction extension entry point (doc 07 Section 3/4). Handles the
/// system shield's primary/secondary button taps -- Apple's default shield
/// buttons are typically "Close" (primary) and, where enabled, a
/// domain-specific secondary action.
///
/// This implementation deliberately does NOT lift the shield from either
/// button: no bypass path exists here, so a child tapping either button
/// can never self-remove a restriction (doc 07 Section 6/PCA-IOS-002 --
/// the anti-removal/anti-bypass posture applies to shield actions too, not
/// only app deletion). A future "ask parent" secondary-action flow (e.g.
/// submitting a child request through the existing PCA-10 request/decision
/// contract, never a local unlock) is additive and does not change this
/// file's core invariant: no code path in this extension calls anything
/// that removes or weakens a `ManagedSettingsStore` shield.
final class PCAShieldActionExtension: ShieldActionDelegate {
    override func handle(action: ShieldAction, for application: ApplicationToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(to: action, completionHandler: completionHandler)
    }

    override func handle(action: ShieldAction, for category: ActivityCategoryToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(to: action, completionHandler: completionHandler)
    }

    override func handle(action: ShieldAction, for webDomain: WebDomainToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(to: action, completionHandler: completionHandler)
    }

    private func respond(to action: ShieldAction, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        switch action {
        case .primaryButtonPressed:
            // "Close" -- dismiss the shield UI itself without touching the
            // underlying restriction. `.close` is Apple's documented
            // response for this; it never implies unshielding the app.
            completionHandler(.close)
        case .secondaryButtonPressed:
            // No local bypass exists. `.defer` leaves the system's own
            // fallback behavior in place (also never an unshield) until a
            // reviewed "request parent exception" flow (PCA-10 child
            // request contract) is wired to this branch.
            completionHandler(.defer)
        @unknown default:
            completionHandler(.close)
        }
    }
}
#endif
