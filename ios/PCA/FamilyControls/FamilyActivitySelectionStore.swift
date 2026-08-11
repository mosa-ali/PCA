import Foundation
#if canImport(FamilyControls)
import FamilyControls
#endif

/// Narrow persistence port for a `FamilyActivitySelection` blob. The
/// selection is treated as fully OPAQUE bytes here -- this type never
/// inspects, decodes into readable fields, or logs the selection's
/// contents (doc 07 Section 5). It only needs to move the same opaque
/// blob from the host app (where `FamilyActivityPicker` produces it) into
/// the app-group-shared location the `DeviceActivityMonitor` and shield
/// extensions read from, since extensions run in a separate process.
public protocol OpaqueBlobStore {
    func write(_ data: Data, forKey key: String) throws
    func read(forKey key: String) -> Data?
    func remove(forKey key: String)
}

public enum FamilyActivitySelectionStoreError: Error, Equatable {
    case encodingFailed
    case decodingFailed
}

/// Stores/loads a selection under a caller-supplied opaque key (e.g. a
/// per-child or per-policy-category identifier the host app already
/// tracks) -- this type assigns no meaning to the key beyond "which slot,"
/// consistent with never reverse-engineering token identity.
public final class FamilyActivitySelectionStore {
    private let blobStore: OpaqueBlobStore
    private let encoder = PropertyListEncoder()
    private let decoder = PropertyListDecoder()

    public init(blobStore: OpaqueBlobStore) {
        self.blobStore = blobStore
    }

    #if canImport(FamilyControls)
    public func save(_ selection: FamilyActivitySelection, forKey key: String) throws {
        guard let data = try? encoder.encode(selection) else {
            throw FamilyActivitySelectionStoreError.encodingFailed
        }
        try blobStore.write(data, forKey: key)
    }

    public func load(forKey key: String) throws -> FamilyActivitySelection? {
        guard let data = blobStore.read(forKey: key) else { return nil }
        guard let selection = try? decoder.decode(FamilyActivitySelection.self, from: data) else {
            throw FamilyActivitySelectionStoreError.decodingFailed
        }
        return selection
    }
    #endif

    public func clear(forKey key: String) {
        blobStore.remove(forKey: key)
    }
}

/// App-Group `UserDefaults`-backed store -- the standard Apple-documented
/// mechanism for sharing state between a host app and its extensions
/// (DeviceActivityMonitor, ShieldConfiguration, ShieldAction all run in
/// separate processes and cannot share the host app's ordinary
/// `UserDefaults.standard`). The app group identifier itself is an
/// Xcode project/entitlement configuration concern (see the Mac/Xcode
/// validation checklist), not something this source file selects.
public final class AppGroupBlobStore: OpaqueBlobStore {
    public enum StoreError: Error { case appGroupUnavailable }

    private let defaults: UserDefaults

    public init(appGroupIdentifier: String) throws {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
            throw StoreError.appGroupUnavailable
        }
        self.defaults = defaults
    }

    public func write(_ data: Data, forKey key: String) throws {
        defaults.set(data, forKey: key)
    }

    public func read(forKey key: String) -> Data? {
        defaults.data(forKey: key)
    }

    public func remove(forKey key: String) {
        defaults.removeObject(forKey: key)
    }
}

/// In-memory store for unit tests and previews -- never used in a
/// shipping extension, since extensions need cross-process persistence.
public final class InMemoryBlobStore: OpaqueBlobStore {
    private var storage: [String: Data] = [:]

    public init() {}

    public func write(_ data: Data, forKey key: String) throws {
        storage[key] = data
    }

    public func read(forKey key: String) -> Data? {
        storage[key]
    }

    public func remove(forKey key: String) {
        storage.removeValue(forKey: key)
    }
}
