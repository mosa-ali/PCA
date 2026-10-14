import Foundation

public enum OrdinaryTrustSetError: Error, Equatable {
    case malformedState, scopeMismatch, unauthorizedSigner, staleCandidate, pendingSubmission, responseMismatch
}

/// Bounds the canonical epoch included in an OrdinaryEpochTransportV1 request.
/// This is intentionally narrower than the general epoch codec/head bound.
enum OrdinaryTrustSetRequestLimits {
    static let maximumCanonicalBytes = 196_506

    static func validateCandidateCanonicalBytes(_ bytes: Data) throws {
        guard bytes.count <= maximumCanonicalBytes else { throw OrdinaryTrustSetError.malformedState }
    }
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
        try OrdinaryTrustSetRequestLimits.validateCandidateCanonicalBytes(candidate.canonicalBytes)
        let before = try previousHead.epoch(), after = try candidate.epoch()
        guard Data(before.familyId.utf8) == Data(after.familyId.utf8) else { throw OrdinaryTrustSetError.scopeMismatch }
        guard before.trustSetEpoch < Int(Int32.max),
              after.trustSetEpoch > before.trustSetEpoch,
              after.supersedesEpoch == before.trustSetEpoch,
              after.keyEpoch >= before.keyEpoch else { throw OrdinaryTrustSetError.staleCandidate }
        let owners = before.entries.filter { $0.role == .owner && $0.status == .active }
        let nextOwners = after.entries.filter { $0.role == .owner && $0.status == .active }
        guard owners.count == 1, nextOwners.count == 1 else { throw OrdinaryTrustSetError.unauthorizedSigner }
        let owner = owners[0]
        let nextOwner = nextOwners[0]
        guard Data(owner.deviceId.utf8) == Data(signerDeviceId.utf8),
              Data(owner.dskKeyId.utf8) == Data(signerKeyId.utf8) else { throw OrdinaryTrustSetError.unauthorizedSigner }
        // OrdinaryEpochTransportV1 mirrors backend same-owner acceptance.
        // Owner transfer requires a separately approved protocol.
        guard Data(nextOwner.deviceId.utf8) == Data(owner.deviceId.utf8),
              Data(nextOwner.dskKeyId.utf8) == Data(owner.dskKeyId.utf8),
              Data(nextOwner.dskPublicKey.utf8) == Data(owner.dskPublicKey.utf8) else {
            throw OrdinaryTrustSetError.unauthorizedSigner
        }
    }
}

public struct OrdinaryTrustSetRecord: Codable, Equatable {
    public var head: OrdinaryTrustSetHead
    public var rootAnchor: OrdinaryTrustSetHead?
    /// Exact previous accepted head that authorized `head`. Nil is retained
    /// for backward decoding of root-owner-only records; the first verified
    /// advance materializes this checkpoint.
    public var acceptedBase: OrdinaryTrustSetHead?
    public var pending: OrdinaryTrustSetPending?
    public init(head: OrdinaryTrustSetHead, pending: OrdinaryTrustSetPending? = nil, rootAnchor: OrdinaryTrustSetHead? = nil,
                acceptedBase: OrdinaryTrustSetHead? = nil) {
        self.head = head; self.pending = pending; self.rootAnchor = rootAnchor; self.acceptedBase = acceptedBase
    }
    public func validate() throws {
        let current = try head.epoch()
        if let rootAnchor {
            let root = try rootAnchor.epoch()
            guard root.trustSetEpoch == 1, root.keyEpoch == 1, root.supersedesEpoch == nil,
                  Data(root.familyId.utf8) == Data(current.familyId.utf8), current.trustSetEpoch >= root.trustSetEpoch,
                  current.keyEpoch >= root.keyEpoch else { throw OrdinaryTrustSetError.malformedState }
        }
        if let acceptedBase {
            let base = try acceptedBase.epoch()
            guard Data(base.familyId.utf8) == Data(current.familyId.utf8),
                  current.trustSetEpoch > base.trustSetEpoch,
                  current.keyEpoch >= base.keyEpoch,
                  current.supersedesEpoch == base.trustSetEpoch else { throw OrdinaryTrustSetError.malformedState }
            if let rootAnchor {
                let root = try rootAnchor.epoch()
                guard base.trustSetEpoch >= root.trustSetEpoch, base.keyEpoch >= root.keyEpoch else {
                    throw OrdinaryTrustSetError.malformedState
                }
                if base.trustSetEpoch == 1, !OrdinaryTrustSetRecord.sameHeadExactly(acceptedBase, rootAnchor) {
                    throw OrdinaryTrustSetError.malformedState
                }
            }
        }
        if let pending {
            try pending.validate()
            let previous = try pending.previousHead.epoch()
            guard Data(previous.familyId.utf8) == Data(current.familyId.utf8),
                  previous.trustSetEpoch <= current.trustSetEpoch, previous.keyEpoch <= current.keyEpoch else {
                throw OrdinaryTrustSetError.malformedState
            }
            if previous.trustSetEpoch == current.trustSetEpoch,
               !OrdinaryTrustSetRecord.sameHeadExactly(pending.previousHead, head) { throw OrdinaryTrustSetError.malformedState }
        }
    }

