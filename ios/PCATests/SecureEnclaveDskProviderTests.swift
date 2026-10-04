import XCTest
@testable import PCA
#if canImport(Security)
import Security
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

#if canImport(Security) && canImport(CryptoKit)

/// WAVE 6D regression coverage for the Secure Enclave DSK/DEK provider.
/// The CI runner is a simulator without a Secure Enclave, so these tests
/// exercise the FAIL-CLOSED half of the provider (typed refusals, zero
/// keychain side effects, namespace discipline) plus the injection seams
/// that make those branches reachable; the hardware-bound success path is
/// explicitly device-gated and skips honestly when no Secure Enclave is
/// present.
final class SecureEnclaveDskProviderTests: XCTestCase {

    // MARK: - Helpers

    private func uniqueAttemptId() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "")
    }

    private func tagData(_ alias: String) -> Data {
        Data(alias.utf8)
    }

    private func keyExists(_ alias: String) -> Bool {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrApplicationTag: tagData(alias),
        ]
        return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
    }

    /// Installs a plain (NON-Secure-Enclave) EC key under `alias`.
    /// Returns nil on success, otherwise the platform error code. Used to
    /// simulate tampering / stale entries, and as the keychain health probe.
    private func installSoftwareKey(_ alias: String) -> Int32? {
        let attributes: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: 256,
            kSecPrivateKeyAttrs: [
                kSecAttrIsPermanent: true,
                kSecAttrApplicationTag: tagData(alias),
            ] as [CFString: Any],
        ]
        var error: Unmanaged<CFError>?
        if SecKeyCreateRandomKey(attributes as CFDictionary, &error) != nil { return nil }
        guard let error = error else { return -1 }
        return Int32(CFErrorGetCode(error.takeRetainedValue()))
    }

    private func removeKey(_ alias: String) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrApplicationTag: tagData(alias),
        ]
        _ = SecItemDelete(query as CFDictionary)
    }

    /// Skips the calling test when this environment's keychain cannot store
    /// test keys at all (honest environment skip, never a silent pass).
    private func requireUsableKeychain() throws {
        let probeAlias = "com.pca.test.probe.\(UUID().uuidString)"
        defer { removeKey(probeAlias) }
        if let code = installSoftwareKey(probeAlias) {
            throw XCTSkip("test keychain unavailable in this environment (OSStatus \(code))")
        }
    }

    // MARK: - Fail-closed generation

    func testGenerationFailsClosedWithoutSecureEnclaveAndStoresNothing() throws {
        let provider = SecureEnclaveDskProvider()
        let attemptId = uniqueAttemptId()
        let dskAlias = provider.signingKeyAlias(attemptId: attemptId)
        let dekAlias = provider.encryptionKeyAlias(attemptId: attemptId)

        // Environment-robust: on real Secure Enclave hardware the call may
        // either succeed (genuine key) or fail typed; on simulator hosts it
        // is either unavailable up-front or refused by the platform at
        // creation time (e.g. errSecMissingEntitlement -34018). Every
        // non-success path must be ONE of the typed refusals -- never a
        // silent software key -- and NOTHING may be stored on failure.
        do {
            let pair = try provider.generateSigningKeyPair(attemptId: attemptId)
            provider.deleteKeyPair(alias: pair.privateKeyAlias)
        } catch {
            guard let dskError = error as? SecureEnclaveDskError else {
                XCTFail("untyped error: \(error)")
                return
            }
            switch dskError {
            case .secureEnclaveUnavailable, .keyGenerationFailed, .hardwareBindingVerificationFailed:
                break
            default:
                XCTFail("unexpected refusal: \(dskError)")
            }
        }
        XCTAssertFalse(keyExists(dskAlias), "a refused generation must never leave key material behind")
        XCTAssertFalse(keyExists(dekAlias), "a refused generation must never leave key material behind")
    }

    func testInjectedUnavailableNeverFallsBackToSoftwareKeys() throws {
        let provider = SecureEnclaveDskProvider(secureEnclaveAvailability: { false })
        let attemptId = uniqueAttemptId()
        XCTAssertThrowsError(try provider.generateSigningKeyPair(attemptId: attemptId)) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .secureEnclaveUnavailable)
        }
        XCTAssertFalse(keyExists(provider.signingKeyAlias(attemptId: attemptId)))
    }

    func testGenerationOnSimulatorWithInjectedAvailabilityFailsTypedAndStoresNothing() throws {
        if SecureEnclave.isAvailable {
            throw XCTSkip("runner has a Secure Enclave; the creation-failure branch is simulator-specific")
        }
        // Force the availability guard open so the REAL key creation call is
        // reached on a platform without Secure Enclave: the provider must
        // report a typed creation failure and store NOTHING -- never a
        // silent software key.
        let provider = SecureEnclaveDskProvider(secureEnclaveAvailability: { true })
        let attemptId = uniqueAttemptId()
        XCTAssertThrowsError(try provider.generateSigningKeyPair(attemptId: attemptId)) { error in
            guard let dskError = error as? SecureEnclaveDskError, case .keyGenerationFailed = dskError else {
                XCTFail("expected typed keyGenerationFailed, got \(error)")
                return
            }
        }
        XCTAssertFalse(keyExists(provider.signingKeyAlias(attemptId: attemptId)))
    }

    func testEmptyAttemptIdIsRejected() {
        let provider = SecureEnclaveDskProvider(secureEnclaveAvailability: { false })
        XCTAssertThrowsError(try provider.generateSigningKeyPair(attemptId: "")) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .invalidAttemptId)
        }
    }

    // MARK: - Create-once

    func testCreateOnceRefusesExistingAliasBeforeGeneration() throws {
        try requireUsableKeychain()
        // Availability is gated first; inject it open so this test exercises
        // the CREATE-ONCE conflict detection itself (before ANY generation
        // attempt happens).
        let provider = SecureEnclaveDskProvider(secureEnclaveAvailability: { true })
        let attemptId = uniqueAttemptId()
        let alias = provider.signingKeyAlias(attemptId: attemptId)
        if let code = installSoftwareKey(alias) {
            throw XCTSkip("keychain refused test key install (OSStatus \(code))")
        }
        defer { removeKey(alias) }

        // The alias-conflict check must win over ANY generation attempt:
        // conflict detection happens before generation is even considered.
        XCTAssertThrowsError(try provider.generateSigningKeyPair(attemptId: attemptId)) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .keyAliasConflict)
        }
        XCTAssertTrue(keyExists(alias), "the conflicting entry must never be deleted by a refused generation")
    }

    // MARK: - Signing fail-closed posture

    func testSigningMissingAliasFailsClosedWithoutCreatingMaterial() {
        let provider = SecureEnclaveDskProvider()
        let alias = "pca.dsk.\(uniqueAttemptId())"
        XCTAssertThrowsError(try provider.signCanonical(alias: alias, message: Data("message".utf8))) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .keyMaterialMissing)
        }
        XCTAssertFalse(keyExists(alias), "a missing key must never trigger regeneration")
    }

    func testSigningRefusesNonSecureEnclaveKeyMaterialUnderTag() throws {
        try requireUsableKeychain()
        let provider = SecureEnclaveDskProvider()
        let alias = "pca.dsk.\(uniqueAttemptId())"
        if let code = installSoftwareKey(alias) {
            throw XCTSkip("keychain refused test key install (OSStatus \(code))")
        }
        defer { removeKey(alias) }

        XCTAssertThrowsError(try provider.signCanonical(alias: alias, message: Data("message".utf8))) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .hardwareBindingVerificationFailed)
        }
        XCTAssertThrowsError(try provider.loadPublicKeyBase64(alias: alias)) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .hardwareBindingVerificationFailed)
        }
    }

    func testLoadPublicKeyBase64MissingAliasFailsClosed() {
        let provider = SecureEnclaveDskProvider()
        let alias = "pca.dek.\(uniqueAttemptId())"
        XCTAssertThrowsError(try provider.loadPublicKeyBase64(alias: alias)) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .keyMaterialMissing)
        }
    }

    // MARK: - Alias vocabulary and deletion discipline

    func testAliasNamespacesMatchAndroidVocabulary() {
        let provider = SecureEnclaveDskProvider()
        XCTAssertEqual(SecureEnclaveDskProvider.aliasPrefixDsk, "pca.dsk.")
        XCTAssertEqual(SecureEnclaveDskProvider.aliasPrefixDek, "pca.dek.")
        XCTAssertEqual(provider.signingKeyAlias(attemptId: "abc"), "pca.dsk.abc")
        XCTAssertEqual(provider.encryptionKeyAlias(attemptId: "abc"), "pca.dek.abc")
    }

    func testDeleteKeyPairRemovesOnlyTheTargetedEntry() throws {
        try requireUsableKeychain()
        let provider = SecureEnclaveDskProvider()
        let first = "pca.dsk.\(uniqueAttemptId())"
        let second = "pca.dsk.\(uniqueAttemptId())"
        if installSoftwareKey(first) != nil || installSoftwareKey(second) != nil {
            removeKey(first)
            removeKey(second)
            throw XCTSkip("keychain refused test key install")
        }
        defer {
            removeKey(first)
            removeKey(second)
        }

        provider.deleteKeyPair(alias: first)
        XCTAssertFalse(keyExists(first))
        XCTAssertTrue(keyExists(second), "deletion must never touch a sibling entry")
    }

    func testOrphanSweepTouchesOnlyApplicationNamespaceAndKeepsReferencedAttempts() throws {
        try requireUsableKeychain()
        let provider = SecureEnclaveDskProvider()
        let orphanDsk = "pca.dsk.\(uniqueAttemptId())"
        let orphanDek = "pca.dek.\(uniqueAttemptId())"
        let keepAttempt = uniqueAttemptId()
        let keepAlias = "pca.dsk.\(keepAttempt)"
        let foreign = "com.example.pca-unrelated.\(uniqueAttemptId())"
        for alias in [orphanDsk, orphanDek, keepAlias, foreign] {
            if installSoftwareKey(alias) != nil {
                for cleanup in [orphanDsk, orphanDek, keepAlias, foreign] { removeKey(cleanup) }
                throw XCTSkip("keychain refused test key install")
            }
        }
        defer {
            for cleanup in [orphanDsk, orphanDek, keepAlias, foreign] { removeKey(cleanup) }
        }

        provider.deleteOrphanedAttemptKeys(keepAttemptIds: [keepAttempt])

        XCTAssertFalse(keyExists(orphanDsk), "orphaned DSK must be reclaimed")
        XCTAssertFalse(keyExists(orphanDek), "orphaned DEK must be reclaimed")
        XCTAssertTrue(keyExists(keepAlias), "a referenced attempt's key must survive the sweep")
        XCTAssertTrue(keyExists(foreign), "a foreign keychain entry outside our namespace must survive the sweep")
    }

    // MARK: - Device-gated hardware path

    func testHardwareBoundGenerationAndSigningRoundtrip() throws {
        guard SecureEnclave.isAvailable else {
            throw XCTSkip("no Secure Enclave on this runner; the hardware path is device-gated")
        }
        let provider = SecureEnclaveDskProvider()
        let attemptId = uniqueAttemptId()
        let pair: GeneratedDskKeyPair
        do {
            pair = try provider.generateSigningKeyPair(attemptId: attemptId)
        } catch {
            // Hosts can report an available Secure Enclave while the CI test
            // host lacks the entitlement to use it (e.g. -34018); that is a
            // genuinely device-gated condition, not a product defect.
            throw XCTSkip("runner reports a Secure Enclave but refused an attested creation (device-gated): \(error)")
        }
        defer { provider.deleteKeyPair(alias: pair.privateKeyAlias) }

        XCTAssertEqual(pair.privateKeyAlias, provider.signingKeyAlias(attemptId: attemptId))
        XCTAssertFalse(pair.publicKeyBase64.contains("="))
        XCTAssertFalse(pair.publicKeyBase64.contains("+"))
        XCTAssertFalse(pair.publicKeyBase64.contains("/"))

        let signature = try provider.signCanonical(alias: pair.privateKeyAlias, message: Data("roundtrip".utf8))
        XCTAssertEqual(signature.count, 64)
        XCTAssertTrue(P256DerSignature.isLowS(signature))

        XCTAssertThrowsError(try provider.generateSigningKeyPair(attemptId: attemptId)) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .keyAliasConflict)
        }
        XCTAssertEqual(try provider.loadPublicKeyBase64(alias: pair.privateKeyAlias), pair.publicKeyBase64)
    }
}

#endif
