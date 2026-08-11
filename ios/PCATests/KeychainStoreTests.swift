import XCTest
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
