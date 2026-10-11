import Foundation
import CryptoKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum PCADeviceSafeZoneDeliveryError: Error, Equatable {
    case invalidScope
    case malformedResponse
    case staleCursor
    case staleRevision
    case conflictingRevision
    case scopeChanged
    case corruptInbox
    case persistenceUnavailable
}

public struct PCADeviceSafeZoneDeliveryScope: Codable, Equatable {
    public let familyId: String
    public let deviceId: String

    public init(familyId: String, deviceId: String) {
        self.familyId = familyId
        self.deviceId = deviceId
    }

    fileprivate func validate() throws {
        guard Self.token(familyId), Self.token(deviceId) else {
            throw PCADeviceSafeZoneDeliveryError.invalidScope
        }
    }

    fileprivate static func token(_ value: String) -> Bool {
        value.utf8.count <= 128 && value.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil
    }

    var storageKey: String {
        let family = Data(familyId.utf8), device = Data(deviceId.utf8)
        var transcript = Data("PCA_IOS_SAFE_ZONE_DELIVERY_SCOPE_V1|".utf8)
        transcript.append(Data("\(family.count):".utf8)); transcript.append(family)
        transcript.append(Data("\(device.count):".utf8)); transcript.append(device)
        return SHA256.hash(data: transcript).map { String(format: "%02x", $0) }.joined()
    }
}

/// Paging cursors are opaque to the mobile inbox. Legacy zone-ID cursors remain
/// accepted so a durable cursor from an older app can be resumed; current server
/// cursors bind the position to the key epoch that produced the page.
private enum PCADeviceSafeZoneDeliveryCursor {
    case legacy(zoneId: String)
    case epochBound(keyEpoch: Int, zoneId: String)

    static let maximumBytes = 160

    static func parse(_ value: String) -> Self? {
        guard value.utf8.count <= maximumBytes else { return nil }
        guard value.contains("~") else {
            guard PCADeviceSafeZoneDeliveryScope.token(value) else { return nil }
            return .legacy(zoneId: value)
        }

        let components = value.split(separator: "~", omittingEmptySubsequences: false)
        guard components.count == 3, components[0] == "v1",
              let keyEpoch = Int(components[1]), (1...Int(Int32.max)).contains(keyEpoch),
              String(keyEpoch) == String(components[1]),
              PCADeviceSafeZoneDeliveryScope.token(String(components[2])) else { return nil }
        return .epochBound(keyEpoch: keyEpoch, zoneId: String(components[2]))
    }
}

/// Opaque transport material only. This value has not been decrypted, authenticated,
/// accepted as policy, or applied to any iOS protection surface.
public struct PCAOpaqueSafeZoneDelivery: Codable, Equatable {
    public let zoneId: String
    public let ciphertextB64: String
    public let nonceB64: String
    public let keyEpoch: Int
    public let revision: UInt32
    public let deliveryState: String
    public let updatedAtUtc: String

    public init(zoneId: String, ciphertextB64: String, nonceB64: String, keyEpoch: Int,
                revision: UInt32, deliveryState: String, updatedAtUtc: String) {
        self.zoneId = zoneId
        self.ciphertextB64 = ciphertextB64
        self.nonceB64 = nonceB64
        self.keyEpoch = keyEpoch
        self.revision = revision
        self.deliveryState = deliveryState
        self.updatedAtUtc = updatedAtUtc
    }

    fileprivate func validate() throws {
        guard PCADeviceSafeZoneDeliveryScope.token(zoneId), (1...Int(Int32.max)).contains(keyEpoch), revision > 0,
              deliveryState == "PENDING_OFFLINE" || deliveryState == "READY",
              Self.canonicalBase64URL(ciphertextB64, minimumBytes: 1, maximumBytes: 65_535),
              Self.canonicalBase64URL(nonceB64, minimumBytes: 12, maximumBytes: 64),
              Self.canonicalTimestamp(updatedAtUtc) else {
            throw PCADeviceSafeZoneDeliveryError.malformedResponse
        }
    }

