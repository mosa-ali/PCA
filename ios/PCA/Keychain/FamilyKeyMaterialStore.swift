import Foundation

/// doc 09 Section 2/3: Device Signing Key (DSK) and Device Encryption Key
/// (DEK) are distinct key material for the same device identity, never
/// interchangeable -- mirroring the same DSK/DEK role separation the
/// backend enforces (backend/src/familytrustset). This type stores each
/// under its OWN Keychain account/service pair so they can never collide
/// or be silently substituted for one another.
///
/// Key BYTES themselves are fully opaque here -- this store never
/// generates, derives, signs, or encrypts with them. Production key
/// generation/algorithm selection is `CRYPTO_SUITE =
/// PENDING_HUMAN_SECURITY_REVIEW`, unaffected by this file.
public enum FamilyKeyMaterialKind: String {
    case deviceSigningKey = "dsk"
    case deviceEncryptionKey = "dek"
    case familyDataEncryptionKey = "fdek"
}

public struct FamilyKeyMaterialStore {
    private let keychain: KeychainStoreProtocol
    private let serviceNamespace: String

    /// `serviceNamespace` scopes the Keychain `service` attribute (e.g. a
    /// reverse-DNS bundle identifier) so this app's key material can never
    /// collide with another app's items even on a shared device Keychain.
    public init(keychain: KeychainStoreProtocol, serviceNamespace: String) {
        self.keychain = keychain
        self.serviceNamespace = serviceNamespace
    }

    private func service(for kind: FamilyKeyMaterialKind) -> String {
        "\(serviceNamespace).keymaterial.\(kind.rawValue)"
    }

    /// `deviceId` is the opaque device identifier the backend already
    /// assigns (same value as `OpaqueDeviceId` in
    /// backend/src/familyenvelope/types.ts) -- reused as the Keychain
    /// `account`, not a new identity scheme.
    public func store(_ keyBytes: Data, kind: FamilyKeyMaterialKind, deviceId: String, accessibility: KeychainAccessibility = .whenUnlockedThisDeviceOnly) throws {
        try keychain.store(keyBytes, forAccount: deviceId, service: service(for: kind), accessibility: accessibility)
    }

    public func retrieve(kind: FamilyKeyMaterialKind, deviceId: String) throws -> Data {
        try keychain.retrieve(forAccount: deviceId, service: service(for: kind))
    }

    /// Used on authorized device/family removal (doc 08 Section 8, doc 11
    /// Section 7) -- deletes the local key material so it can no longer
    /// sign/decrypt on this device going forward. Never claims this alone
    /// achieves forensic erasure of the underlying flash cell (doc 11
    /// Section 9's same honest limitation applies to Keychain-backed
    /// storage as to any other on-device store).
    public func delete(kind: FamilyKeyMaterialKind, deviceId: String) throws {
        try keychain.delete(forAccount: deviceId, service: service(for: kind))
    }
}
