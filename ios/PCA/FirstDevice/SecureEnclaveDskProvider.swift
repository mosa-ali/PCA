import Foundation
#if canImport(Security)
import Security
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// Result of one create-once key generation: only the public half (canonical
/// SEC1 uncompressed, unpadded base64url) and an opaque alias referencing
/// where the non-exportable private key lives.
public struct GeneratedDskKeyPair: Equatable {
    public let publicKeyBase64: String
    public let privateKeyAlias: String

    public init(publicKeyBase64: String, privateKeyAlias: String) {
        self.publicKeyBase64 = publicKeyBase64
        self.privateKeyAlias = privateKeyAlias
    }
}

/// WAVE 6D: typed, fail-closed failures of the Secure Enclave DSK/DEK
/// provider. Every case is caller-visible; no case ever means "a software
/// key was silently substituted".
public enum SecureEnclaveDskError: Error, Equatable {
    /// No Secure Enclave on this hardware. Fail closed: a software-only key
    /// may never enter the trust-root path.
    case secureEnclaveUnavailable
    /// The attempt-scoped alias already exists. Keys are create-once; silent
    /// regeneration or reuse is forbidden.
    case keyAliasConflict
    /// Key generation failed inside the platform (OSStatus / CFError code).
    case keyGenerationFailed(Int32)
    /// A key was created but is NOT Secure-Enclave-bound (or its public half
    /// is not canonical 65-byte SEC1). The entry is deleted and refused.
    case hardwareBindingVerificationFailed
    /// Required key material is absent (or unreadable). Fail closed: NEVER
    /// regenerate as a "recovery" -- a replacement DSK cannot be the
    /// enrolled DSK, and a replacement after a committed root is exactly
    /// the forbidden second-root path.
    case keyMaterialMissing
    /// The signing operation failed inside the platform.
    case signingFailed(Int32)
    /// The platform returned a signature that is not canonical DER /
    /// P-256-ranged. Internal invariant violation; never repaired.
    case malformedSignature
    /// Caller bug: the attempt id must not be empty.
    case invalidAttemptId
}

/// Generates a device's Signing Key pair (DSK) or Encryption Key pair
/// (DEK). DSK and DEK are always distinct roles and MUST be generated as
/// separate key pairs, never derived from one another or reused across
/// roles (mirrors the DSK/DEK role separation enforced server-side).
/// `attemptId` scopes BOTH aliases of one enrollment attempt
/// (`pca.dsk.<attemptId>` / `pca.dek.<attemptId>`, the same alias
/// namespace vocabulary the Android provider uses).
public protocol FirstDeviceKeyPairGenerating {
    func generateSigningKeyPair(attemptId: String) throws -> GeneratedDskKeyPair
    func generateEncryptionKeyPair(attemptId: String) throws -> GeneratedDskKeyPair
}

/// Raw DSK signing operation used by the first-device trust-root ceremony
/// (bootstrap proof + epoch-1) and, afterwards, by runtime-sync session
/// proofs. Implementations sign inside the key's own hardware boundary and
/// return the canonicalized IEEE-P1363 fixed-width 64-byte low-S form
/// (see `P256DerSignature`), unpadded base64url applied by callers.
public protocol FirstDeviceDskSigning {
    func signCanonical(alias: String, message: Data) throws -> Data
}

/// Deletion capability for device key material, kept as a SEPARATE protocol
/// (not added to `FirstDeviceKeyPairGenerating`) so every generator
/// implementation stays valid without pretending to support deletion.
public protocol FirstDeviceKeyPairDeletion {
    /// Deletes the single key entry behind `alias` if present (best-effort;
    /// used by failure cleanup and the orphan sweep). Never touches
    /// anything else.
    func deleteKeyPair(alias: String)

    /// Deletes every key material entry this application owns whose alias is
    /// scoped to an attempt id NOT in `keepAttemptIds` (prefix scan over the
    /// app's own `pca.dsk.` / `pca.dek.` alias namespace only). Used to
    /// reclaim keys orphaned by a process death between generation and the
    /// durable attempt record write. Must never touch aliases referenced by
    /// a live or committed record, and never a foreign keychain entry.
    func deleteOrphanedAttemptKeys(keepAttemptIds: Set<String>)
}

#if canImport(Security) && canImport(CryptoKit)

