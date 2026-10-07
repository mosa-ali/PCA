import XCTest
#if canImport(Security)
import Security
#endif
@testable import PCA

final class KeychainStoreTests: XCTestCase {
    func testWriteThenReadRoundTrip() throws {
        let store = InMemoryKeychainStore()
        let data = Data("dsk-bytes".utf8)
        try store.store(data, forAccount: "device-1", service: "com.pca.keymaterial.dsk", accessibility: .whenUnlockedThisDeviceOnly)
        let read = try store.retrieve(forAccount: "device-1", service: "com.pca.keymaterial.dsk")
        XCTAssertEqual(read, data)
    }

    func testRetrieveMissingItemThrowsItemNotFound() {
        let store = InMemoryKeychainStore()
        XCTAssertThrowsError(try store.retrieve(forAccount: "missing", service: "svc")) { error in
            XCTAssertEqual(error as? KeychainStoreError, .itemNotFound)
        }
    }

    func testDistinctAccountsNeverCollide() throws {
        let store = InMemoryKeychainStore()
        try store.store(Data("device-1-key".utf8), forAccount: "device-1", service: "svc", accessibility: .whenUnlockedThisDeviceOnly)
        try store.store(Data("device-2-key".utf8), forAccount: "device-2", service: "svc", accessibility: .whenUnlockedThisDeviceOnly)
        XCTAssertEqual(try store.retrieve(forAccount: "device-1", service: "svc"), Data("device-1-key".utf8))
        XCTAssertEqual(try store.retrieve(forAccount: "device-2", service: "svc"), Data("device-2-key".utf8))
    }

    func testDistinctServicesForSameAccountNeverCollide() throws {
        let store = InMemoryKeychainStore()
        try store.store(Data("signing-key".utf8), forAccount: "device-1", service: "svc.dsk", accessibility: .whenUnlockedThisDeviceOnly)
        try store.store(Data("encryption-key".utf8), forAccount: "device-1", service: "svc.dek", accessibility: .whenUnlockedThisDeviceOnly)
        XCTAssertEqual(try store.retrieve(forAccount: "device-1", service: "svc.dsk"), Data("signing-key".utf8))
        XCTAssertEqual(try store.retrieve(forAccount: "device-1", service: "svc.dek"), Data("encryption-key".utf8))
    }

    func testDeleteRemovesTheItem() throws {
        let store = InMemoryKeychainStore()
        try store.store(Data("x".utf8), forAccount: "device-1", service: "svc", accessibility: .whenUnlockedThisDeviceOnly)
        try store.delete(forAccount: "device-1", service: "svc")
        XCTAssertThrowsError(try store.retrieve(forAccount: "device-1", service: "svc"))
    }

    func testAccessibilityContractDefaultsToThisDeviceOnlyForKeyMaterial() throws {
        // doc 07 Section 12: DSK/DEK/family key material MUST use
        // ThisDeviceOnly (non-synchronizing) protection by default.
        let store = InMemoryKeychainStore()
        let keyMaterial = FamilyKeyMaterialStore(keychain: store, serviceNamespace: "com.pca.app")
        try keyMaterial.store(Data("dsk-bytes".utf8), kind: .deviceSigningKey, deviceId: "device-1")
        XCTAssertEqual(store.storedAccessibility(forAccount: "device-1", service: "com.pca.app.keymaterial.dsk"), .whenUnlockedThisDeviceOnly)
    }

