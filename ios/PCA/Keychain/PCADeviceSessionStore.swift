import Foundation

public enum PCAInboundInboxError: Error { case unavailable }

public struct PCAStoredInboundEnvelope: Codable, Equatable {
    public let envelope: PCAInboundEnvelope
    public var relayAcknowledged: Bool
    /// Custody never advances to applied without the separately verified crypto dispatcher.
    public let processingState: String
}

public protocol PCAInboundInboxStoring {
    func capture(_ response: PCAInboundRuntimeSyncResponse, sessionDeviceId: String) throws
    func capture(_ response: PCAInboundRuntimeSyncResponse, sessionDeviceId: String,
                 sessionIncarnation: String, requestedCursor: String?) throws
    func navigation(sessionIncarnation: String) throws -> PCAInboundNavigation?
    func resetRejectedNavigation(sessionIncarnation: String, cursor: String) throws
    func retainedScope() throws -> PCAInboundScope?
    func hasUnresolvedRelayWork() throws -> Bool
    func pendingAcknowledgements(scope: PCAInboundScope) throws -> [PCAStoredInboundEnvelope]
    func markAcknowledged(_ envelope: PCAInboundEnvelope, scope: PCAInboundScope) throws
    func pendingCrypto(scope: PCAInboundScope) throws -> [PCAStoredInboundEnvelope]
}

/// One immutable, authenticated scope in one device-local Keychain slot.
/// Locked/corrupt storage fails closed; no eviction or plaintext fallback.
public final class PCAKeychainInboundInboxStore: PCAInboundInboxStoring {
    private struct Snapshot: Codable {
        var version: Int
        let scope: PCAInboundScope
        var entries: [PCAStoredInboundEnvelope]
        var navigation: PCAInboundNavigation?
        var receipts: [PCAInboundReceipt]
        var campaignUnresolved: Bool

