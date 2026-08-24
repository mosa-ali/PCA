import Foundation

/// Centralized iOS localization lookup (PCA-FR-111 / PCA-NFR-041).
///
/// This app has three real SwiftUI screens (`ContentView`,
/// `AboutProtectionView`, `PCAChildEnrollmentProfileView`) -- everything
/// else under `ios/PCA` is a Foundation-level capability adapter with no
/// rendered UI of its own. Every user-facing string those three screens
/// render is looked up here rather than hardcoded, so English is never the
/// only language a parent or child can read the app in.
///
/// Every call site passes the CURRENT English source string as the lookup
/// key (the classic `NSLocalizedString(key, comment:)` convention, where
/// the key IS the base-language string). This is deliberate, not
/// incidental: it means a literal Text/Label string and a copy-model
/// property (e.g. `AntiRemovalClaimCopy.statusHeadline`,
/// `PCAEnrollmentDisclosure.summary`) are localized the exact same way,
/// with zero duplicated English prose between the tested copy-model files
/// and `Localizable.xcstrings` -- there is only ever one place that owns
/// the English wording (the copy-model / the literal itself), and the
/// catalog only ever adds an Arabic sibling for it. If a key is ever
/// missing from the catalog, `NSLocalizedString` falls back to returning
/// the key (i.e. the original English) rather than crashing or rendering
/// blank -- consistent with this codebase's "never silently claim a safe
/// state, never crash on missing data" discipline applied to copy
/// resolution.
///
/// `AntiRemovalClaimCopy`, `PCAEnrollmentDisclosure`,
/// `PCARecoverySecretDisclosureGate`, and `RecoverySecretLossDisclosure`
/// remain pure-English, bundle-independent Swift values on purpose (see
/// their own doc comments): several existing XCTest suites
/// (`AntiRemovalClaimCopyTests`, `EnrollmentProfileTests`,
/// `RemainingAdaptersTests`'s `PCARecoverySecretDisclosureGateTests`,
/// `RecoverySecretDisclosureTests`) pin their exact English content as a
/// PCA-IOS-002 / PCA-FR-008 compliance contract. Only the SwiftUI View
/// layer -- which actually renders text on screen -- calls into this type;
/// the copy-model files themselves are never touched by localization.
enum PCALocalizedStrings {
    /// Resolves `englishText` (used as the lookup key) against
    /// `Localizable.xcstrings` in the main bundle for the device's current
    /// language. Returns `englishText` unchanged if no localization is
    /// registered for the active locale.
    static func text(_ englishText: String) -> String {
        NSLocalizedString(englishText, bundle: .main, comment: "")
    }

    /// Same lookup as `text(_:)`, but formats the localized string (which
    /// must contain the same `%@` placeholders as the English source, e.g.
    /// `"Selected age: %@"`) with `arguments`. Callers should pass
    /// already-localized values (via `text(_:)`) as arguments so a
    /// translated sentence never embeds an untranslated fragment.
    static func format(_ englishFormat: String, _ arguments: CVarArg...) -> String {
        String(format: NSLocalizedString(englishFormat, bundle: .main, comment: ""), arguments: arguments)
    }
}
