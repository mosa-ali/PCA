import XCTest
@testable import PCA
#if canImport(Security)
import Security
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

#if canImport(Security) && canImport(CryptoKit)

/// WAVE 6D regression coverage for the unified production device-identity
/// provider. All Secure Enclave interaction is substituted by an in-memory
/// fake, so the identity model, create-once discipline and fail-closed
/// mapping are exercised without a keychain on any runner.
final class FirstDeviceDskDeviceProofProviderTests: XCTestCase {

    private final class FakeDskKeyMaterial: FirstDeviceDskKeyMaterial {
        var generatedRoles: [String] = []
        var publicKeys: [String: String] = [:]
        var failGeneration = false
        var failEncryptionGeneration = false
        var failSigning = false
        var generationError: SecureEnclaveDskError?

        func signingKeyAlias(attemptId: String) -> String { "pca.dsk." + attemptId }
        func encryptionKeyAlias(attemptId: String) -> String { "pca.dek." + attemptId }

        func generateSigningKeyPair(attemptId: String) throws -> GeneratedDskKeyPair {
            if let generationError { throw generationError }
            if failGeneration { throw SecureEnclaveDskError.secureEnclaveUnavailable }
            let alias = signingKeyAlias(attemptId: attemptId)
            if publicKeys[alias] != nil { throw SecureEnclaveDskError.keyAliasConflict }
            generatedRoles.append("dsk:\(attemptId)")
            publicKeys[alias] = "dsk-public-\(attemptId)"
            return GeneratedDskKeyPair(publicKeyBase64: publicKeys[alias]!, privateKeyAlias: alias)
        }

        func generateEncryptionKeyPair(attemptId: String) throws -> GeneratedDskKeyPair {
            if let generationError { throw generationError }
            if failGeneration { throw SecureEnclaveDskError.secureEnclaveUnavailable }
            if failEncryptionGeneration { throw SecureEnclaveDskError.secureEnclaveUnavailable }
            let alias = encryptionKeyAlias(attemptId: attemptId)
            if publicKeys[alias] != nil { throw SecureEnclaveDskError.keyAliasConflict }
            generatedRoles.append("dek:\(attemptId)")
            publicKeys[alias] = "dek-public-\(attemptId)"
            return GeneratedDskKeyPair(publicKeyBase64: publicKeys[alias]!, privateKeyAlias: alias)
        }

        func loadPublicKeyBase64(alias: String) throws -> String {
            guard let value = publicKeys[alias] else { throw SecureEnclaveDskError.keyMaterialMissing }
            return value
        }

        func signCanonical(alias: String, message: Data) throws -> Data {
            if failSigning { throw SecureEnclaveDskError.signingFailed(-1) }
            guard publicKeys[alias] != nil else { throw SecureEnclaveDskError.keyMaterialMissing }
            return Data(repeating: 0xAB, count: 64)
        }
    }