        private enum CodingKeys: String, CodingKey { case version, scope, entries, navigation, receipts, campaignUnresolved }
        init(scope: PCAInboundScope) {
            version = 2; self.scope = scope; entries = []; navigation = nil; receipts = []; campaignUnresolved = false
        }
        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            version = try container.decode(Int.self, forKey: .version)
            scope = try container.decode(PCAInboundScope.self, forKey: .scope)
            entries = try container.decode([PCAStoredInboundEnvelope].self, forKey: .entries)
            if version == 1 {
                navigation = nil; receipts = []; campaignUnresolved = false
            } else {
                guard version == 2, container.contains(.navigation) else { throw PCAInboundInboxError.unavailable }
                navigation = try container.decodeIfPresent(PCAInboundNavigation.self, forKey: .navigation)
                receipts = try container.decode([PCAInboundReceipt].self, forKey: .receipts)
                campaignUnresolved = try container.decode(Bool.self, forKey: .campaignUnresolved)
            }
        }
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(2, forKey: .version)
            try container.encode(scope, forKey: .scope)
            try container.encode(entries, forKey: .entries)
            if let navigation { try container.encode(navigation, forKey: .navigation) }
            else { try container.encodeNil(forKey: .navigation) }
            try container.encode(receipts, forKey: .receipts)
            try container.encode(campaignUnresolved, forKey: .campaignUnresolved)
        }
    }
    // Serialize independently constructed stores sharing the same Keychain namespace.
    private static let lock = NSRecursiveLock()
    private let keychain: KeychainStoreProtocol
    private let service: String
    private let account = "current.ciphertext-inbox"
    private let maxRecords: Int
    private let maxBytes: Int

    public init(keychain: KeychainStoreProtocol, serviceNamespace: String, maxRecords: Int = 256, maxBytes: Int = 4 * 1024 * 1024) {
        precondition(maxRecords > 0 && maxRecords <= 256 && maxBytes > 0 && maxBytes <= 4 * 1024 * 1024)
        self.keychain = keychain
        self.service = "\(serviceNamespace).ciphertext-inbox"
        self.maxRecords = maxRecords
        self.maxBytes = maxBytes
    }

    public func capture(_ response: PCAInboundRuntimeSyncResponse, sessionDeviceId: String) throws {
        try captureValidated(response, sessionDeviceId: sessionDeviceId, sessionIncarnation: nil, requestedCursor: nil)
    }

    public func capture(_ response: PCAInboundRuntimeSyncResponse, sessionDeviceId: String,
                        sessionIncarnation: String, requestedCursor: String?) throws {
        try captureValidated(response, sessionDeviceId: sessionDeviceId, sessionIncarnation: sessionIncarnation, requestedCursor: requestedCursor)
    }

    private func captureValidated(_ response: PCAInboundRuntimeSyncResponse, sessionDeviceId: String,
                                  sessionIncarnation: String?, requestedCursor: String?) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try validateScope(response.scope)
        guard pcaOpaqueEqual(response.scope.recipientDeviceId, sessionDeviceId), response.applied.count <= maxRecords else { throw PCAInboundInboxError.unavailable }
        let existing = try read()
        guard existing == nil || existing?.scope == response.scope else { throw PCAInboundInboxError.unavailable }
        guard response.receipts.count <= 100,
              Set(response.receipts.map { Data($0.messageId.utf8) }).count == response.receipts.count else { throw PCAInboundInboxError.unavailable }
        for receipt in response.receipts { try receipt.validate() }
        if let navigation = response.navigation {
            try navigation.validate()
            let prior = existing?.navigation
            let priorCursor = prior?.sessionIncarnation == sessionIncarnation ? prior?.nextCursor : nil
            guard navigation.sessionIncarnation == sessionIncarnation, navigation.hasMore == response.hasMore,
                  priorCursor == requestedCursor,
                  !navigation.hasMore || navigation.nextCursor != requestedCursor else { throw PCAInboundInboxError.unavailable }
        } else if requestedCursor != nil { throw PCAInboundInboxError.unavailable }
        var snapshot = existing ?? Snapshot(scope: response.scope)
        for envelope in response.applied {
            try envelope.validate(scope: response.scope)
            if let prior = snapshot.entries.first(where: { pcaOpaqueEqual($0.envelope.messageId, envelope.messageId) }) {
                guard prior.envelope == envelope else { throw PCAInboundInboxError.unavailable }
            } else {
                guard snapshot.entries.count < maxRecords else { throw PCAInboundInboxError.unavailable }
                snapshot.entries.append(PCAStoredInboundEnvelope(envelope: envelope, relayAcknowledged: false, processingState: "PENDING_CRYPTO"))
            }
        }
        let refreshed = Set(response.receipts.map { Data($0.messageId.utf8) })
        snapshot.receipts = Array((snapshot.receipts.filter { !refreshed.contains(Data($0.messageId.utf8)) } + response.receipts).suffix(256))
        if let navigation = response.navigation {
            snapshot.campaignUnresolved = navigation.hasUnresolved || (requestedCursor != nil && snapshot.campaignUnresolved)
        }
        snapshot.campaignUnresolved = snapshot.campaignUnresolved || response.receipts.contains { $0.outcome != .applied }
        snapshot.navigation = response.navigation
        try persist(snapshot)
    }

    public func navigation(sessionIncarnation: String) throws -> PCAInboundNavigation? {
        Self.lock.lock(); defer { Self.lock.unlock() }
        guard sessionIncarnation.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil else { throw PCAInboundInboxError.unavailable }
        guard var snapshot = try read(), let navigation = snapshot.navigation else { return nil }
        if navigation.sessionIncarnation == sessionIncarnation {
            try persist(snapshot)
            return navigation
        }
        snapshot.navigation = nil
        try persist(snapshot)
        return nil
    }

    public func resetRejectedNavigation(sessionIncarnation: String, cursor: String) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        guard var snapshot = try read(), let navigation = snapshot.navigation,
              navigation.sessionIncarnation == sessionIncarnation, navigation.nextCursor == cursor else { throw PCAInboundInboxError.unavailable }
        snapshot.navigation = nil
        try persist(snapshot)
    }

    public func retainedScope() throws -> PCAInboundScope? {
        Self.lock.lock(); defer { Self.lock.unlock() }
        guard let snapshot = try read() else { return nil }
        try persist(snapshot)
        return snapshot.scope
    }

    public func hasUnresolvedRelayWork() throws -> Bool {
        Self.lock.lock(); defer { Self.lock.unlock() }
        guard let snapshot = try read() else { return false }
        return snapshot.campaignUnresolved || snapshot.navigation?.hasMore == true
    }

    public func pendingAcknowledgements(scope: PCAInboundScope) throws -> [PCAStoredInboundEnvelope] {
        Self.lock.lock(); defer { Self.lock.unlock() }
        return try confirmed(scope: scope).entries.filter { !$0.relayAcknowledged }
    }

    public func pendingCrypto(scope: PCAInboundScope) throws -> [PCAStoredInboundEnvelope] {
        Self.lock.lock(); defer { Self.lock.unlock() }
        return try confirmed(scope: scope).entries
    }

    public func markAcknowledged(_ envelope: PCAInboundEnvelope, scope: PCAInboundScope) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        var snapshot = try confirmed(scope: scope)
        guard let index = snapshot.entries.firstIndex(where: { pcaOpaqueEqual($0.envelope.messageId, envelope.messageId) }),
              snapshot.entries[index].envelope == envelope else { throw PCAInboundInboxError.unavailable }
        snapshot.entries[index].relayAcknowledged = true
        try persist(snapshot)
    }

    private func confirmed(scope: PCAInboundScope) throws -> Snapshot {
        guard let snapshot = try read(), snapshot.scope == scope else { throw PCAInboundInboxError.unavailable }
        // Repeat the durability/readback barrier even for cached exact redelivery.
        try persist(snapshot)
        return snapshot
    }

    private func validateScope(_ scope: PCAInboundScope) throws {
        guard [scope.familyId, scope.recipientDeviceId].allSatisfy({ !$0.isEmpty && $0.utf16.count <= 128 }) else { throw PCAInboundInboxError.unavailable }
    }

    private func read() throws -> Snapshot? {
        let data: Data
        do { data = try keychain.retrieve(forAccount: account, service: service) }
        catch KeychainStoreError.itemNotFound { return nil }
        catch { throw PCAInboundInboxError.unavailable }
        guard data.count <= maxBytes, let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
              (snapshot.version == 1 || snapshot.version == 2), snapshot.entries.count <= maxRecords,
              snapshot.receipts.count <= 256, Set(snapshot.receipts.map { Data($0.messageId.utf8) }).count == snapshot.receipts.count else { throw PCAInboundInboxError.unavailable }
        try snapshot.navigation?.validate()
        for receipt in snapshot.receipts { try receipt.validate() }
        try validateScope(snapshot.scope)
        var seen = Set<Data>()
        for record in snapshot.entries {
            guard record.processingState == "PENDING_CRYPTO", seen.insert(Data(record.envelope.messageId.utf8)).inserted else { throw PCAInboundInboxError.unavailable }
            try record.envelope.validate(scope: snapshot.scope)
        }
        return snapshot
    }

    private func persist(_ snapshot: Snapshot) throws {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(snapshot)
            guard data.count <= maxBytes else { throw PCAInboundInboxError.unavailable }
            try keychain.storeReplacingAtomically(data, forAccount: account, service: service, accessibility: .whenUnlockedThisDeviceOnly)
            guard try keychain.retrieve(forAccount: account, service: service) == data else { throw PCAInboundInboxError.unavailable }
        } catch { throw PCAInboundInboxError.unavailable }
    }
}