/// WAVE 6D: the REAL production DSK/DEK provider -- the iOS side of the
/// first-device trust root, the counterpart of Android's
/// `AndroidKeystoreDskProvider` (Wave 6C).
///
/// CUSTODY PROPERTIES (each verified by tests, not assumed):
///  - Keys are generated INSIDE the Secure Enclave
///    (`kSecAttrTokenIDSecureEnclave`, P-256, `SecAccessControl` with
///    `.privateKeyUsage`, `whenUnlockedThisDeviceOnly`). Private key
///    material never exists outside the Secure Enclave; this class has no
///    code path that reads, exports, wraps, or copies a private key.
///  - No Secure Enclave (or a creation failure) is a TYPED failure, never a
///    silent software fallback: [generateSigningKeyPair] /
///    [generateEncryptionKeyPair] throw
///    [SecureEnclaveDskError.secureEnclaveUnavailable] /
///    [SecureEnclaveDskError.keyGenerationFailed] and store NOTHING.
///  - HARDWARE ASSERTION after generation: the created key's attributes
///    must carry `kSecAttrTokenIDSecureEnclave` and its public half must be
///    canonical 65-byte SEC1 `0x04 || X || Y`; otherwise the entry is
///    DELETED and refused. A software-only key can never enter the
///    trust-root path.
///  - CREATE-ONCE: generation refuses to run when the attempt-scoped alias
///    already exists ([SecureEnclaveDskError.keyAliasConflict]) -- no
///    silent regeneration, ever. Signing a missing alias is
///    [SecureEnclaveDskError.keyMaterialMissing]; callers must never
///    "recover" by generating a replacement key.
///
/// The class intentionally implements three narrow protocols because every
/// one of them is a view of the SAME Secure Enclave / Keychain boundary;
/// splitting it further would multiply that boundary, not reduce it.
public final class SecureEnclaveDskProvider: FirstDeviceKeyPairGenerating, FirstDeviceDskSigning, FirstDeviceKeyPairDeletion {

    /// Alias namespaces this application owns; the only prefixes orphan
    /// cleanup ever touches. Same strings as Android's provider.
    public static let aliasPrefixDsk = "pca.dsk."
    public static let aliasPrefixDek = "pca.dek."

    private enum KeyRole {
        case dsk
        case dek
    }

    private let secureEnclaveAvailability: () -> Bool
    private let lock = NSLock()

    /// `secureEnclaveAvailability` is injectable ONLY so fail-closed paths
    /// are testable on simulators; production composition uses the default
    /// real check.
    public init(secureEnclaveAvailability: @escaping () -> Bool = { SecureEnclave.isAvailable }) {
        self.secureEnclaveAvailability = secureEnclaveAvailability
    }

    /// Alias for the DSK of one attempt; deterministic, non-secret, safe to
    /// persist.
    public func signingKeyAlias(attemptId: String) -> String {
        Self.aliasPrefixDsk + attemptId
    }

    /// Alias for the DEK of one attempt.
    public func encryptionKeyAlias(attemptId: String) -> String {
        Self.aliasPrefixDek + attemptId
    }

    // MARK: - FirstDeviceKeyPairGenerating

    public func generateSigningKeyPair(attemptId: String) throws -> GeneratedDskKeyPair {
        try generate(role: .dsk, attemptId: attemptId)
    }

    public func generateEncryptionKeyPair(attemptId: String) throws -> GeneratedDskKeyPair {
        try generate(role: .dek, attemptId: attemptId)
    }

    private func generate(role: KeyRole, attemptId: String) throws -> GeneratedDskKeyPair {
        guard !attemptId.isEmpty else { throw SecureEnclaveDskError.invalidAttemptId }
        let alias = role == .dsk ? signingKeyAlias(attemptId: attemptId) : encryptionKeyAlias(attemptId: attemptId)
        lock.lock()
        defer { lock.unlock() }

        // Environment gate FIRST: without a Secure Enclave nothing below may
        // run -- not even a keychain consultation (a host without the SE
        // keychain entitlement reports -34018 for key-class queries, which
        // must never be mistaken for a key-material decision).
        guard secureEnclaveAvailability() else {
            throw SecureEnclaveDskError.secureEnclaveUnavailable
        }
        if try keyExists(alias: alias) {
            throw SecureEnclaveDskError.keyAliasConflict
        }
        let privateKey = try createSecureEnclaveKey(alias: alias)
        guard isSecureEnclaveBound(privateKey) else {
            deleteKeyPair(alias: alias)
            throw SecureEnclaveDskError.hardwareBindingVerificationFailed
        }
        let publicKeyBase64: String
        do {
            publicKeyBase64 = try canonicalPublicKeyBase64(of: privateKey)
        } catch {
            deleteKeyPair(alias: alias)
            throw error
        }
        return GeneratedDskKeyPair(publicKeyBase64: publicKeyBase64, privateKeyAlias: alias)
    }

    // MARK: - FirstDeviceDskSigning

    public func signCanonical(alias: String, message: Data) throws -> Data {
        guard let privateKey = try loadPrivateKey(alias: alias) else {
            throw SecureEnclaveDskError.keyMaterialMissing
        }
        // Sign-time hardware assertion (the iOS equivalent of Android's
        // AndroidKeyStore structural guarantee): key material that is not
        // Secure-Enclave-bound can NEVER produce a trust-root signature,
        // even if such an entry were present under our alias namespace.
        guard isSecureEnclaveBound(privateKey) else {
            throw SecureEnclaveDskError.hardwareBindingVerificationFailed
        }
        var error: Unmanaged<CFError>?
        guard let der = SecKeyCreateSignature(
            privateKey,
            .ecdsaSignatureMessageX962SHA256,
            message as CFData,
            &error
        ) as Data? else {
            throw SecureEnclaveDskError.signingFailed(cfErrorCode(error))
        }
        do {
            return try P256DerSignature.toLowSIeeeP1363(der: der)
        } catch {
            throw SecureEnclaveDskError.malformedSignature
        }
    }