    func testNoIdentityFailsClosedWithoutGeneratingAnything() {
        let fake = FakeDskKeyMaterial()
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake)
        XCTAssertEqual(provider.signingPublicKey, "")
        XCTAssertEqual(provider.encryptionPublicKey, "")
        XCTAssertThrowsError(try provider.sign(challenge: "nonce")) { error in
            XCTAssertEqual(error as? PCADeviceProofError, .secureKeyUnavailable)
        }
        XCTAssertTrue(fake.generatedRoles.isEmpty, "read/idle paths must never generate key material")
    }

    func testPrepareGeneratesBothRolesOnceAndExposesCanonicalKeys() throws {
        let fake = FakeDskKeyMaterial()
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake)
        try provider.prepareEnrollmentKeys(attemptId: "a1")
        XCTAssertEqual(fake.generatedRoles, ["dsk:a1", "dek:a1"])
        XCTAssertEqual(provider.signingPublicKey, "dsk-public-a1")
        XCTAssertEqual(provider.encryptionPublicKey, "dek-public-a1")

        let signature = try provider.sign(challenge: "nonce")
        XCTAssertFalse(signature.contains("+"))
        XCTAssertFalse(signature.contains("/"))
        XCTAssertFalse(signature.contains("="))
        XCTAssertEqual(signature.count, 86, "64 raw bytes must encode to 86 unpadded base64url characters")

        // Idempotent for the SAME attempt: no regeneration.
        try provider.prepareEnrollmentKeys(attemptId: "a1")
        XCTAssertEqual(fake.generatedRoles, ["dsk:a1", "dek:a1"])
    }

    func testPrepareRefusesDifferentAttemptWhileOneIsPrepared() throws {
        let fake = FakeDskKeyMaterial()
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake)
        try provider.prepareEnrollmentKeys(attemptId: "a1")
        XCTAssertThrowsError(try provider.prepareEnrollmentKeys(attemptId: "a2")) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .keyAliasConflict)
        }
        XCTAssertEqual(fake.generatedRoles, ["dsk:a1", "dek:a1"])
    }

    func testPrepareRefusesWhenCommittedRootExistsForDifferentAttempt() {
        let fake = FakeDskKeyMaterial()
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake, persistedAttemptId: { "committed" })
        XCTAssertThrowsError(try provider.prepareEnrollmentKeys(attemptId: "new")) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .keyAliasConflict)
        }
        XCTAssertTrue(fake.generatedRoles.isEmpty, "the second-root path must never generate key material")
    }

    func testPersistedAttemptActivatesIdentityWithoutPreparation() throws {
        let fake = FakeDskKeyMaterial()
        fake.publicKeys["pca.dsk.committed"] = "dsk-public-committed"
        fake.publicKeys["pca.dek.committed"] = "dek-public-committed"
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake, persistedAttemptId: { "committed" })
        XCTAssertEqual(provider.signingPublicKey, "dsk-public-committed")
        XCTAssertEqual(provider.encryptionPublicKey, "dek-public-committed")
        XCTAssertFalse(try provider.sign(challenge: "nonce").isEmpty)
        XCTAssertTrue(fake.generatedRoles.isEmpty)
    }

    func testCrashRecoveryPreparationDoesNotRegenerateForPersistedAttempt() throws {
        let fake = FakeDskKeyMaterial()
        fake.publicKeys["pca.dsk.committed"] = "dsk-public-committed"
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake, persistedAttemptId: { "committed" })
        try provider.prepareEnrollmentKeys(attemptId: "committed")
        XCTAssertTrue(fake.generatedRoles.isEmpty, "keys already exist; preparation must not regenerate")
    }

    func testCrashRecoveryReactivatesAttemptWhenBothKeysExist() throws {
        // Stage-B regression: a process death between key generation and
        // seed capture must not wedge enrollment. Both public keys exist,
        // so preparation re-activates the attempt WITHOUT regenerating.
        let fake = FakeDskKeyMaterial()
        fake.publicKeys["pca.dsk.a1"] = "dsk-public-a1"
        fake.publicKeys["pca.dek.a1"] = "dek-public-a1"
        fake.generationError = .keyAliasConflict
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake)
        try provider.prepareEnrollmentKeys(attemptId: "a1")
        XCTAssertEqual(provider.signingPublicKey, "dsk-public-a1")
        XCTAssertEqual(provider.encryptionPublicKey, "dek-public-a1")
        XCTAssertTrue(fake.generatedRoles.isEmpty)
    }

    func testCrashRecoveryCompletesMissingEncryptionKeyWithoutReplacingSigningKey() throws {
        // A process interruption after DSK generation leaves a recoverable
        // prepared attempt. Retry must preserve DSK and create only DEK.
        let fake = FakeDskKeyMaterial()
        fake.failEncryptionGeneration = true
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake)
        XCTAssertThrowsError(try provider.prepareEnrollmentKeys(attemptId: "a1")) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .secureEnclaveUnavailable)
        }
        let originalSigningKey = fake.publicKeys["pca.dsk.a1"]
        XCTAssertEqual(originalSigningKey, "dsk-public-a1")
        XCTAssertNil(fake.publicKeys["pca.dek.a1"])

        fake.failEncryptionGeneration = false
        try provider.prepareEnrollmentKeys(attemptId: "a1")
        XCTAssertEqual(provider.signingPublicKey, originalSigningKey)
        XCTAssertEqual(provider.encryptionPublicKey, "dek-public-a1")
        XCTAssertEqual(fake.generatedRoles, ["dsk:a1", "dek:a1"])
    }

    func testSecureEnclaveFailurePropagatesWithoutLeavingPreparedState() throws {
        let fake = FakeDskKeyMaterial()
        fake.failGeneration = true
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake)
        XCTAssertThrowsError(try provider.prepareEnrollmentKeys(attemptId: "a1")) { error in
            XCTAssertEqual(error as? SecureEnclaveDskError, .secureEnclaveUnavailable)
        }
        XCTAssertEqual(provider.signingPublicKey, "", "a failed preparation must not activate an identity")

        fake.failGeneration = false
        try provider.prepareEnrollmentKeys(attemptId: "a1")
        XCTAssertEqual(provider.signingPublicKey, "dsk-public-a1")
    }

    func testSigningFailureCollapsesToTypedRefusal() throws {
        let fake = FakeDskKeyMaterial()
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake)
        try provider.prepareEnrollmentKeys(attemptId: "a1")
        fake.failSigning = true
        XCTAssertThrowsError(try provider.sign(challenge: "nonce")) { error in
            XCTAssertEqual(error as? PCADeviceProofError, .secureKeyUnavailable)
        }
    }

    func testClearPreparedAttemptFallsBackToPersistedIdentity() throws {
        let fake = FakeDskKeyMaterial()
        fake.publicKeys["pca.dsk.committed"] = "dsk-public-committed"
        fake.publicKeys["pca.dek.committed"] = "dek-public-committed"
        let provider = FirstDeviceDskDeviceProofProvider(provider: fake, persistedAttemptId: { "committed" })
        // Crash-recovery preparation of the PERSISTED attempt is legal and
        // regenerates nothing; preparing a DIFFERENT attempt while a root
        // exists is refused (second-root guard) and is covered separately.
        try provider.prepareEnrollmentKeys(attemptId: "committed")
        XCTAssertEqual(provider.signingPublicKey, "dsk-public-committed")
        provider.clearPreparedAttempt()
        XCTAssertEqual(provider.signingPublicKey, "dsk-public-committed")
    }

    func testSharedReferenceIdentityIsOneObjectWithSharedState() throws {
        let fake = FakeDskKeyMaterial()
        let unified = FirstDeviceDskDeviceProofProvider(provider: fake)
        let sessionClientView: PCADeviceProofProvider = unified
        let dependencyView: PCADeviceProofProvider = unified
        XCTAssertTrue((sessionClientView as AnyObject) === (dependencyView as AnyObject))

        try unified.prepareEnrollmentKeys(attemptId: "a1")
        XCTAssertEqual(sessionClientView.signingPublicKey, "dsk-public-a1")
        XCTAssertEqual(dependencyView.signingPublicKey, "dsk-public-a1")
    }
}

#endif