public struct PCADeviceSession: Codable, Equatable {
    public let deviceId: String
    public let sessionToken: String
    public let expiresAt: Date

    public init(deviceId: String, sessionToken: String, expiresAt: Date) {
        self.deviceId = deviceId
        self.sessionToken = sessionToken
        self.expiresAt = expiresAt
    }
    /// Compare persisted authority snapshots without Unicode normalization.
    public static func == (left: PCADeviceSession, right: PCADeviceSession) -> Bool {
        (left.deviceId.utf8.elementsEqual(right.deviceId.utf8)) &&
        (left.sessionToken.utf8.elementsEqual(right.sessionToken.utf8)) &&
        (left.expiresAt == right.expiresAt)
    }

}

public struct PCAEnrollmentAttempt: Codable, Equatable {
    public let attemptId: String
    public let attemptRecoveryToken: String

    public init(attemptId: String, attemptRecoveryToken: String) {
        self.attemptId = attemptId
        self.attemptRecoveryToken = attemptRecoveryToken
    }
    /// Compare persisted authority snapshots without Unicode normalization.
    public static func == (left: PCAEnrollmentAttempt, right: PCAEnrollmentAttempt) -> Bool {
        (left.attemptId.utf8.elementsEqual(right.attemptId.utf8)) &&
        (left.attemptRecoveryToken.utf8.elementsEqual(right.attemptRecoveryToken.utf8))
    }

}