    fileprivate static func canonicalBase64URL(_ value: String, minimumBytes: Int, maximumBytes: Int) -> Bool {
        guard !value.isEmpty,
              value.utf8.allSatisfy({
                  ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || ($0 >= 48 && $0 <= 57) || $0 == 45 || $0 == 95
              }) else { return false }
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.utf8.count % 4) % 4)
        guard let decoded = Data(base64Encoded: base64), (minimumBytes...maximumBytes).contains(decoded.count) else { return false }
        return decoded.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") == value
    }

    fileprivate static func canonicalTimestamp(_ value: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value) else { return false }
        return formatter.string(from: date) == value
    }
}

public struct PCAOpaqueSafeZoneDeliveryPage: Equatable {
    public let safeZones: [PCAOpaqueSafeZoneDelivery]
    public let nextCursor: String?

    public init(safeZones: [PCAOpaqueSafeZoneDelivery], nextCursor: String?) {
        self.safeZones = safeZones
        self.nextCursor = nextCursor
    }
}

/// Keychain-backed, device-only staging. Each opaque envelope is a separate generic-password
/// item so one bounded page never requires a multi-megabyte Keychain value. Cursor advancement is
/// committed only after every row has been durably written and read back; interrupted pages replay
/// safely. There is no deletion/receipt semantics, so absent rows are retained.
public final class PCAKeychainSafeZoneDeliveryInbox {
    private struct CursorAnchor: Codable, Equatable {
        let zoneId: String
        let keyEpoch: Int
    }

    private struct Manifest: Codable, Equatable {
        let version: Int
        let zoneIds: [String]
        let nextCursor: String?
        let cursorAnchor: CursorAnchor?
        // Presence marks an interrupted page write; its values list only the
        // newly introduced rows that recovery may delete. Recovery also resets
        // the cursor because an existing row may have been replaced mid-page.
        let stagedNewZoneIds: [String]?

        init(version: Int, zoneIds: [String], nextCursor: String?, cursorAnchor: CursorAnchor? = nil,
             stagedNewZoneIds: [String]? = nil) {
            self.version = version
            self.zoneIds = zoneIds
            self.nextCursor = nextCursor
            self.cursorAnchor = cursorAnchor
            self.stagedNewZoneIds = stagedNewZoneIds
        }
    }

    private static let lock = NSRecursiveLock()
    private let keychain: KeychainStoreProtocol
    private let service: String
    private let scopeProvider: () -> PCADeviceSafeZoneDeliveryScope?

    public init(keychain: KeychainStoreProtocol, serviceNamespace: String,
                scopeProvider: @escaping () -> PCADeviceSafeZoneDeliveryScope?) {
        self.keychain = keychain
        self.service = serviceNamespace + ".safe-zone-delivery.v1"
        self.scopeProvider = scopeProvider
    }

    public func read(scope: PCADeviceSafeZoneDeliveryScope) throws -> [PCAOpaqueSafeZoneDelivery] {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try requireCurrentScope(scope)
        let records = try readUnlocked(scope).records
        // Keychain reads can span many stored rows. Enrollment may change while
        // those reads are in progress, so do not release the prior family's
        // opaque envelopes after the caller's active scope has moved.
        try requireCurrentScope(scope)
        return records
    }

    public func nextCursor(scope: PCADeviceSafeZoneDeliveryScope) throws -> String? {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try requireCurrentScope(scope)
        let cursor = try readUnlocked(scope).manifest.nextCursor
        try requireCurrentScope(scope)
        return cursor
    }

