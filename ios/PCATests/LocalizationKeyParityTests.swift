import XCTest
@testable import PCA

/// PCA-FR-111 / PCA-NFR-041 regression coverage.
///
/// PCA has exactly three real SwiftUI screens (`ContentView`,
/// `AboutProtectionView`, `PCAChildEnrollmentProfileView` -- see
/// `PCALocalizedStrings`'s own doc comment for why everything else under
/// `ios/PCA` has no rendered UI). This suite enumerates every English
/// string those screens can actually put on screen -- both their own
/// literal strings and every runtime value the `AntiRemovalClaimCopy` /
/// `PCAEnrollmentDisclosure` copy models can produce -- and asserts
/// `Localizable.xcstrings` carries a complete, non-empty English + Arabic
/// entry for each one. This is the same "i18n key parity" idea
/// parent-web/platform-admin-web enforce against their locale JSON,
/// adapted to this project's String Catalog and its
/// key-equals-English-source-text convention.
///
/// The catalog is read directly off disk (relative to this test file's own
/// source location) rather than through `Bundle.main`: this repository
/// cannot be built or run in this environment, so a structural,
/// disk-level check of the actual source-of-truth JSON is the strongest
/// verification available. It also means this test fails the moment
/// someone changes an `AntiRemovalClaimCopy`/`PCAEnrollmentDisclosure`
/// English string without updating the catalog -- the key IS the English
/// text, so a changed string is, by construction, a missing key.
final class LocalizationKeyParityTests: XCTestCase {
    private struct StringCatalog: Decodable {
        struct Entry: Decodable {
            struct Localization: Decodable {
                struct StringUnit: Decodable {
                    let state: String
                    let value: String
                }
                let stringUnit: StringUnit
            }
            let localizations: [String: Localization]
        }
        let sourceLanguage: String
        let strings: [String: Entry]
        let version: String
    }

    /// Brand/product names are deliberately identical in every locale
    /// (matching how parent-web/platform-admin-web also keep "PCA"
    /// untranslated), so they're exempted from the
    /// "ar must differ from en" sanity check below.
    private let untranslatedByDesign: Set<String> = ["PCA"]

    private func loadCatalog(sourceFile: StaticString = #filePath) throws -> StringCatalog {
        // This file lives at ios/PCATests/LocalizationKeyParityTests.swift;
        // the catalog lives at ios/PCA/Localizable.xcstrings -- both one
        // level under ios/.
        let thisFile = URL(fileURLWithPath: "\(sourceFile)")
        let iosDirectory = thisFile.deletingLastPathComponent().deletingLastPathComponent()
        let catalogURL = iosDirectory.appendingPathComponent("PCA").appendingPathComponent("Localizable.xcstrings")
        let data = try XCTUnwrap(
            FileManager.default.contents(atPath: catalogURL.path),
            "Localizable.xcstrings not found at \(catalogURL.path)"
        )
        return try JSONDecoder().decode(StringCatalog.self, from: data)
    }

    private func assertFullyLocalized(
        _ englishText: String,
        in catalog: StringCatalog,
        context: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let entry = catalog.strings[englishText] else {
            XCTFail("Localizable.xcstrings has no entry keyed \"\(englishText)\" (\(context))", file: file, line: line)
            return
        }
        guard let en = entry.localizations["en"] else {
            XCTFail("\"\(englishText)\" is missing its en localization (\(context))", file: file, line: line)
            return
        }
        guard let ar = entry.localizations["ar"] else {
            XCTFail("\"\(englishText)\" is missing its ar localization (\(context))", file: file, line: line)
            return
        }
        XCTAssertEqual(
            en.stringUnit.value, englishText,
            "en value has drifted from the source text used as the key (\(context))", file: file, line: line
        )
        XCTAssertFalse(ar.stringUnit.value.isEmpty, "ar translation is empty (\(context))", file: file, line: line)
        if !untranslatedByDesign.contains(englishText) {
            XCTAssertNotEqual(
                ar.stringUnit.value, en.stringUnit.value,
                "ar translation is identical to English -- looks untranslated (\(context))", file: file, line: line
            )
        }
    }

