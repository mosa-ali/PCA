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
    func pendingAcknowledgements(scope: PCAInboundScope) throws -> [PCAStoredInboundEnvelope]
    func markAcknowledged(_ envelope: PCAInboundEnvelope, scope: PCAInboundScope) throws
    func pendingCrypto(scope: PCAInboundScope) throws -> [PCAStoredInboundEnvelope]
}

/// One immutable, authenticated scope in one device-local Keychain slot.
/// Locked/corrupt storage fails closed; no eviction or plaintext fallback.
public final class PCAKeychainInboundInboxStore: PCAInboundInboxStoring {
    private struct Snapshot: Codable {
        let version: Int
        let scope: PCAInboundScope
        var entries: [PCAStoredInboundEnvelope]
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
        Self.lock.lock(); defer { Self.lock.unlock() }
        try validateScope(response.scope)
        guard response.scope.recipientDeviceId == sessionDeviceId, response.applied.count <= maxRecords else { throw PCAInboundInboxError.unavailable }
        let existing = try read()
        guard existing == nil || existing?.scope == response.scope else { throw PCAInboundInboxError.unavailable }
        var snapshot = existing ?? Snapshot(version: 1, scope: response.scope, entries: [])
        for envelope in response.applied {
            try envelope.validate(scope: response.scope)
            if let prior = snapshot.entries.first(where: { $0.envelope.messageId == envelope.messageId }) {
                guard prior.envelope == envelope else { throw PCAInboundInboxError.unavailable }
            } else {
                guard snapshot.entries.count < maxRecords else { throw PCAInboundInboxError.unavailable }
                snapshot.entries.append(PCAStoredInboundEnvelope(envelope: envelope, relayAcknowledged: false, processingState: "PENDING_CRYPTO"))
            }
        }
        try persist(snapshot)
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
        guard let index = snapshot.entries.firstIndex(where: { $0.envelope.messageId == envelope.messageId }),
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
              snapshot.version == 1, snapshot.entries.count <= maxRecords else { throw PCAInboundInboxError.unavailable }
        try validateScope(snapshot.scope)
        var seen = Set<String>()
        for record in snapshot.entries {
            guard record.processingState == "PENDING_CRYPTO", seen.insert(record.envelope.messageId).inserted else { throw PCAInboundInboxError.unavailable }
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
}

public struct PCAEnrollmentAttempt: Codable, Equatable {
    public let attemptId: String
    public let attemptRecoveryToken: String

    public init(attemptId: String, attemptRecoveryToken: String) {
        self.attemptId = attemptId
        self.attemptRecoveryToken = attemptRecoveryToken
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
