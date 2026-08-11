import Foundation
#if canImport(Security)
import Security
#endif

/// doc 07 Section 12 / doc 09 Section 2: Keychain storage for Device
/// Signing Key (DSK) / Device Encryption Key (DEK) / family encryption
/// material, using an access-control level appropriate to sensitivity --
/// `whenUnlockedThisDeviceOnly` (or stronger) by default, never
/// iCloud-Keychain-synchronizable, unless a specific, separately-reviewed
/// multi-device key-sync design says otherwise (doc 09 owns that
/// decision; this type only implements the STORAGE placement doc 07
/// states).
///
/// This module NEVER selects a cryptographic algorithm, generates key
/// material, or performs signing/encryption -- it only stores/retrieves
/// opaque key bytes the (separately, externally reviewed) crypto layer
/// hands it. `CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW` is unaffected
/// by this file.
public enum KeychainAccessibility {
    /// Default for DSK/DEK/family key material per doc 07 Section 12:
    /// accessible only while the device is unlocked, never migrates to a
    /// new device via iCloud Keychain backup/sync.
    case whenUnlockedThisDeviceOnly
    /// Reserved for a future, separately-reviewed multi-device key-sync
    /// design (doc 09) -- deliberately not used by any adapter in this
    /// file today.
    case whenUnlockedSynchronizable

    #if canImport(Security)
    var secAttribute: CFString {
        switch self {
        case .whenUnlockedThisDeviceOnly: return kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        case .whenUnlockedSynchronizable: return kSecAttrAccessibleWhenUnlocked
        }
    }
    var isSynchronizable: Bool {
        self == .whenUnlockedSynchronizable
    }
    #endif
}

public enum KeychainStoreError: Error, Equatable {
    case unexpectedStatus(OSStatus)
    case itemNotFound
}

/// Narrow protocol so callers (and this file's own logic-level tests) do
/// not depend on the real Keychain being available -- Windows has no
/// Security.framework at all, so `SystemKeychainStore` below is compiled
/// out entirely there; `InMemoryKeychainStore` is what this workspace's
/// tests exercise, proving the CONTRACT (write-then-read round trip,
/// distinct-key isolation, accessibility attribute is honored in the
/// query) without needing the real API.
public protocol KeychainStoreProtocol {
    func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws
    func retrieve(forAccount account: String, service: String) throws -> Data
    func delete(forAccount account: String, service: String) throws
}

#if canImport(Security)
public final class SystemKeychainStore: KeychainStoreProtocol {
    public init() {}

    public func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
        // Remove any existing item first -- SecItemAdd fails on a
        // duplicate; this makes `store` idempotently overwrite rather than
        // erroring on a second call for the same identity, matching how a
        // key-rotation flow would naturally re-store under the same
        // account/service pair.
        try? delete(forAccount: account, service: service)

        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: account,
            kSecAttrService: service,
            kSecValueData: data,
            kSecAttrAccessible: accessibility.secAttribute,
        ]
        query[kSecAttrSynchronizable] = accessibility.isSynchronizable

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainStoreError.unexpectedStatus(status)
        }
    }

    public func retrieve(forAccount account: String, service: String) throws -> Data {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: account,
            kSecAttrService: service,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            throw KeychainStoreError.itemNotFound
        }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainStoreError.unexpectedStatus(status)
        }
        return data
    }

    public func delete(forAccount account: String, service: String) throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: account,
            kSecAttrService: service,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainStoreError.unexpectedStatus(status)
        }
    }
}
#endif

extension KeychainAccessibility: Equatable {}

/// In-memory conformance for tests/previews. Never used by a shipping
/// code path -- `FamilyKeyMaterialStore` (see FamilyKeyMaterialStore.swift)
/// always receives `SystemKeychainStore` in production wiring.
public final class InMemoryKeychainStore: KeychainStoreProtocol {
    private struct Key: Hashable { let account: String; let service: String }
    private var storage: [Key: (data: Data, accessibility: KeychainAccessibility)] = [:]

    public init() {}

    public func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
        storage[Key(account: account, service: service)] = (data, accessibility)
    }

    public func retrieve(forAccount account: String, service: String) throws -> Data {
        guard let entry = storage[Key(account: account, service: service)] else {
            throw KeychainStoreError.itemNotFound
        }
        return entry.data
    }

    public func delete(forAccount account: String, service: String) throws {
        storage.removeValue(forKey: Key(account: account, service: service))
    }

    /// Test-only introspection -- proves an item was stored with the
    /// expected accessibility level without needing the real Keychain.
    public func storedAccessibility(forAccount account: String, service: String) -> KeychainAccessibility? {
        storage[Key(account: account, service: service)]?.accessibility
    }
}