    func testDSKAndDEKAreStoredUnderDistinctServicesAndNeverInterchangeable() throws {
        let store = InMemoryKeychainStore()
        let keyMaterial = FamilyKeyMaterialStore(keychain: store, serviceNamespace: "com.pca.app")
        try keyMaterial.store(Data("dsk".utf8), kind: .deviceSigningKey, deviceId: "device-1")
        try keyMaterial.store(Data("dek".utf8), kind: .deviceEncryptionKey, deviceId: "device-1")

        XCTAssertEqual(try keyMaterial.retrieve(kind: .deviceSigningKey, deviceId: "device-1"), Data("dsk".utf8))
        XCTAssertEqual(try keyMaterial.retrieve(kind: .deviceEncryptionKey, deviceId: "device-1"), Data("dek".utf8))
        XCTAssertNotEqual(
            try keyMaterial.retrieve(kind: .deviceSigningKey, deviceId: "device-1"),
            try keyMaterial.retrieve(kind: .deviceEncryptionKey, deviceId: "device-1")
        )
    }

    func testKeyMaterialForDifferentDevicesIsFullyIsolated() throws {
        let store = InMemoryKeychainStore()
        let keyMaterial = FamilyKeyMaterialStore(keychain: store, serviceNamespace: "com.pca.app")
        try keyMaterial.store(Data("device-1-dsk".utf8), kind: .deviceSigningKey, deviceId: "device-1")
        try keyMaterial.store(Data("device-2-dsk".utf8), kind: .deviceSigningKey, deviceId: "device-2")
        XCTAssertEqual(try keyMaterial.retrieve(kind: .deviceSigningKey, deviceId: "device-1"), Data("device-1-dsk".utf8))
        XCTAssertEqual(try keyMaterial.retrieve(kind: .deviceSigningKey, deviceId: "device-2"), Data("device-2-dsk".utf8))
    }

    func testKeyMaterialDeletionRemovesOnlyTheTargetedKind() throws {
        let store = InMemoryKeychainStore()
        let keyMaterial = FamilyKeyMaterialStore(keychain: store, serviceNamespace: "com.pca.app")
        try keyMaterial.store(Data("dsk".utf8), kind: .deviceSigningKey, deviceId: "device-1")
        try keyMaterial.store(Data("dek".utf8), kind: .deviceEncryptionKey, deviceId: "device-1")
        try keyMaterial.delete(kind: .deviceSigningKey, deviceId: "device-1")
        XCTAssertThrowsError(try keyMaterial.retrieve(kind: .deviceSigningKey, deviceId: "device-1"))
        XCTAssertEqual(try keyMaterial.retrieve(kind: .deviceEncryptionKey, deviceId: "device-1"), Data("dek".utf8))
    }
}

#if canImport(Security)
private final class KeychainReplacementProbe {
    var stored: Data? = Data("enrolled-secret".utf8)
    var concurrentInsertionBeforeAdd: Data?
    var updateQueries: [NSDictionary] = []
    var updateAttributes: [NSDictionary] = []
    var addQueries: [NSDictionary] = []
    var updateStatuses: [OSStatus] = []
    var addStatus: OSStatus = errSecSuccess
    var calls: [String] = []

    func makeStore() -> SystemKeychainStore {
        SystemKeychainStore(updateItem: { [self] query, attributes in
            calls.append("update")
            updateQueries.append(query as NSDictionary)
            updateAttributes.append(attributes as NSDictionary)
            let status = updateStatuses.removeFirst()
            if status == errSecItemNotFound { XCTAssertNil(stored) }
            if status == errSecSuccess {
                stored = (attributes as NSDictionary)[kSecValueData] as! Data
            }
            return status
        }, addItem: { [self] query in
            calls.append("add")
            addQueries.append(query as NSDictionary)
            if let concurrentInsertionBeforeAdd { stored = concurrentInsertionBeforeAdd }
            if addStatus == errSecSuccess {
                stored = (query as NSDictionary)[kSecValueData] as! Data
            }
            return addStatus
        }, deleteItem: { [self] _ in
            calls.append("delete")
            stored = nil
            return errSecSuccess
        })
    }
}