    // MARK: - Public-key access

    /// Canonical SEC1 uncompressed (65 bytes, unpadded base64url) public half
    /// of the key behind `alias`. Throws
    /// [SecureEnclaveDskError.keyMaterialMissing] when absent -- never
    /// generates anything.
    public func loadPublicKeyBase64(alias: String) throws -> String {
        guard let privateKey = try loadPrivateKey(alias: alias) else {
            throw SecureEnclaveDskError.keyMaterialMissing
        }
        guard isSecureEnclaveBound(privateKey) else {
            throw SecureEnclaveDskError.hardwareBindingVerificationFailed
        }
        return try canonicalPublicKeyBase64(of: privateKey)
    }

    // MARK: - FirstDeviceKeyPairDeletion

    public func deleteKeyPair(alias: String) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrApplicationTag: tagData(alias: alias),
        ]
        _ = SecItemDelete(query as CFDictionary)
    }

    public func deleteOrphanedAttemptKeys(keepAttemptIds: Set<String>) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecReturnAttributes: true,
            kSecMatchLimit: kSecMatchLimitAll,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let items = result as? [[String: Any]] else { return }
        for item in items {
            guard let tagData = item[kSecAttrApplicationTag as String] as? Data,
                  let tag = String(data: tagData, encoding: .utf8) else { continue }
            let attemptId: String?
            if tag.hasPrefix(Self.aliasPrefixDsk) {
                attemptId = String(tag.dropFirst(Self.aliasPrefixDsk.count))
            } else if tag.hasPrefix(Self.aliasPrefixDek) {
                attemptId = String(tag.dropFirst(Self.aliasPrefixDek.count))
            } else {
                attemptId = nil
            }
            guard let attemptId = attemptId, !attemptId.isEmpty else { continue }
            if !keepAttemptIds.contains(attemptId) {
                deleteKeyPair(alias: tag)
            }
        }
    }

    // MARK: - Secure Enclave boundary

    private func createSecureEnclaveKey(alias: String) throws -> SecKey {
        var accessControlError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .privateKeyUsage,
            &accessControlError
        ) else {
            throw SecureEnclaveDskError.keyGenerationFailed(cfErrorCode(accessControlError))
        }
        let attributes: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: 256,
            kSecAttrTokenID: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs: [
                kSecAttrIsPermanent: true,
                kSecAttrApplicationTag: tagData(alias: alias),
                kSecAttrAccessControl: accessControl,
            ] as [CFString: Any],
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw SecureEnclaveDskError.keyGenerationFailed(cfErrorCode(error))
        }
        return key
    }

    private func keyExists(alias: String) throws -> Bool {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrApplicationTag: tagData(alias: alias),
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        if status == errSecSuccess { return true }
        if status == errSecItemNotFound { return false }
        throw SecureEnclaveDskError.keyGenerationFailed(status)
    }

    /// Loads the private key behind `alias`; `nil` when no such item exists.
    /// Any other keychain failure is reported as
    /// [SecureEnclaveDskError.keyMaterialMissing] -- mirroring Android's
    /// typed posture: an unreadable device key is NEVER a regeneration
    /// trigger.
    private func loadPrivateKey(alias: String) throws -> SecKey? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrApplicationTag: tagData(alias: alias),
            kSecReturnRef: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw SecureEnclaveDskError.keyMaterialMissing
        }
        guard let item = item, CFGetTypeID(item) == SecKeyGetTypeID() else {
            throw SecureEnclaveDskError.keyMaterialMissing
        }
        // The type-ID check above proves this is a SecKey; the bitcast avoids
        // Swift's "downcast to CoreFoundation type will always succeed"
        // diagnostic for CFTypeRef -> SecKey.
        return unsafeBitCast(item, to: SecKey.self)
    }

    private func isSecureEnclaveBound(_ key: SecKey) -> Bool {
        guard let attributes = SecKeyCopyAttributes(key) as? [String: Any],
              let token = attributes[kSecAttrTokenID as String] as? String else {
            return false
        }
        return token == (kSecAttrTokenIDSecureEnclave as String)
    }

    private func canonicalPublicKeyBase64(of privateKey: SecKey) throws -> String {
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw SecureEnclaveDskError.hardwareBindingVerificationFailed
        }
        var error: Unmanaged<CFError>?
        guard let representation = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw SecureEnclaveDskError.keyGenerationFailed(cfErrorCode(error))
        }
        let bytes = [UInt8](representation)
        guard bytes.count == 65, bytes[0] == 0x04 else {
            throw SecureEnclaveDskError.hardwareBindingVerificationFailed
        }
        return FirstDeviceCanonical.base64Url(representation)
    }

    private func tagData(alias: String) -> Data {
        Data(alias.utf8)
    }

    private func cfErrorCode(_ error: Unmanaged<CFError>?) -> Int32 {
        guard let error = error else { return errSecInternalError }
        return Int32(CFErrorGetCode(error.takeRetainedValue()))
    }
}

#endif