public protocol PCADeviceSessionStore {
    func loadSession() throws -> PCADeviceSession?
    func saveSession(_ session: PCADeviceSession) throws
    func clearSession() throws
}

public protocol PCAEnrollmentAttemptStore {
    func loadAttempt() throws -> PCAEnrollmentAttempt?
    func saveAttempt(_ attempt: PCAEnrollmentAttempt) throws
    func clearAttempt() throws
}

/// Session and recovery material are secrets/security-sensitive state. Both
/// are encoded only into Keychain data; UserDefaults is intentionally used
/// for neither bearer tokens nor attempt recovery tokens.
public final class PCAKeychainDeviceStateStore: PCADeviceSessionStore, PCAEnrollmentAttemptStore {
    private let keychain: KeychainStoreProtocol
    private let service: String
    private let sessionAccount: String
    private let attemptAccount: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(keychain: KeychainStoreProtocol, serviceNamespace: String, deviceIdentity: String = "current") {
        self.keychain = keychain
        self.service = "\(serviceNamespace).device-state"
        self.sessionAccount = "\(deviceIdentity).session"
        self.attemptAccount = "\(deviceIdentity).enrollment-attempt"
    }

    public func loadSession() throws -> PCADeviceSession? {
        try loadValue(PCADeviceSession.self, account: sessionAccount)
    }

    public func saveSession(_ session: PCADeviceSession) throws {
        try saveValue(session, account: sessionAccount)
    }

    public func clearSession() throws {
        try keychain.delete(forAccount: sessionAccount, service: service)
    }

    public func loadAttempt() throws -> PCAEnrollmentAttempt? {
        try loadValue(PCAEnrollmentAttempt.self, account: attemptAccount)
    }

    public func saveAttempt(_ attempt: PCAEnrollmentAttempt) throws {
        try saveValue(attempt, account: attemptAccount)
    }

    public func clearAttempt() throws {
        try keychain.delete(forAccount: attemptAccount, service: service)
    }

    private func saveValue<T: Encodable>(_ value: T, account: String) throws {
        try keychain.store(try encoder.encode(value), forAccount: account, service: service, accessibility: .whenUnlockedThisDeviceOnly)
    }

    private func loadValue<T: Decodable>(_ type: T.Type, account: String) throws -> T? {
        do {
            return try decoder.decode(type, from: keychain.retrieve(forAccount: account, service: service))
        } catch KeychainStoreError.itemNotFound {
            return nil
        } catch {
            throw KeychainStoreError.unexpectedStatus(-1)
        }
    }
}

public final class InMemoryPCADeviceStateStore: PCADeviceSessionStore, PCAEnrollmentAttemptStore {
    private var session: PCADeviceSession?
    private var attempt: PCAEnrollmentAttempt?
    public init() {}
    public func loadSession() throws -> PCADeviceSession? { session }
    public func saveSession(_ value: PCADeviceSession) throws { session = value }
    public func clearSession() throws { session = nil }
    public func loadAttempt() throws -> PCAEnrollmentAttempt? { attempt }
    public func saveAttempt(_ value: PCAEnrollmentAttempt) throws { attempt = value }
    public func clearAttempt() throws { attempt = nil }
}
