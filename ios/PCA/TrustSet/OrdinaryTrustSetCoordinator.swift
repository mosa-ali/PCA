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
        guard value.entries.filter({ $0.role == .owner && $0.status == .active }).count == 1 else { throw OrdinaryTrustSetError.malformedState }
        var devices = Set<Data>(), ids = Set<Data>(), keys = Set<Data>()
        for entry in value.entries {
            guard devices.insert(Data(entry.deviceId.utf8)).inserted,
                  ids.insert(Data(entry.dskKeyId.utf8)).inserted, ids.insert(Data(entry.dekKeyId.utf8)).inserted,
                  keys.insert(Data(entry.dskPublicKey.utf8)).inserted, keys.insert(Data(entry.dekPublicKey.utf8)).inserted else {
                throw OrdinaryTrustSetError.malformedState
            }
        }
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
              after.trustSetEpoch > before.trustSetEpoch,
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
    public var rootAnchor: OrdinaryTrustSetHead?
    public var pending: OrdinaryTrustSetPending?
    public init(head: OrdinaryTrustSetHead, pending: OrdinaryTrustSetPending? = nil, rootAnchor: OrdinaryTrustSetHead? = nil) {
        self.head = head; self.pending = pending; self.rootAnchor = rootAnchor
    }
    public func validate() throws {
        let current = try head.epoch()
        if let rootAnchor {
            let root = try rootAnchor.epoch()
            guard root.trustSetEpoch == 1, root.keyEpoch == 1, root.supersedesEpoch == nil,
                  Data(root.familyId.utf8) == Data(current.familyId.utf8), current.trustSetEpoch >= root.trustSetEpoch,
                  current.keyEpoch >= root.keyEpoch else { throw OrdinaryTrustSetError.malformedState }
        }
        if let pending {
            try pending.validate()
            let previous = try pending.previousHead.epoch()
            guard Data(previous.familyId.utf8) == Data(current.familyId.utf8),
                  previous.trustSetEpoch <= current.trustSetEpoch, previous.keyEpoch <= current.keyEpoch else {
                throw OrdinaryTrustSetError.malformedState
            }
            if previous.trustSetEpoch == current.trustSetEpoch, pending.previousHead != head { throw OrdinaryTrustSetError.malformedState }
        }
    }
}

public protocol OrdinaryTrustSetStoring {
    func load() throws -> OrdinaryTrustSetRecord
    func compareAndSetDurably(expected: OrdinaryTrustSetRecord?, next: OrdinaryTrustSetRecord) throws -> Bool
    func confirmDurable(_ expected: OrdinaryTrustSetRecord) throws -> Bool
}

public final class KeychainOrdinaryTrustSetStore: OrdinaryTrustSetStoring {
    private static let custodyLock = NSLock()
    private let keychain: KeychainStoreProtocol
    private let account: String
    private let service = "org.pca.ordinary-trust-set.v1"
    public init(keychain: KeychainStoreProtocol, account: String) { self.keychain = keychain; self.account = account }
    public func load() throws -> OrdinaryTrustSetRecord {
        Self.custodyLock.lock(); defer { Self.custodyLock.unlock() }
        return try loadUnlocked()
    }
    private func loadUnlocked() throws -> OrdinaryTrustSetRecord {
        let bytes = try keychain.retrieve(forAccount: account, service: service)
        guard bytes.count <= 1_048_576 else { throw OrdinaryTrustSetError.malformedState }
        let value = try JSONDecoder().decode(OrdinaryTrustSetRecord.self, from: bytes)
        try value.validate(); return value
    }
    private func saveUnlocked(_ value: OrdinaryTrustSetRecord) throws {
        try value.validate()
        let bytes = try JSONEncoder().encode(value)
        guard bytes.count <= 1_048_576 else { throw OrdinaryTrustSetError.malformedState }
        try keychain.storeReplacingAtomically(bytes, forAccount: account, service: service, accessibility: .whenUnlockedThisDeviceOnly)
    }
    /// Host-only custody: all instances serialize the read/replace/readback boundary.
    public func compareAndSetDurably(expected: OrdinaryTrustSetRecord?, next: OrdinaryTrustSetRecord) throws -> Bool {
        Self.custodyLock.lock(); defer { Self.custodyLock.unlock() }
        let current: OrdinaryTrustSetRecord?
        do { current = try loadUnlocked() }
        catch KeychainStoreError.itemNotFound { current = nil }
        guard current == expected else { return false }
        if let current {
            let old = try current.head.epoch(), new = try next.head.epoch()
            if let root = current.rootAnchor, next.rootAnchor != root { throw OrdinaryTrustSetError.responseMismatch }
            guard Data(old.familyId.utf8) == Data(new.familyId.utf8), new.trustSetEpoch >= old.trustSetEpoch,
                  new.keyEpoch >= old.keyEpoch else { throw OrdinaryTrustSetError.staleCandidate }
            if new.trustSetEpoch == old.trustSetEpoch, next.head != current.head { throw OrdinaryTrustSetError.responseMismatch }
        }
        try saveUnlocked(next)
        return try loadUnlocked() == next
    }
    public func confirmDurable(_ expected: OrdinaryTrustSetRecord) throws -> Bool {
        Self.custodyLock.lock(); defer { Self.custodyLock.unlock() }
        return try loadUnlocked() == expected
    }
}