    fileprivate static func sameHeadExactly(_ lhs: OrdinaryTrustSetHead, _ rhs: OrdinaryTrustSetHead) -> Bool {
        Data(lhs.familyId.utf8) == Data(rhs.familyId.utf8)
            && lhs.canonicalBytes == rhs.canonicalBytes
            && Data(lhs.signature.utf8) == Data(rhs.signature.utf8)
    }

    fileprivate static func sameHeadExactlyOptional(_ lhs: OrdinaryTrustSetHead?, _ rhs: OrdinaryTrustSetHead?) -> Bool {
        switch (lhs, rhs) {
        case (nil, nil): return true
        case let (left?, right?): return sameHeadExactly(left, right)
        default: return false
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
        do { try StrictJSONDocument.validateNoDuplicateMembers(bytes) }
        catch { throw OrdinaryTrustSetError.malformedState }
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
        guard Self.sameRecordExactlyOptional(current, expected) else { return false }
        if let current {
            // A persisted request is immutable custody. It may be retained
            // exactly or retired after verified acceptance/catch-up, but a
            // caller cannot replace its canonical bytes or signature in place.
            if let pending = current.pending, let nextPending = next.pending,
               !Self.samePendingExactly(pending, nextPending) {
                throw OrdinaryTrustSetError.responseMismatch
            }
            let old = try current.head.epoch(), new = try next.head.epoch()
            if !OrdinaryTrustSetRecord.sameHeadExactlyOptional(current.rootAnchor, next.rootAnchor) { throw OrdinaryTrustSetError.responseMismatch }
            guard Data(old.familyId.utf8) == Data(new.familyId.utf8), new.trustSetEpoch >= old.trustSetEpoch,
                  new.keyEpoch >= old.keyEpoch else { throw OrdinaryTrustSetError.staleCandidate }
            if new.trustSetEpoch == old.trustSetEpoch {
                if !OrdinaryTrustSetRecord.sameHeadExactly(next.head, current.head) ||
                    !OrdinaryTrustSetRecord.sameHeadExactlyOptional(next.acceptedBase, current.acceptedBase) {
                    throw OrdinaryTrustSetError.responseMismatch
                }
            } else if !OrdinaryTrustSetRecord.sameHeadExactlyOptional(next.acceptedBase, current.head) {
                throw OrdinaryTrustSetError.responseMismatch
            }
        } else if let root = next.rootAnchor,
                  (next.acceptedBase != nil || !OrdinaryTrustSetRecord.sameHeadExactly(next.head, root)) {
            throw OrdinaryTrustSetError.responseMismatch
        }
        try saveUnlocked(next)
        return Self.sameRecordExactly(try loadUnlocked(), next)
    }
    private static func sameRecordExactly(_ lhs: OrdinaryTrustSetRecord, _ rhs: OrdinaryTrustSetRecord) -> Bool {
        OrdinaryTrustSetRecord.sameHeadExactly(lhs.head, rhs.head)
            && OrdinaryTrustSetRecord.sameHeadExactlyOptional(lhs.rootAnchor, rhs.rootAnchor)
            && OrdinaryTrustSetRecord.sameHeadExactlyOptional(lhs.acceptedBase, rhs.acceptedBase)
            && samePendingExactlyOptional(lhs.pending, rhs.pending)
    }
    private static func sameRecordExactlyOptional(_ lhs: OrdinaryTrustSetRecord?, _ rhs: OrdinaryTrustSetRecord?) -> Bool {
        switch (lhs, rhs) {
        case (nil, nil): return true
        case let (left?, right?): return sameRecordExactly(left, right)
        default: return false
        }
    }
    private static func samePendingExactly(_ lhs: OrdinaryTrustSetPending, _ rhs: OrdinaryTrustSetPending) -> Bool {
        OrdinaryTrustSetRecord.sameHeadExactly(lhs.previousHead, rhs.previousHead)
            && OrdinaryTrustSetRecord.sameHeadExactly(lhs.candidate, rhs.candidate)
            && Data(lhs.signerDeviceId.utf8) == Data(rhs.signerDeviceId.utf8)
            && Data(lhs.signerKeyId.utf8) == Data(rhs.signerKeyId.utf8)
    }
    private static func samePendingExactlyOptional(_ lhs: OrdinaryTrustSetPending?, _ rhs: OrdinaryTrustSetPending?) -> Bool {
        switch (lhs, rhs) {
        case (nil, nil): return true
        case let (left?, right?): return samePendingExactly(left, right)
        default: return false
        }
    }
    public func confirmDurable(_ expected: OrdinaryTrustSetRecord) throws -> Bool {
        Self.custodyLock.lock(); defer { Self.custodyLock.unlock() }
        return Self.sameRecordExactly(try loadUnlocked(), expected)
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
            try await self.prepareUnlocked(candidate)
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
                // A terminal conflict can leave this immutable request based
                // on an obsolete accepted floor. Reconcile only from the
                // authenticated accepted head and retire the request through
                // the same fully verified predecessor-chain path used by
                // ordinary catch-up. An unchanged head or unavailable chain
                // leaves the exact signed request in custody.
                let serverHead: OrdinaryTrustSetHead
                do {
                    serverHead = try await self.transport.acceptedHead(familyId: self.familyId)
                } catch {
                    return .rejected
                }
                if Self.sameHeadExactly(serverHead, pending.candidate) {
                    try self.acceptExact(serverHead, record: record, pending: pending)
                    return .accepted(serverHead)
                }
                if !Self.sameHeadExactly(serverHead, pending.previousHead) {
                    do {
                        _ = try await self.catchUpUnlocked(maximumRecords: 32)
                    } catch {
                        // An unavailable or invalid predecessor chain leaves
                        // the existing immutable request available for a
                        // later recovery attempt.
                        return .rejected
                    }
                }
                return .rejected
            case .unknown:
                // Do not replay an attempt against a predecessor that is no
                // longer the authoritative head. First prove and adopt the
                // accepted descendant; catch-up retires this request only
                // after verifying the complete predecessor chain.
                let serverHead = try await self.transport.acceptedHead(familyId: self.familyId)
                if Self.sameHeadExactly(serverHead, pending.candidate) {
                    try self.acceptExact(serverHead, record: record, pending: pending)
                    return .accepted(serverHead)
                }
                if !Self.sameHeadExactly(serverHead, pending.previousHead) {
                    let remoteEpoch = try self.validateHeadStructure(serverHead)
                    let previousEpoch = try pending.previousHead.epoch()
                    guard remoteEpoch.trustSetEpoch > previousEpoch.trustSetEpoch,
                          remoteEpoch.keyEpoch >= previousEpoch.keyEpoch else {
                        throw OrdinaryTrustSetError.responseMismatch
                    }
                    _ = try await self.catchUpUnlocked(maximumRecords: 32)
                    return .unknown
                }
                return try await self.submitPendingUnlocked()
            }
        }
    }
    public func prepareAndSubmit(_ candidate: UntrustedTrustSetEpoch) async throws -> OrdinaryTrustSetSubmissionResult {
        try await gate.run {
            try await self.prepareUnlocked(candidate)
            return try await self.submitPendingUnlocked()
        }
    }
    private func prepareUnlocked(_ candidate: UntrustedTrustSetEpoch) async throws {
        var record = try checkedRecord()
        let expected = record
        guard record.pending == nil else { throw OrdinaryTrustSetError.pendingSubmission }
        let accepted = try record.head.epoch()
        guard accepted.trustSetEpoch < Int(Int32.max), candidate.trustSetEpoch > accepted.trustSetEpoch else {
            throw OrdinaryTrustSetError.staleCandidate
        }
        let bytes = try FamilyTrustSetCodec.canonicalize(candidate)
        try OrdinaryTrustSetRequestLimits.validateCandidateCanonicalBytes(bytes)
        let unsigned = OrdinaryTrustSetHead(familyId: familyId, canonicalBytes: bytes, signature: "pending")
        let draft = OrdinaryTrustSetPending(previousHead: record.head, candidate: unsigned,
            signerDeviceId: deviceId, signerKeyId: dskKeyId)
        try draft.validate()
        // Reject malformed or unauthorized local candidates before any network
        // activity. The server head remains authoritative and is rechecked
        // immediately before signing, so this ordering does not weaken the floor.
        let serverHead = try await transport.acceptedHead(familyId: familyId)
        guard Self.sameHeadExactly(serverHead, record.head) else { throw OrdinaryTrustSetError.responseMismatch }
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
        let serverHead = try await transport.acceptedHead(familyId: familyId)
        if Self.sameHeadExactly(serverHead, pending.candidate) {
            try acceptExact(serverHead, record: record, pending: pending)
            return .accepted(serverHead)
        }
        guard Self.sameHeadExactly(record.head, pending.previousHead),
              Self.sameHeadExactly(serverHead, pending.previousHead) else {
            throw OrdinaryTrustSetError.responseMismatch
        }
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
            try self.verifyPending(pending)
            guard try self.store.confirmDurable(record) else { throw OrdinaryTrustSetError.responseMismatch }
            let result = try await self.transport.status(pending)
            guard case let .accepted(head) = result else { return false }
            try self.acceptExact(head, record: record, pending: pending)
            return true
        }
    }
    /// Walk a bounded signed predecessor chain from the persisted accepted head. The immutable root
    /// anchors the family; every linked hop is verified by the immediately prior Owner before adoption.
    /// Progress remains valid after timeout/process death; a later invocation resumes from that floor.
    @discardableResult
    public func catchUp(maximumRecords: Int = 32) async throws -> Bool {
        guard (1...64).contains(maximumRecords) else { throw OrdinaryTrustSetError.malformedState }
        return try await gate.run { try await self.catchUpUnlocked(maximumRecords: maximumRecords) }
    }
    private func catchUpUnlocked(maximumRecords: Int) async throws -> Bool {
            var record = try checkedRecord()
            let target = try await transport.acceptedHead(familyId: familyId)
            let targetEpoch = try validateHeadStructure(target)
            let localEpoch = try record.head.epoch()
            guard targetEpoch.trustSetEpoch >= localEpoch.trustSetEpoch,
                  targetEpoch.keyEpoch >= localEpoch.keyEpoch else { throw OrdinaryTrustSetError.staleCandidate }
            if targetEpoch.trustSetEpoch == localEpoch.trustSetEpoch {
                guard Self.sameHeadExactly(target, record.head) else { throw OrdinaryTrustSetError.responseMismatch }
                if let pending = record.pending, !Self.sameHeadExactly(pending.previousHead, record.head) {
                    // A durable attempt based on any older predecessor is no
                    // longer retryable once the exact accepted floor is proven.
                    let expected = record
                    record.pending = nil
                    guard try store.compareAndSetDurably(expected: expected, next: record) else {
                        throw OrdinaryTrustSetError.responseMismatch
                    }
                }
                return true
            }
            var chain = [OrdinaryTrustSetHead]()
            var current = target
            var anchored = false
            for _ in 0..<maximumRecords {
                let currentEpoch = try validateHeadStructure(current)
                guard currentEpoch.trustSetEpoch > localEpoch.trustSetEpoch,
                      currentEpoch.keyEpoch >= localEpoch.keyEpoch else {
                    throw OrdinaryTrustSetError.staleCandidate
                }
                chain.append(current)
                // Catch-up proves exact predecessor continuity back to the
                // current persisted floor; every hop is checked against its
                // immediately prior accepted Owner and record.
                guard let predecessor = currentEpoch.supersedesEpoch else { return false }
                guard predecessor < currentEpoch.trustSetEpoch else {
                    throw OrdinaryTrustSetError.staleCandidate
                }
                if predecessor == localEpoch.trustSetEpoch { anchored = true; break }
                // An older pointer describes a branch that does not descend from our local head.
                guard predecessor > localEpoch.trustSetEpoch else { return false }
                current = try await transport.acceptedRecord(familyId: familyId, epoch: predecessor)
                guard try current.epoch().trustSetEpoch == predecessor else { throw OrdinaryTrustSetError.responseMismatch }
            }
            guard anchored else { return false }
            for next in chain.reversed() {
                let before = try record.head.epoch()
                let nextEpoch = try validateSuccessor(next, previous: record.head)
                guard Data(next.familyId.utf8) == Data(familyId.utf8),
                      nextEpoch.trustSetEpoch > before.trustSetEpoch,
                      nextEpoch.keyEpoch >= before.keyEpoch else { throw OrdinaryTrustSetError.staleCandidate }
                guard nextEpoch.supersedesEpoch == before.trustSetEpoch else {
                    throw OrdinaryTrustSetError.responseMismatch
                }
                let expected = record
                record.acceptedBase = record.head
                record.head = next
                // Any accepted-head advance invalidates an attempt based on the
                // prior floor. Exact acceptance is also cleared here; preserving
                // a different branch (even with a higher candidate epoch) would
                // cause restart-safe retries to remain stale or be replayed.
                record.pending = nil
                guard try store.compareAndSetDurably(expected: expected, next: record) else { throw OrdinaryTrustSetError.responseMismatch }
            }
            return Self.sameHeadExactly(record.head, target)
    }
    private func checkedRecord() throws -> OrdinaryTrustSetRecord {
        let value = try store.load(); try value.validate()
        let rootOwner = try trustedRootOwner()
        guard let storedRoot = value.rootAnchor, Self.sameHeadExactly(storedRoot, trustedRootAnchor) else {
            throw OrdinaryTrustSetError.responseMismatch
        }
        if let acceptedBase = value.acceptedBase {
            let baseEpoch = try validateHeadStructure(acceptedBase)
            guard Data(acceptedBase.familyId.utf8) == Data(familyId.utf8),
                  baseEpoch.trustSetEpoch >= 1, baseEpoch.keyEpoch >= 1,
                  Data(value.head.familyId.utf8) == Data(familyId.utf8) else {
                throw OrdinaryTrustSetError.scopeMismatch
            }
            let rootEpoch = try trustedRootAnchor.epoch()
            guard baseEpoch.trustSetEpoch >= rootEpoch.trustSetEpoch,
                  baseEpoch.keyEpoch >= rootEpoch.keyEpoch else { throw OrdinaryTrustSetError.staleCandidate }
            if baseEpoch.trustSetEpoch == 1, !Self.sameHeadExactly(acceptedBase, trustedRootAnchor) {
                throw OrdinaryTrustSetError.responseMismatch
            }
            _ = try validateSuccessor(value.head, previous: acceptedBase)
        } else {
            // Legacy records predate the accepted-base checkpoint. They may
            // be loaded only under the original immutable genesis Owner; the
            // first verified advance creates an acceptedBase checkpoint.
            _ = try validateLegacyHead(value.head, owner: rootOwner)
        }
        guard Data(value.head.familyId.utf8) == Data(familyId.utf8) else { throw OrdinaryTrustSetError.scopeMismatch }
        if let pending = value.pending, Self.sameHeadExactly(pending.previousHead, value.head),
           (Data(pending.signerDeviceId.utf8) != Data(deviceId.utf8) ||
            Data(pending.signerKeyId.utf8) != Data(dskKeyId.utf8)) {
            throw OrdinaryTrustSetError.scopeMismatch
        }
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
    private func validateHeadStructure(_ head: OrdinaryTrustSetHead) throws -> UntrustedTrustSetEpoch {
        let epoch = try head.epoch()
        guard Data(head.familyId.utf8) == Data(familyId.utf8),
              Data(epoch.familyId.utf8) == Data(familyId.utf8) else { throw OrdinaryTrustSetError.scopeMismatch }
        guard epoch.trustSetEpoch >= 1, epoch.keyEpoch >= 1 else { throw OrdinaryTrustSetError.staleCandidate }
        if let predecessor = epoch.supersedesEpoch, predecessor >= epoch.trustSetEpoch {
            throw OrdinaryTrustSetError.staleCandidate
        }
        if epoch.trustSetEpoch == 1, !Self.sameHeadExactly(head, trustedRootAnchor) {
            throw OrdinaryTrustSetError.responseMismatch
        }
        return epoch
    }
    private func validateLegacyHead(_ head: OrdinaryTrustSetHead, owner rootOwner: UntrustedTrustSetEntry) throws -> UntrustedTrustSetEpoch {
        let epoch = try validateHeadStructure(head)
        guard let owner = epoch.entries.first(where: { $0.role == .owner && $0.status == .active }),
              Data(owner.deviceId.utf8) == Data(rootOwner.deviceId.utf8),
              Data(owner.dskKeyId.utf8) == Data(rootOwner.dskKeyId.utf8),
              Data(owner.dskPublicKey.utf8) == Data(rootOwner.dskPublicKey.utf8),
              try verifier.verify(signature: head.signature, canonicalBytes: head.canonicalBytes,
                                  publicKey: rootOwner.dskPublicKey) else {
            throw OrdinaryTrustSetError.unauthorizedSigner
        }
        return epoch
    }
    private func validateSuccessor(_ next: OrdinaryTrustSetHead, previous: OrdinaryTrustSetHead) throws -> UntrustedTrustSetEpoch {
        let before = try validateHeadStructure(previous)
        let after = try validateHeadStructure(next)
        guard Data(before.familyId.utf8) == Data(after.familyId.utf8) else { throw OrdinaryTrustSetError.scopeMismatch }
        guard after.trustSetEpoch > before.trustSetEpoch, after.keyEpoch >= before.keyEpoch,
              after.supersedesEpoch == before.trustSetEpoch else { throw OrdinaryTrustSetError.staleCandidate }
        guard let owner = before.entries.first(where: { $0.role == .owner && $0.status == .active }),
              let nextOwner = after.entries.first(where: { $0.role == .owner && $0.status == .active }),
              Data(nextOwner.deviceId.utf8) == Data(owner.deviceId.utf8),
              Data(nextOwner.dskKeyId.utf8) == Data(owner.dskKeyId.utf8),
              Data(nextOwner.dskPublicKey.utf8) == Data(owner.dskPublicKey.utf8),
              try verifier.verify(signature: next.signature, canonicalBytes: next.canonicalBytes,
                                  publicKey: owner.dskPublicKey) else { throw OrdinaryTrustSetError.unauthorizedSigner }
        return after
    }
    private static func sameHeadExactly(_ lhs: OrdinaryTrustSetHead, _ rhs: OrdinaryTrustSetHead) -> Bool {
        Data(lhs.familyId.utf8) == Data(rhs.familyId.utf8)
            && lhs.canonicalBytes == rhs.canonicalBytes
            && Data(lhs.signature.utf8) == Data(rhs.signature.utf8)
    }
    private func verifyPending(_ pending: OrdinaryTrustSetPending) throws {
        try pending.validate()
        _ = try validateHeadStructure(pending.previousHead)
        _ = try validateSuccessor(pending.candidate, previous: pending.previousHead)
    }
    private func acceptExact(_ head: OrdinaryTrustSetHead, record: OrdinaryTrustSetRecord, pending: OrdinaryTrustSetPending) throws {
        _ = try validateHeadStructure(head)
        try verifyPending(pending)
        guard Self.sameHeadExactly(head, pending.candidate) else { throw OrdinaryTrustSetError.responseMismatch }
        var updated = record
        let currentEpoch = try record.head.epoch(), acceptedEpoch = try head.epoch()
        if acceptedEpoch.trustSetEpoch > currentEpoch.trustSetEpoch {
            guard Self.sameHeadExactly(pending.previousHead, record.head) else {
                throw OrdinaryTrustSetError.responseMismatch
            }
            updated.acceptedBase = record.head
            updated.head = head
        } else if acceptedEpoch.trustSetEpoch == currentEpoch.trustSetEpoch,
                  !Self.sameHeadExactly(head, record.head) {
            throw OrdinaryTrustSetError.responseMismatch
        }
        // Historical exact acceptance acknowledges custody without regressing a newer verified floor.
        updated.pending = nil
        guard try store.compareAndSetDurably(expected: record, next: updated) else { throw OrdinaryTrustSetError.responseMismatch }
    }
}
