import Foundation

public enum OrdinaryTrustSetError: Error, Equatable {
    case malformedState, scopeMismatch, unauthorizedSigner, staleCandidate, pendingSubmission, responseMismatch
}

/// An authenticated server projection. It remains distinct from a cryptographically
/// verified mobile policy anchor; this coordinator never installs policy or activates devices.
public struct OrdinaryTrustSetHead: Codable, Equatable {
    public let familyId: String
    public let canonicalBytes: Data
    public let signature: String
    public init(familyId: String, canonicalBytes: Data, signature: String) {
        self.familyId = familyId; self.canonicalBytes = canonicalBytes; self.signature = signature
    }
    public func epoch() throws -> UntrustedTrustSetEpoch {
        guard canonicalBytes.count <= 262_144, !signature.isEmpty, signature.utf8.count <= 512 else {
            throw OrdinaryTrustSetError.malformedState
        }
        let value = try FamilyTrustSetCodec.decodeCanonical(canonicalBytes)
        guard Data(value.familyId.utf8) == Data(familyId.utf8),
              try FamilyTrustSetCodec.canonicalize(value) == canonicalBytes,
              value.keyEpoch >= 1 else { throw OrdinaryTrustSetError.malformedState }
        return value
    }
}

/// Persist the complete signed request before transport. No private key or session token lives here.
public struct OrdinaryTrustSetPending: Codable, Equatable {
    public let previousHead: OrdinaryTrustSetHead
    public let candidate: OrdinaryTrustSetHead
    public let signerDeviceId: String
    public let signerKeyId: String
    public init(previousHead: OrdinaryTrustSetHead, candidate: OrdinaryTrustSetHead, signerDeviceId: String, signerKeyId: String) {
        self.previousHead = previousHead; self.candidate = candidate
        self.signerDeviceId = signerDeviceId; self.signerKeyId = signerKeyId
    }
    public func validate() throws {
        let before = try previousHead.epoch(), after = try candidate.epoch()
        guard Data(before.familyId.utf8) == Data(after.familyId.utf8) else { throw OrdinaryTrustSetError.scopeMismatch }
        guard before.trustSetEpoch < Int(Int32.max),
              after.trustSetEpoch == before.trustSetEpoch + 1,
              after.supersedesEpoch == before.trustSetEpoch,
              after.keyEpoch >= before.keyEpoch else { throw OrdinaryTrustSetError.staleCandidate }
        let owners = before.entries.filter { $0.role == .owner && $0.status == .active }
        let nextOwners = after.entries.filter { $0.role == .owner && $0.status == .active }
        guard owners.count == 1, nextOwners.count == 1 else { throw OrdinaryTrustSetError.unauthorizedSigner }
        let owner = owners[0], next = nextOwners[0]
        guard Data(owner.deviceId.utf8) == Data(signerDeviceId.utf8),
              Data(owner.dskKeyId.utf8) == Data(signerKeyId.utf8),
              Data(next.deviceId.utf8) == Data(owner.deviceId.utf8),
              Data(next.dskKeyId.utf8) == Data(owner.dskKeyId.utf8),
              Data(next.dskPublicKey.utf8) == Data(owner.dskPublicKey.utf8) else { throw OrdinaryTrustSetError.unauthorizedSigner }
    }
}

public struct OrdinaryTrustSetRecord: Codable, Equatable {
    public var head: OrdinaryTrustSetHead
    public var pending: OrdinaryTrustSetPending?
    public init(head: OrdinaryTrustSetHead, pending: OrdinaryTrustSetPending? = nil) {
        self.head = head; self.pending = pending
    }
    public func validate() throws {
        _ = try head.epoch()
        if let pending {
            try pending.validate()
            guard pending.previousHead == head else { throw OrdinaryTrustSetError.malformedState }
        }
    }
}

public protocol OrdinaryTrustSetStoring {
    func load() throws -> OrdinaryTrustSetRecord
    /// Must durably replace atomically, retaining the old value on failure.
    func save(_ value: OrdinaryTrustSetRecord) throws
}

public final class KeychainOrdinaryTrustSetStore: OrdinaryTrustSetStoring {
    private let keychain: KeychainStoreProtocol
    private let account: String
    private let service = "org.pca.ordinary-trust-set.v1"
    public init(keychain: KeychainStoreProtocol, account: String) { self.keychain = keychain; self.account = account }
    public func load() throws -> OrdinaryTrustSetRecord {
        let bytes = try keychain.retrieve(forAccount: account, service: service)
        guard bytes.count <= 1_048_576 else { throw OrdinaryTrustSetError.malformedState }
        let value = try JSONDecoder().decode(OrdinaryTrustSetRecord.self, from: bytes)
        try value.validate(); return value
    }
    public func save(_ value: OrdinaryTrustSetRecord) throws {
        try value.validate()
        let bytes = try JSONEncoder().encode(value)
        guard bytes.count <= 1_048_576 else { throw OrdinaryTrustSetError.malformedState }
        try keychain.storeReplacingAtomically(bytes, forAccount: account, service: service, accessibility: .whenUnlockedThisDeviceOnly)
    }
}