    // MARK: - Catalog-wide structural checks

    func testCatalogIsWellFormedAndEveryEntryIsFullyTranslated() throws {
        let catalog = try loadCatalog()
        XCTAssertEqual(catalog.sourceLanguage, "en")
        XCTAssertFalse(catalog.strings.isEmpty)

        for (key, entry) in catalog.strings {
            guard let en = entry.localizations["en"] else {
                XCTFail("\"\(key)\" is missing an en localization"); continue
            }
            guard let ar = entry.localizations["ar"] else {
                XCTFail("\"\(key)\" is missing an ar localization"); continue
            }
            XCTAssertFalse(en.stringUnit.value.isEmpty, "en value for \"\(key)\" must not be empty")
            XCTAssertFalse(ar.stringUnit.value.isEmpty, "ar value for \"\(key)\" must not be empty")
            XCTAssertEqual(en.stringUnit.value, key, "en value must equal the key (PCALocalizedStrings' lookup convention) for \"\(key)\"")
        }
    }

    // MARK: - Every screen's own literal strings

    func testViewLiteralStringsAreFullyLocalized() throws {
        let catalog = try loadCatalog()
        let literals = [
            "PCA",
            "Native iOS foundation",
            "Removal protection",
            "Shows what removal protection is currently active on this device and its exact scope",
            "Important scope note: %@",
            "Enrollment",
            "Confirms the parent-selected settings without changing them",
            "Selected age: %@",
            "Starting safety: %@",
        ]
        for literal in literals {
            assertFullyLocalized(literal, in: catalog, context: literal)
        }
    }

    // MARK: - Every AntiRemovalClaimCopy runtime value (AboutProtectionView)

    func testAntiRemovalClaimCopyStringsAreFullyLocalizedForEveryAuthorizationState() throws {
        let catalog = try loadCatalog()
        let states: [ChildAuthorizationState] = [
            .notDetermined,
            .denied,
            .approved,
            .revoked(to: .denied),
            .revoked(to: .notDetermined),
            .entitlementUnavailable,
        ]
        for state in states {
            let copy = AntiRemovalClaimCopy.current(for: state)
            assertFullyLocalized(copy.statusHeadline, in: catalog, context: "statusHeadline for \(state)")
            assertFullyLocalized(copy.statusDetail, in: catalog, context: "statusDetail for \(state)")
            assertFullyLocalized(copy.scopeQualifier, in: catalog, context: "scopeQualifier for \(state)")
        }
    }

    // MARK: - Every PCAEnrollmentDisclosure runtime value (PCAChildEnrollmentProfileView)

    func testEnrollmentDisclosureStringsAreFullyLocalizedForEveryProfileCombination() throws {
        let catalog = try loadCatalog()
        let profiles: [PCAEnrollmentProfile] = [
            PCAEnrollmentProfile(childProfileId: nil, ageUxTier: .youngChild, initialPolicyProfile: .balanced),
            PCAEnrollmentProfile(childProfileId: nil, ageUxTier: .youngChild, initialPolicyProfile: .strict),
            PCAEnrollmentProfile(childProfileId: nil, ageUxTier: .teen, initialPolicyProfile: .balanced),
            PCAEnrollmentProfile(childProfileId: nil, ageUxTier: .teen, initialPolicyProfile: .strict),
        ]
        for profile in profiles {
            let disclosure = PCAEnrollmentDisclosure.forProfile(profile)
            let context = "PCAEnrollmentDisclosure for \(profile.ageUxTier)/\(profile.initialPolicyProfile)"
            for text in [
                disclosure.title,
                disclosure.summary,
                disclosure.selectedAgeLabel,
                disclosure.startingSafetyLabel,
                disclosure.monitoredSummary,
                disclosure.notMonitoredSummary,
                disclosure.emergencySummary,
                disclosure.authorizationSummary,
                disclosure.confirmLabel,
            ] {
                assertFullyLocalized(text, in: catalog, context: context)
            }
        }
    }
}