extension KeychainStoreTests {
    private func assertReplacementQueries(_ probe: KeychainReplacementProbe, file: StaticString = #filePath, line: UInt = #line) {
        for query in probe.updateQueries + probe.addQueries {
            XCTAssertEqual(query[kSecClass] as? String, kSecClassGenericPassword as String, file: file, line: line)
            XCTAssertEqual(query[kSecAttrAccount] as? String, "device", file: file, line: line)
            XCTAssertEqual(query[kSecAttrService] as? String, "session", file: file, line: line)
            XCTAssertEqual(query[kSecAttrSynchronizable] as? Bool, false, file: file, line: line)
        }
        for attributes in probe.updateAttributes + probe.addQueries {
            XCTAssertEqual(attributes[kSecValueData] as? Data, Data("replacement".utf8), file: file, line: line)
            XCTAssertEqual(attributes[kSecAttrAccessible] as? String, kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String, file: file, line: line)
        }
    }

    func testSystemStorePreservesEnrolledSecretWhenUpdateFails() {
        let probe = KeychainReplacementProbe()
        probe.updateStatuses = [errSecInteractionNotAllowed]
        XCTAssertThrowsError(try probe.makeStore().store(Data("replacement".utf8), forAccount: "device", service: "session", accessibility: .whenUnlockedThisDeviceOnly)) {
            XCTAssertEqual($0 as? KeychainStoreError, .unexpectedStatus(errSecInteractionNotAllowed))
        }
        XCTAssertEqual(probe.stored, Data("enrolled-secret".utf8))
        XCTAssertEqual(probe.calls, ["update"])
        assertReplacementQueries(probe)
    }

    func testSystemStorePreservesConcurrentInsertionWhenAddFails() {
        let probe = KeychainReplacementProbe()
        probe.stored = nil
        probe.concurrentInsertionBeforeAdd = Data("enrolled-secret".utf8)
        probe.updateStatuses = [errSecItemNotFound]
        probe.addStatus = errSecNotAvailable
        XCTAssertThrowsError(try probe.makeStore().store(Data("replacement".utf8), forAccount: "device", service: "session", accessibility: .whenUnlockedThisDeviceOnly)) {
            XCTAssertEqual($0 as? KeychainStoreError, .unexpectedStatus(errSecNotAvailable))
        }
        XCTAssertEqual(probe.stored, Data("enrolled-secret".utf8))
        XCTAssertEqual(probe.calls, ["update", "add"])
        assertReplacementQueries(probe)
    }

    func testSystemStoreRetriesConcurrentInsertionWithoutDeleting() throws {
        let probe = KeychainReplacementProbe()
        probe.stored = nil
        probe.concurrentInsertionBeforeAdd = Data("enrolled-secret".utf8)
        probe.updateStatuses = [errSecItemNotFound, errSecSuccess]
        probe.addStatus = errSecDuplicateItem
        try probe.makeStore().store(Data("replacement".utf8), forAccount: "device", service: "session", accessibility: .whenUnlockedThisDeviceOnly)
        XCTAssertEqual(probe.stored, Data("replacement".utf8))
        XCTAssertEqual(probe.calls, ["update", "add", "update"])
        assertReplacementQueries(probe)
    }

    func testSystemStorePreservesConcurrentItemWhenRetryFails() {
        let probe = KeychainReplacementProbe()
        probe.stored = nil
        probe.concurrentInsertionBeforeAdd = Data("enrolled-secret".utf8)
        probe.updateStatuses = [errSecItemNotFound, errSecInteractionNotAllowed]
        probe.addStatus = errSecDuplicateItem
        XCTAssertThrowsError(try probe.makeStore().store(Data("replacement".utf8), forAccount: "device", service: "session", accessibility: .whenUnlockedThisDeviceOnly)) {
            XCTAssertEqual($0 as? KeychainStoreError, .unexpectedStatus(errSecInteractionNotAllowed))
        }
        XCTAssertEqual(probe.stored, Data("enrolled-secret".utf8))
        XCTAssertEqual(probe.calls, ["update", "add", "update"])
        assertReplacementQueries(probe)
    }
}
#endif