public enum OrdinaryTrustSetSubmissionResult {
    case accepted(OrdinaryTrustSetHead)
    case rejected
    case unknown
}

/// Application-facing boundary for composing ordinary Trust Set work into the
/// host runtime. The coordinator remains the only production implementation.
public protocol OrdinaryTrustSetRuntimeManaging {
    /// Returns nil when there is no durable pending request. A pending request
    /// is queried first and, only when still unknown, retried byte-for-byte.
    func resumePending() async throws -> OrdinaryTrustSetSubmissionResult?
    /// Accepts a candidate from an already-authorized product flow, persists
    /// the signed request, then submits it through the device-session API.
    func prepareAndSubmit(_ candidate: UntrustedTrustSetEpoch) async throws -> OrdinaryTrustSetSubmissionResult
    /// Reconciles the accepted server head from the locally trusted predecessor.
    func catchUp(maximumRecords: Int) async throws -> Bool
}

/// Authenticated device-session transport only. Implementations must not follow cross-origin
/// redirects or accept caller-supplied Parent/browser signing credentials.
public protocol OrdinaryTrustSetTransport {
    func submit(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult
    func status(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult
    func acceptedRecord(familyId: String, epoch: Int) async throws -> OrdinaryTrustSetHead
    func acceptedHead(familyId: String) async throws -> OrdinaryTrustSetHead
}

public protocol OrdinaryTrustSetSignatureVerifying {
    func verify(signature: String, canonicalBytes: Data, publicKey: String) throws -> Bool
}

public final class OrdinaryTrustSetCoordinator: OrdinaryTrustSetRuntimeManaging {
    private let store: OrdinaryTrustSetStoring
    private let signer: FirstDeviceDskSigning
    private let verifier: OrdinaryTrustSetSignatureVerifying
    private let transport: OrdinaryTrustSetTransport
    private let trustedRootAnchor: OrdinaryTrustSetHead
    private let familyId: String, deviceId: String, dskKeyId: String, dskAlias: String
    private let gate = FirstDeviceSingleFlightGate()
    public init(store: OrdinaryTrustSetStoring, signer: FirstDeviceDskSigning, verifier: OrdinaryTrustSetSignatureVerifying, transport: OrdinaryTrustSetTransport,
                trustedRootAnchor: OrdinaryTrustSetHead,
                familyId: String, deviceId: String, dskKeyId: String, dskAlias: String) {
        self.store = store; self.signer = signer; self.verifier = verifier; self.transport = transport
        self.trustedRootAnchor = trustedRootAnchor
        self.familyId = familyId; self.deviceId = deviceId; self.dskKeyId = dskKeyId; self.dskAlias = dskAlias
    }
    /// Signs once. A failed persistence never sends; a persisted attempt is immutable until authoritative acceptance.
    public func prepare(_ candidate: UntrustedTrustSetEpoch) async throws {
        try await gate.run {
            try self.prepareUnlocked(candidate)
        }
    }
    /// A network exception leaves the same durable request available after restart. Never re-signs.
    public func submitPending() async throws -> OrdinaryTrustSetSubmissionResult {
        try await gate.run {
            try await self.submitPendingUnlocked()
        }
    }
    /// Restart-safe pending recovery. A status miss is followed by one exact
    /// replay of the persisted request; signing is never repeated here.
    public func resumePending() async throws -> OrdinaryTrustSetSubmissionResult? {
        try await gate.run {
            let record = try self.checkedRecord()
            guard let pending = record.pending else { return nil }
            try self.verifyPending(pending)
            guard try self.store.confirmDurable(record) else { throw OrdinaryTrustSetError.responseMismatch }
            switch try await self.transport.status(pending) {
            case let .accepted(head):
                try self.acceptExact(head, record: record, pending: pending)
                return .accepted(head)
            case .rejected:
                return .rejected
            case .unknown:
                return try await self.submitPendingUnlocked()
            }
        }
    }
    public func prepareAndSubmit(_ candidate: UntrustedTrustSetEpoch) async throws -> OrdinaryTrustSetSubmissionResult {
        try await gate.run {
            try self.prepareUnlocked(candidate)
            return try await self.submitPendingUnlocked()
        }
    }
    private func prepareUnlocked(_ candidate: UntrustedTrustSetEpoch) throws {
        var record = try checkedRecord()
        let expected = record
        guard record.pending == nil else { throw OrdinaryTrustSetError.pendingSubmission }
        guard candidate.trustSetEpoch == (try record.head.epoch()).trustSetEpoch + 1 else { throw OrdinaryTrustSetError.staleCandidate }
        let bytes = try FamilyTrustSetCodec.canonicalize(candidate)
        let unsigned = OrdinaryTrustSetHead(familyId: familyId, canonicalBytes: bytes, signature: "pending")
        let draft = OrdinaryTrustSetPending(previousHead: record.head, candidate: unsigned,
            signerDeviceId: deviceId, signerKeyId: dskKeyId)
        try draft.validate()
        let signature = try signer.signCanonical(alias: dskAlias, message: bytes)
        guard signature.count == 64 else { throw OrdinaryTrustSetError.malformedState }
        let encoded = signature.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        record.pending = OrdinaryTrustSetPending(previousHead: record.head,
            candidate: OrdinaryTrustSetHead(familyId: familyId, canonicalBytes: bytes, signature: encoded),
            signerDeviceId: deviceId, signerKeyId: dskKeyId)
        try verifyPending(record.pending!)
        guard try store.compareAndSetDurably(expected: expected, next: record) else { throw OrdinaryTrustSetError.responseMismatch }
    }
    private func submitPendingUnlocked() async throws -> OrdinaryTrustSetSubmissionResult {
        let record = try checkedRecord()
        guard let pending = record.pending else { throw OrdinaryTrustSetError.pendingSubmission }
        try verifyPending(pending)
        guard try store.confirmDurable(record) else { throw OrdinaryTrustSetError.responseMismatch }
        let result = try await transport.submit(pending)
        if case let .accepted(head) = result { try acceptExact(head, record: record, pending: pending) }
        return result
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
    /// Walk a bounded signed predecessor chain from the persisted trusted floor. Head projection
    /// chooses a target only; every linked hop is verified with its prior owner before durable adoption.
    /// Progress remains valid after timeout/process death; a later invocation resumes from that floor.
    @discardableResult
    public func catchUp(maximumRecords: Int = 32) async throws -> Bool {
        guard (1...64).contains(maximumRecords) else { throw OrdinaryTrustSetError.malformedState }
        return try await gate.run {
            var record = try self.checkedRecord()
            let rootOwner = try self.trustedRootOwner()
            let target = try await self.transport.acceptedHead(familyId: self.familyId)
            let targetEpoch = try self.validateTrustedHead(target, owner: rootOwner)
            let localEpoch = try record.head.epoch()
            guard targetEpoch.trustSetEpoch >= localEpoch.trustSetEpoch,
                  targetEpoch.keyEpoch >= localEpoch.keyEpoch else { throw OrdinaryTrustSetError.staleCandidate }
            if targetEpoch.trustSetEpoch == localEpoch.trustSetEpoch {
                guard Self.sameHeadExactly(target, record.head) else { throw OrdinaryTrustSetError.responseMismatch }
                return true
            }
            var chain = [OrdinaryTrustSetHead]()
            var current = target
            var anchored = false
            for _ in 0..<maximumRecords {
                let currentEpoch = try self.validateTrustedHead(current, owner: rootOwner)
                guard currentEpoch.trustSetEpoch > localEpoch.trustSetEpoch,
                      currentEpoch.keyEpoch >= localEpoch.keyEpoch else {
                    throw OrdinaryTrustSetError.staleCandidate
                }
                chain.append(current)
                // The server permits absent lineage metadata on non-genesis epochs. Since the
                // backend preserves the epoch-1 owner DSK for every ordinary append, a directly
                // verified signature from that immutable key is a safe bounded anchor.
                guard let predecessor = currentEpoch.supersedesEpoch else { anchored = true; break }
                guard predecessor < currentEpoch.trustSetEpoch else {
                    throw OrdinaryTrustSetError.staleCandidate
                }
                if predecessor <= localEpoch.trustSetEpoch { anchored = true; break }
                current = try await self.transport.acceptedRecord(familyId: self.familyId, epoch: predecessor)
                guard try current.epoch().trustSetEpoch == predecessor else { throw OrdinaryTrustSetError.responseMismatch }
            }
            guard anchored else { return false }
            for next in chain.reversed() {
                let before = try record.head.epoch()
                let nextEpoch = try self.validateTrustedHead(next, owner: rootOwner)
                guard Data(next.familyId.utf8) == Data(self.familyId.utf8),
                      nextEpoch.trustSetEpoch > before.trustSetEpoch,
                      nextEpoch.keyEpoch >= before.keyEpoch else { throw OrdinaryTrustSetError.staleCandidate }
                if let predecessor = nextEpoch.supersedesEpoch {
                    guard predecessor < nextEpoch.trustSetEpoch,
                          predecessor <= before.trustSetEpoch else { throw OrdinaryTrustSetError.responseMismatch }
                }
                let expected = record
                record.head = next
                if let pending = record.pending, Self.sameHeadExactly(pending.candidate, next) { record.pending = nil }
                guard try self.store.compareAndSetDurably(expected: expected, next: record) else { throw OrdinaryTrustSetError.responseMismatch }
            }
            return Self.sameHeadExactly(record.head, target)
        }
    }
    private func checkedRecord() throws -> OrdinaryTrustSetRecord {
        let value = try store.load(); try value.validate()
        let rootOwner = try trustedRootOwner()
        guard let storedRoot = value.rootAnchor, Self.sameHeadExactly(storedRoot, trustedRootAnchor) else {
            throw OrdinaryTrustSetError.responseMismatch
        }
        _ = try validateTrustedHead(value.head, owner: rootOwner)
        guard Data(rootOwner.deviceId.utf8) == Data(deviceId.utf8),
              Data(rootOwner.dskKeyId.utf8) == Data(dskKeyId.utf8),
              Data(value.head.familyId.utf8) == Data(familyId.utf8),
              value.pending.map({ Data($0.signerDeviceId.utf8) == Data(deviceId.utf8) && Data($0.signerKeyId.utf8) == Data(dskKeyId.utf8) }) ?? true else { throw OrdinaryTrustSetError.scopeMismatch }
        return value
    }
    private func trustedRootOwner() throws -> UntrustedTrustSetEntry {
        let root = try trustedRootAnchor.epoch()
        guard Data(trustedRootAnchor.familyId.utf8) == Data(familyId.utf8),
              root.trustSetEpoch == 1, root.keyEpoch == 1, root.supersedesEpoch == nil,
              root.entries.count == 1,
              let owner = root.entries.first, owner.role == .owner, owner.status == .active,
              try verifier.verify(signature: trustedRootAnchor.signature,
                                  canonicalBytes: trustedRootAnchor.canonicalBytes,
                                  publicKey: owner.dskPublicKey) else {
            throw OrdinaryTrustSetError.unauthorizedSigner
        }
        return owner
    }
    private func validateTrustedHead(_ head: OrdinaryTrustSetHead, owner rootOwner: UntrustedTrustSetEntry) throws -> UntrustedTrustSetEpoch {
        let epoch = try head.epoch()
        guard Data(head.familyId.utf8) == Data(familyId.utf8),
              Data(epoch.familyId.utf8) == Data(familyId.utf8) else { throw OrdinaryTrustSetError.scopeMismatch }
        guard epoch.trustSetEpoch >= 1, epoch.keyEpoch >= 1 else { throw OrdinaryTrustSetError.staleCandidate }
        if let predecessor = epoch.supersedesEpoch, predecessor >= epoch.trustSetEpoch {
            throw OrdinaryTrustSetError.staleCandidate
        }
        guard let owner = epoch.entries.first(where: { $0.role == .owner && $0.status == .active }),
              Data(owner.deviceId.utf8) == Data(rootOwner.deviceId.utf8),
              Data(owner.dskKeyId.utf8) == Data(rootOwner.dskKeyId.utf8),
              Data(owner.dskPublicKey.utf8) == Data(rootOwner.dskPublicKey.utf8) else {
            throw OrdinaryTrustSetError.unauthorizedSigner
        }
        if epoch.trustSetEpoch == 1, !Self.sameHeadExactly(head, trustedRootAnchor) {
            throw OrdinaryTrustSetError.responseMismatch
        }
        guard try verifier.verify(signature: head.signature, canonicalBytes: head.canonicalBytes,
                                  publicKey: rootOwner.dskPublicKey) else {
            throw OrdinaryTrustSetError.unauthorizedSigner
        }
        return epoch
    }
    private static func sameHeadExactly(_ lhs: OrdinaryTrustSetHead, _ rhs: OrdinaryTrustSetHead) -> Bool {
        Data(lhs.familyId.utf8) == Data(rhs.familyId.utf8)
            && lhs.canonicalBytes == rhs.canonicalBytes
            && Data(lhs.signature.utf8) == Data(rhs.signature.utf8)
    }
    private func verifyPending(_ pending: OrdinaryTrustSetPending) throws {
        try pending.validate()
        let owner = try trustedRootOwner()
        _ = try validateTrustedHead(pending.previousHead, owner: owner)
        _ = try validateTrustedHead(pending.candidate, owner: owner)
    }
    private func acceptExact(_ head: OrdinaryTrustSetHead, record: OrdinaryTrustSetRecord, pending: OrdinaryTrustSetPending) throws {
        let owner = try trustedRootOwner()
        _ = try validateTrustedHead(head, owner: owner)
        try verifyPending(pending)
        guard Self.sameHeadExactly(head, pending.candidate) else { throw OrdinaryTrustSetError.responseMismatch }
        var updated = record
        let currentEpoch = try record.head.epoch(), acceptedEpoch = try head.epoch()
        if acceptedEpoch.trustSetEpoch > currentEpoch.trustSetEpoch {
            updated.head = head
        } else if acceptedEpoch.trustSetEpoch == currentEpoch.trustSetEpoch, head != record.head {
            throw OrdinaryTrustSetError.responseMismatch
        }
        // Historical exact acceptance acknowledges custody without regressing a newer verified floor.
        updated.pending = nil
        guard try store.compareAndSetDurably(expected: record, next: updated) else { throw OrdinaryTrustSetError.responseMismatch }
    }
}
