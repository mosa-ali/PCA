import Foundation

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
