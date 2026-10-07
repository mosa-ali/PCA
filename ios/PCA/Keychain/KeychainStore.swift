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
    /// Replaces an existing item without deleting it first. Production
    /// Keychain implementations should update in place and add only when
    /// absent, so a failed update/add never destroys the prior value.
    func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws
    func retrieve(forAccount account: String, service: String) throws -> Data
    func delete(forAccount account: String, service: String) throws
}

public extension KeychainStoreProtocol {
    /// Compatibility default for existing adapters. The system adapter
    /// below overrides this with SecItemUpdate/SecItemAdd semantics.
    func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
        try store(data, forAccount: account, service: service, accessibility: accessibility)
    }
}

#if canImport(Security)
public final class SystemKeychainStore: KeychainStoreProtocol {
    private let updateItem: (CFDictionary, CFDictionary) -> OSStatus
    private let addItem: (CFDictionary) -> OSStatus
    private let deleteItem: (CFDictionary) -> OSStatus

    public convenience init() {
        self.init(updateItem: { SecItemUpdate($0, $1) },
                  addItem: { SecItemAdd($0, nil) },
                  deleteItem: { SecItemDelete($0) })
    }

    /// Internal seam for exercising platform failures without modifying the real Keychain.
    init(updateItem: @escaping (CFDictionary, CFDictionary) -> OSStatus,
         addItem: @escaping (CFDictionary) -> OSStatus,
         deleteItem: @escaping (CFDictionary) -> OSStatus) {
        self.updateItem = updateItem
        self.addItem = addItem
        self.deleteItem = deleteItem
    }

    public func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
        // Failed replacement must preserve enrolled credentials and recovery material.
        try storeReplacingAtomically(data, forAccount: account, service: service, accessibility: accessibility)
    }

    public func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
        let identityQuery: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: account,
            kSecAttrService: service,
            kSecAttrSynchronizable: accessibility.isSynchronizable,
        ]
        let attributes: [CFString: Any] = [
            kSecValueData: data,
            kSecAttrAccessible: accessibility.secAttribute,
        ]

        let updateStatus = updateItem(identityQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainStoreError.unexpectedStatus(updateStatus)
        }

        var addQuery = identityQuery
        addQuery[kSecValueData] = data
        addQuery[kSecAttrAccessible] = accessibility.secAttribute
        let addStatus = addItem(addQuery as CFDictionary)
        if addStatus == errSecSuccess { return }
        // Another writer may have added the same identity between update
        // and add. Retry update once; neither path removes the existing row.
        if addStatus == errSecDuplicateItem {
            let retryStatus = updateItem(identityQuery as CFDictionary, attributes as CFDictionary)
            if retryStatus == errSecSuccess { return }
            throw KeychainStoreError.unexpectedStatus(retryStatus)
        }
        throw KeychainStoreError.unexpectedStatus(addStatus)
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
        let status = deleteItem(query as CFDictionary)
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