    /// Atomically advances paging state only after the page contents are durably staged.
    /// Lower revisions are ignored, exact duplicates are idempotent, and equal-revision byte
    /// conflicts are rejected without advancing the page cursor.
    public func stage(_ page: PCAOpaqueSafeZoneDeliveryPage, for scope: PCADeviceSafeZoneDeliveryScope,
                      requestedCursor: String?) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try requireCurrentScope(scope)
        try Self.validatePage(page, requestedCursor: requestedCursor)
        let current = try readUnlocked(scope)
        guard current.manifest.nextCursor == requestedCursor else { throw PCADeviceSafeZoneDeliveryError.staleCursor }

        var byId = Dictionary(uniqueKeysWithValues: current.records.map { ($0.zoneId, $0) })
        var replacements: [PCAOpaqueSafeZoneDelivery] = []
        var newlyAddedZoneIds = Set<String>()
        for incoming in page.safeZones {
            try incoming.validate()
            guard let existing = byId[incoming.zoneId] else {
                byId[incoming.zoneId] = incoming
                replacements.append(incoming)
                newlyAddedZoneIds.insert(incoming.zoneId)
                continue
            }
            // The server's epoch-bound paging cursor may restart at a higher
            // key epoch, but that does not make an older revision safe to
            // ignore. If the same row appears under a newer epoch without a
            // globally newer revision, retaining the old envelope would make
            // the new durable cursor point at a row from the prior epoch.
            // Reject the whole page before any Keychain write instead of
            // committing a manifest that becomes corrupt on the next read.
            if incoming.keyEpoch > existing.keyEpoch, incoming.revision <= existing.revision {
                throw PCADeviceSafeZoneDeliveryError.staleRevision
            }
            if incoming.revision < existing.revision { continue }
            if incoming.revision == existing.revision {
                guard incoming == existing else { throw PCADeviceSafeZoneDeliveryError.conflictingRevision }
                continue
            }
            byId[incoming.zoneId] = incoming
            replacements.append(incoming)
        }
        let sortedRecords = byId.values.sorted { $0.zoneId < $1.zoneId }
        let manifest = Manifest(version: 2, zoneIds: sortedRecords.map(\.zoneId), nextCursor: page.nextCursor,
            cursorAnchor: Self.cursorAnchor(for: page))
        let encodedManifest = try JSONEncoder().encode(manifest)
        guard encodedManifest.count <= Self.maximumManifestBytes else {
            throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable
        }

        // Enforce a total encoded-byte budget before writing any row or advancing the cursor.
        // Keychain item count is bounded by the manifest's own size limit; payload size is
        // independently bounded so removing an arbitrary row ceiling cannot grow storage forever.
        var encodedById: [String: Data] = [:]
        var totalEncodedBytes = encodedManifest.count
        for record in sortedRecords {
            let bytes = try JSONEncoder().encode(record)
            guard bytes.count <= Self.maximumRecordBytes else {
                throw PCADeviceSafeZoneDeliveryError.malformedResponse
            }
            totalEncodedBytes += bytes.count
            guard totalEncodedBytes <= Self.maximumTotalEncodedBytes else {
                throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable
            }
            encodedById[record.zoneId] = bytes
        }

        if !replacements.isEmpty {
            // A partial page may replace an old row at a different epoch as
            // well as add new rows. Reset navigation on recovery, since the
            // previous cursor's row may have been one of those replacements.
            let intent = Manifest(version: 2, zoneIds: current.manifest.zoneIds,
                nextCursor: nil, cursorAnchor: nil, stagedNewZoneIds: newlyAddedZoneIds.sorted())
            try persistManifest(intent, scope: scope)
        }

        for record in replacements {
            try requireCurrentScope(scope)
            guard let bytes = encodedById[record.zoneId] else { throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable }
            do {
                try keychain.storeReplacingAtomically(bytes, forAccount: Self.zoneAccount(scope, record.zoneId),
                    service: service, accessibility: .whenUnlockedThisDeviceOnly)
                guard try keychain.retrieve(forAccount: Self.zoneAccount(scope, record.zoneId), service: service) == bytes else {
                    throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable
                }
            } catch let error as PCADeviceSafeZoneDeliveryError { throw error }
            catch { throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable }
        }