public enum OrdinaryTrustSetSubmissionResult {
    case accepted(OrdinaryTrustSetHead)
    case rejected
    case unknown
}

/// Authenticated device-session transport only. Implementations must not follow cross-origin
/// redirects or accept caller-supplied Parent/browser signing credentials.
public protocol OrdinaryTrustSetTransport {
    func submit(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult
    func status(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult
    func acceptedHead(familyId: String) async throws -> OrdinaryTrustSetHead
}

public protocol OrdinaryTrustSetSignatureVerifying {
    func verify(signature: String, canonicalBytes: Data, publicKey: String) throws -> Bool
}

public final class OrdinaryTrustSetCoordinator {
    private let store: OrdinaryTrustSetStoring
    private let signer: FirstDeviceDskSigning
    private let verifier: OrdinaryTrustSetSignatureVerifying
    private let transport: OrdinaryTrustSetTransport
    private let familyId: String, deviceId: String, dskKeyId: String, dskAlias: String
    private let gate = FirstDeviceSingleFlightGate()
    public init(store: OrdinaryTrustSetStoring, signer: FirstDeviceDskSigning, verifier: OrdinaryTrustSetSignatureVerifying, transport: OrdinaryTrustSetTransport,
                familyId: String, deviceId: String, dskKeyId: String, dskAlias: String) {
        self.store = store; self.signer = signer; self.verifier = verifier; self.transport = transport
        self.familyId = familyId; self.deviceId = deviceId; self.dskKeyId = dskKeyId; self.dskAlias = dskAlias
    }
    /// Signs once. A failed persistence never sends; a persisted attempt is immutable until authoritative acceptance.
    public func prepare(_ candidate: UntrustedTrustSetEpoch) async throws {
        try await gate.run {
            var record = try self.checkedRecord()
            guard record.pending == nil else { throw OrdinaryTrustSetError.pendingSubmission }
            let bytes = try FamilyTrustSetCodec.canonicalize(candidate)
            let unsigned = OrdinaryTrustSetHead(familyId: self.familyId, canonicalBytes: bytes, signature: "pending")
            let draft = OrdinaryTrustSetPending(previousHead: record.head, candidate: unsigned,
                signerDeviceId: self.deviceId, signerKeyId: self.dskKeyId)
            try draft.validate()
            let signature = try self.signer.signCanonical(alias: self.dskAlias, message: bytes)
            guard signature.count == 64 else { throw OrdinaryTrustSetError.malformedState }
            let encoded = signature.base64EncodedString().replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            record.pending = OrdinaryTrustSetPending(previousHead: record.head,
                candidate: OrdinaryTrustSetHead(familyId: self.familyId, canonicalBytes: bytes, signature: encoded),
                signerDeviceId: self.deviceId, signerKeyId: self.dskKeyId)
            try self.verifyPending(record.pending!)
            try self.store.save(record)
        }
    }
    /// A network exception leaves the same durable request available after restart. Never re-signs.
    public func submitPending() async throws -> OrdinaryTrustSetSubmissionResult {
        try await gate.run {
            let record = try self.checkedRecord()
            guard let pending = record.pending else { throw OrdinaryTrustSetError.pendingSubmission }
            try self.verifyPending(pending)
            let result = try await self.transport.submit(pending)
            if case let .accepted(head) = result { try self.acceptExact(head, record: record, pending: pending) }
            return result
        }
    }
    /// A lost-response recovery is successful only when the authoritative head exactly matches the signed request.
    /// A newer/different head must be processed by a verified chain adoption flow, never guessed here.
    public func reconcile() async throws -> Bool {
        try await gate.run {
            let record = try self.checkedRecord()
            guard let pending = record.pending else { return false }
            let result = try await self.transport.status(pending)
            guard case let .accepted(head) = result else { return false }
            try self.acceptExact(head, record: record, pending: pending)
            return true
        }
    }
    private func checkedRecord() throws -> OrdinaryTrustSetRecord {
        let value = try store.load(); try value.validate()
        guard Data(value.head.familyId.utf8) == Data(familyId.utf8),
              value.pending.map({ Data($0.signerDeviceId.utf8) == Data(deviceId.utf8) && Data($0.signerKeyId.utf8) == Data(dskKeyId.utf8) }) ?? true else { throw OrdinaryTrustSetError.scopeMismatch }
        return value
    }
    private func verifyPending(_ pending: OrdinaryTrustSetPending) throws {
        try pending.validate()
        let before = try pending.previousHead.epoch()
        guard let owner = before.entries.first(where: { $0.role == .owner && $0.status == .active }),
              try verifier.verify(signature: pending.candidate.signature, canonicalBytes: pending.candidate.canonicalBytes,
                                  publicKey: owner.dskPublicKey) else { throw OrdinaryTrustSetError.unauthorizedSigner }
    }
    private func acceptExact(_ head: OrdinaryTrustSetHead, record: OrdinaryTrustSetRecord, pending: OrdinaryTrustSetPending) throws {
        _ = try head.epoch()
        try verifyPending(pending)
        guard head == pending.candidate else { throw OrdinaryTrustSetError.responseMismatch }
        var updated = record; updated.head = head; updated.pending = nil
        try store.save(updated)
    }
}