        try persistManifest(manifest, scope: scope)
    }

    private func readUnlocked(_ scope: PCADeviceSafeZoneDeliveryScope) throws -> (manifest: Manifest, records: [PCAOpaqueSafeZoneDelivery]) {
        var manifest: Manifest
        var manifestEncodedBytes: Int
        do {
            let bytes = try keychain.retrieve(forAccount: Self.manifestAccount(scope), service: service)
            guard bytes.count <= Self.maximumManifestBytes,
                  (try? StrictJSONDocument.validateNoDuplicateMembers(bytes, maximumBytes: Self.maximumManifestBytes)) != nil,
                  let decoded = try? JSONDecoder().decode(Manifest.self, from: bytes),
                  (decoded.version == 1 || decoded.version == 2),
                  (decoded.version != 1 || decoded.cursorAnchor == nil),
                  (decoded.version != 2 || (decoded.nextCursor == nil ? decoded.cursorAnchor == nil : decoded.cursorAnchor != nil)),
                  decoded.zoneIds == decoded.zoneIds.sorted(), Set(decoded.zoneIds).count == decoded.zoneIds.count,
                  decoded.zoneIds.allSatisfy(PCADeviceSafeZoneDeliveryScope.token),
                  (decoded.stagedNewZoneIds ?? []).count <= Self.maximumPageRows,
                  (decoded.stagedNewZoneIds ?? []) == (decoded.stagedNewZoneIds ?? []).sorted(),
                  Set(decoded.stagedNewZoneIds ?? []).count == (decoded.stagedNewZoneIds ?? []).count,
                  (decoded.stagedNewZoneIds ?? []).allSatisfy(PCADeviceSafeZoneDeliveryScope.token),
                  Set(decoded.zoneIds).isDisjoint(with: Set(decoded.stagedNewZoneIds ?? [])),
                  decoded.nextCursor.map({ PCADeviceSafeZoneDeliveryCursor.parse($0) != nil }) ?? true else {
                throw PCADeviceSafeZoneDeliveryError.corruptInbox
            }
            manifest = decoded
            manifestEncodedBytes = bytes.count
        } catch KeychainStoreError.itemNotFound {
            return (Manifest(version: 2, zoneIds: [], nextCursor: nil), [])
        } catch KeychainStoreError.unexpectedStatus(_) {
            // Keychain access can be temporarily unavailable while the device
            // is locked. Do not mislabel that ordinary storage condition as
            // durable inbox corruption or block unrelated runtime sync.
            throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable
        } catch let error as PCADeviceSafeZoneDeliveryError { throw error }
        catch { throw PCADeviceSafeZoneDeliveryError.corruptInbox }

        // A process can die after writing some rows but before the final
        // manifest/cursor. Remove only new rows explicitly covered by the
        // write-ahead marker. Replacements remain monotonic; the cursor resets
        // so the server can replay the interrupted page safely.
        if let stagedIds = manifest.stagedNewZoneIds {
            try requireCurrentScope(scope)
            do {
                for zoneId in stagedIds {
                    try requireCurrentScope(scope)
                    try keychain.delete(forAccount: Self.zoneAccount(scope, zoneId), service: service)
                }
            } catch let error as PCADeviceSafeZoneDeliveryError { throw error }
            catch { throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable }
            let recovered = Manifest(version: 2, zoneIds: manifest.zoneIds, nextCursor: nil, cursorAnchor: nil)
            try persistManifest(recovered, scope: scope)
            manifest = recovered
            manifestEncodedBytes = try JSONEncoder().encode(recovered).count
        }

        var records: [PCAOpaqueSafeZoneDelivery] = []
        var totalEncodedBytes = manifestEncodedBytes
        guard totalEncodedBytes <= Self.maximumTotalEncodedBytes else { throw PCADeviceSafeZoneDeliveryError.corruptInbox }
        for zoneId in manifest.zoneIds {
            do {
                let bytes = try keychain.retrieve(forAccount: Self.zoneAccount(scope, zoneId), service: service)
                guard bytes.count <= Self.maximumRecordBytes,
                      (try? StrictJSONDocument.validateNoDuplicateMembers(bytes, maximumBytes: Self.maximumRecordBytes)) != nil,
                      let value = try? JSONDecoder().decode(PCAOpaqueSafeZoneDelivery.self, from: bytes) else {
                    throw PCADeviceSafeZoneDeliveryError.corruptInbox
                }
                totalEncodedBytes += bytes.count
                guard totalEncodedBytes <= Self.maximumTotalEncodedBytes else {
                    throw PCADeviceSafeZoneDeliveryError.corruptInbox
                }
                try value.validate()
                guard value.zoneId == zoneId else { throw PCADeviceSafeZoneDeliveryError.corruptInbox }
                records.append(value)
            } catch KeychainStoreError.unexpectedStatus(_) {
                throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable
            } catch let error as PCADeviceSafeZoneDeliveryError { throw error }
            catch { throw PCADeviceSafeZoneDeliveryError.corruptInbox }
        }
        if manifest.version == 1 {
            // Version 1 persisted the cursor but not the page tail that
            // produced it. Preserve all durable zone rows and restart paging
            // from the beginning rather than inferring a boundary from a
            // merged, potentially stale row set.
            let migrated = Manifest(version: 2, zoneIds: manifest.zoneIds, nextCursor: nil, cursorAnchor: nil)
            try persistManifest(migrated, scope: scope)
            manifest = migrated
            manifestEncodedBytes = try JSONEncoder().encode(migrated).count
        } else if let cursor = manifest.nextCursor {
            guard let parsedCursor = PCADeviceSafeZoneDeliveryCursor.parse(cursor) else {
                throw PCADeviceSafeZoneDeliveryError.corruptInbox
            }
            guard let anchor = manifest.cursorAnchor,
                  records.contains(where: { $0.zoneId == anchor.zoneId && $0.keyEpoch == anchor.keyEpoch }) else {
                throw PCADeviceSafeZoneDeliveryError.corruptInbox
            }
            switch parsedCursor {
            case .legacy(let zoneId):
                guard anchor.zoneId == zoneId else {
                    throw PCADeviceSafeZoneDeliveryError.corruptInbox
                }
            case .epochBound(let keyEpoch, let zoneId):
                guard anchor.zoneId == zoneId, anchor.keyEpoch == keyEpoch else {
                    throw PCADeviceSafeZoneDeliveryError.corruptInbox
                }
            }
        }
        return (manifest, records)
    }

    private func requireCurrentScope(_ expected: PCADeviceSafeZoneDeliveryScope) throws {
        try expected.validate()
        guard scopeProvider() == expected else { throw PCADeviceSafeZoneDeliveryError.scopeChanged }
    }

    private func persistManifest(_ manifest: Manifest, scope: PCADeviceSafeZoneDeliveryScope) throws {
        try requireCurrentScope(scope)
        let bytes: Data
        do { bytes = try JSONEncoder().encode(manifest) }
        catch { throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable }
        guard bytes.count <= Self.maximumManifestBytes else {
            throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable
        }
        do {
            try keychain.storeReplacingAtomically(bytes, forAccount: Self.manifestAccount(scope),
                service: service, accessibility: .whenUnlockedThisDeviceOnly)
            guard try keychain.retrieve(forAccount: Self.manifestAccount(scope), service: service) == bytes else {
                throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable
            }
        } catch let error as PCADeviceSafeZoneDeliveryError { throw error }
        catch { throw PCADeviceSafeZoneDeliveryError.persistenceUnavailable }
    }

    fileprivate static func validatePage(_ page: PCAOpaqueSafeZoneDeliveryPage, requestedCursor: String?) throws {
        guard page.safeZones.count <= pageSize,
              requestedCursor.map({ PCADeviceSafeZoneDeliveryCursor.parse($0) != nil }) ?? true,
              page.nextCursor.map({ PCADeviceSafeZoneDeliveryCursor.parse($0) != nil }) ?? true else {
            throw PCADeviceSafeZoneDeliveryError.malformedResponse
        }
        let ids = page.safeZones.map(\.zoneId)
        guard Set(ids).count == ids.count,
              zip(ids, ids.dropFirst()).allSatisfy({ pair in pair.0.utf8.lexicographicallyPrecedes(pair.1.utf8) }) else {
            throw PCADeviceSafeZoneDeliveryError.malformedResponse
        }
        let pageEpochs = Set(page.safeZones.map(\.keyEpoch))
        guard pageEpochs.count <= 1 else { throw PCADeviceSafeZoneDeliveryError.staleCursor }
        if let requestedCursor {
            switch PCADeviceSafeZoneDeliveryCursor.parse(requestedCursor) {
            case .epochBound(let requestedEpoch, let requestedZoneId):
                if let responseEpoch = page.safeZones.first?.keyEpoch {
                    // The server restarts a cursor when the accepted key epoch advanced.
                    // Within the same epoch it must continue strictly after the cursor;
                    // a lower epoch or a backward same-epoch page is stale and must not
                    // be allowed to rewind the durable inbox cursor.
                    guard responseEpoch >= requestedEpoch else { throw PCADeviceSafeZoneDeliveryError.staleCursor }
                    if responseEpoch == requestedEpoch {
                        guard ids.allSatisfy({ requestedZoneId.utf8.lexicographicallyPrecedes($0.utf8) }) else {
                            throw PCADeviceSafeZoneDeliveryError.staleCursor
                        }
                    }
                }
            case .legacy, nil:
                // Legacy cursors are intentionally restarted from page one because
                // they do not carry the key epoch needed for safe continuation.
                break
            }
        }
        if let next = page.nextCursor {
            guard page.safeZones.count == pageSize, next != requestedCursor else {
                throw PCADeviceSafeZoneDeliveryError.staleCursor
            }
            guard let parsedNext = PCADeviceSafeZoneDeliveryCursor.parse(next) else {
                throw PCADeviceSafeZoneDeliveryError.malformedResponse
            }
            switch parsedNext {
            case .legacy(let zoneId):
                guard ids.last == zoneId else { throw PCADeviceSafeZoneDeliveryError.staleCursor }
            case .epochBound(let keyEpoch, let zoneId):
                guard ids.last == zoneId,
                      page.safeZones.allSatisfy({ $0.keyEpoch == keyEpoch }) else {
                    throw PCADeviceSafeZoneDeliveryError.staleCursor
                }
            }
        }
    }

    private static func cursorAnchor(for page: PCAOpaqueSafeZoneDeliveryPage) -> CursorAnchor? {
        guard page.nextCursor != nil, let tail = page.safeZones.last else { return nil }
        return CursorAnchor(zoneId: tail.zoneId, keyEpoch: tail.keyEpoch)
    }

    private static func manifestAccount(_ scope: PCADeviceSafeZoneDeliveryScope) -> String {
        "safe-zone-delivery.v1.\(scope.storageKey).manifest"
    }

    private static func zoneAccount(_ scope: PCADeviceSafeZoneDeliveryScope, _ zoneId: String) -> String {
        "safe-zone-delivery.v1.\(scope.storageKey).zone.\(zoneId)"
    }

    static let pageSize = 16
    private static let maximumPageRows = 16
    private static let maximumRecordBytes = 128 * 1024
    private static let maximumManifestBytes = 64 * 1024
    private static let maximumTotalEncodedBytes = 4 * 1024 * 1024
}

private final class PCADeviceSafeZoneNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Fetches authenticated, paginated Safe Zone envelopes and stages them opaquely.
/// Session and local enrollment scope are rechecked after each network await. This client does
/// not decrypt, verify policy authority, apply policy, or acknowledge server delivery.
public final class PCADeviceSafeZoneDeliveryClient {
    private struct WirePage: Decodable { let safeZones: [PCAOpaqueSafeZoneDelivery]; let nextCursor: String? }
    static let maximumSynchronizationDuration: TimeInterval = 30
    private static let maximumPageResponseBytes = 2 * 1024 * 1024

    private let baseURL: URL
    private let currentSession: () throws -> PCADeviceSession?
    private let transport: PCAHTTPTransport
    private let now: () -> Date
    private let monotonicNow: () -> TimeInterval

    public init(baseURL: URL, currentSession: @escaping () throws -> PCADeviceSession?,
                transport: PCAHTTPTransport? = nil, now: @escaping () -> Date = Date.init,
                monotonicNow: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) throws {
        guard baseURL.scheme?.lowercased() == "https", baseURL.host != nil, baseURL.user == nil,
              baseURL.password == nil, baseURL.query == nil, baseURL.fragment == nil,
              baseURL.path.isEmpty || baseURL.path == "/" else { throw PCAAPIError.invalidConfiguration }
        self.baseURL = baseURL
        self.currentSession = currentSession
        self.transport = transport ?? PCAURLSessionTransport(session: URLSession(configuration: .ephemeral,
            delegate: PCADeviceSafeZoneNoRedirectDelegate(), delegateQueue: nil), maxResponseBytes: Self.maximumPageResponseBytes)
        self.now = now
        self.monotonicNow = monotonicNow
    }

    /// Fetches up to `maximumPages`, committing each page before following its cursor. `false`
    /// means a bounded invocation ended with a durable cursor and can resume after relaunch.
    @discardableResult
    public func synchronize(scope: PCADeviceSafeZoneDeliveryScope, inbox: PCAKeychainSafeZoneDeliveryInbox,
                            maximumPages: Int = 8,
                            absoluteMonotonicDeadline: TimeInterval? = nil) async throws -> Bool {
        try Task.checkCancellation()
        try scope.validate()
        guard (1...8).contains(maximumPages) else { throw PCADeviceSafeZoneDeliveryError.malformedResponse }
        guard let session = try currentSession(), session.expiresAt > now(),
              Data(session.deviceId.utf8) == Data(scope.deviceId.utf8),
              (1...4096).contains(session.sessionToken.utf8.count),
              session.sessionToken.utf8.allSatisfy({ $0 > 32 && $0 != 127 }) else { throw PCAAPIError.unauthorized }
        let startedAt = monotonicNow()
        let localDeadline = startedAt + Self.maximumSynchronizationDuration
        guard startedAt.isFinite, localDeadline.isFinite,
              absoluteMonotonicDeadline.map(\.isFinite) ?? true else {
            throw PCAAPIError.transport(.timeout)
        }
        let effectiveDeadline = min(localDeadline, absoluteMonotonicDeadline ?? .infinity)
        func requestTimeoutRemaining() throws -> TimeInterval {
            let currentUptime = monotonicNow()
            let remaining = effectiveDeadline - currentUptime
            // PCAURLSessionTransport enforces a one-second minimum request
            // timeout. Do not start a request whose real timeout could exceed
            // this invocation's remaining bounded synchronization window.
            guard currentUptime.isFinite, currentUptime >= startedAt,
                  remaining.isFinite, remaining >= 1 else {
                throw PCAAPIError.transport(.timeout)
            }
            return remaining
        }
        func assertResponseIsBeforeDeadline() throws {
            let currentUptime = monotonicNow()
            guard currentUptime.isFinite, currentUptime >= startedAt,
                  currentUptime < effectiveDeadline else {
                throw PCAAPIError.transport(.timeout)
            }
        }
        var cursor = try inbox.nextCursor(scope: scope)
        for _ in 0..<maximumPages {
            try Task.checkCancellation()
            try assertSessionCurrent(session, scope: scope)
            let timeoutRemaining = try requestTimeoutRemaining()
            let page = try await fetchPage(scope: scope, session: session, cursor: cursor,
                timeoutInterval: timeoutRemaining)
            try Task.checkCancellation()
            try assertSessionCurrent(session, scope: scope)
            try Task.checkCancellation()
            // A transport implementation may return after its requested
            // timeout, or session validation may consume the remaining time.
            // Never make a late response durable or advance its cursor.
            try assertResponseIsBeforeDeadline()
            try inbox.stage(page, for: scope, requestedCursor: cursor)
            cursor = page.nextCursor
            if cursor == nil { return true }
        }
        return false
    }

    private func fetchPage(scope: PCADeviceSafeZoneDeliveryScope, session: PCADeviceSession,
                           cursor: String?, timeoutInterval: TimeInterval) async throws -> PCAOpaqueSafeZoneDeliveryPage {
        var components = URLComponents(url: baseURL.appendingPathComponent("v1/runtime-sync/safe-zones"),
                                       resolvingAgainstBaseURL: false)
        if let cursor {
            guard PCADeviceSafeZoneDeliveryCursor.parse(cursor) != nil else { throw PCADeviceSafeZoneDeliveryError.staleCursor }
            components?.queryItems = [URLQueryItem(name: "cursor", value: cursor)]
        }
        guard let url = components?.url else { throw PCAAPIError.invalidRequest }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = timeoutInterval
        request.setValue("Bearer \(session.sessionToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let response: PCAHTTPResponse
        do { response = try await transport.send(request) }
        catch is CancellationError { throw CancellationError() }
        catch let error as PCAHTTPTransportError { throw PCAAPIError.transport(error) }
        catch { throw PCAAPIError.transport(.network) }
        try Task.checkCancellation()
        switch response.statusCode {
        case 200: break
        case 401: throw PCAAPIError.unauthorized
        case 403: throw PCAAPIError.forbidden
        case 400: throw PCAAPIError.invalidRequest
        case 404: throw PCAAPIError.unavailable
        case 408, 429, 500...599: throw PCAAPIError.rejected
        default: throw PCAAPIError.rejected
        }
        guard response.data.count <= Self.maximumPageResponseBytes,
              (try? StrictJSONDocument.validateNoDuplicateMembers(response.data,
                  maximumBytes: Self.maximumPageResponseBytes)) != nil,
              let object = try? JSONSerialization.jsonObject(with: response.data) as? [String: Any],
              Set(object.keys) == Set(["safeZones", "nextCursor"]),
              object["nextCursor"] is NSNull || object["nextCursor"] is String,
              let rows = object["safeZones"] as? [[String: Any]],
              rows.count <= PCAKeychainSafeZoneDeliveryInbox.pageSize,
              rows.allSatisfy({ Set($0.keys) == Set(["zoneId", "ciphertextB64", "nonceB64", "keyEpoch", "revision", "deliveryState", "updatedAtUtc"]) }),
              let wirePage = try? JSONDecoder().decode(WirePage.self, from: response.data) else {
            throw PCAAPIError.malformedResponse
        }
        let page = PCAOpaqueSafeZoneDeliveryPage(safeZones: wirePage.safeZones, nextCursor: wirePage.nextCursor)
        for row in page.safeZones { try row.validate() }
        do { try PCAKeychainSafeZoneDeliveryInbox.validatePage(page, requestedCursor: cursor) }
        catch { throw PCAAPIError.malformedResponse }
        return page
    }

    private func assertSessionCurrent(_ expected: PCADeviceSession, scope: PCADeviceSafeZoneDeliveryScope) throws {
        guard expected.expiresAt > now(), Data(expected.deviceId.utf8) == Data(scope.deviceId.utf8),
              try currentSession() == expected else { throw PCAAPIError.unauthorized }
    }
}
