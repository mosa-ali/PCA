import Foundation

public enum PCAInboundInboxError: Error { case unavailable }

/// A prefix authenticates permanent numeric mode and closed coverage for this exact sender key.
/// Envelope syntax, ACKs and the largest observed sequence never establish this authority.
public struct PCAInboundReplayNumericPrefix: Codable, Equatable {
    public let senderKeyId: String
    public let through: UInt64
    public init(senderKeyId: String, through: UInt64) { self.senderKeyId = senderKeyId; self.through = through }
    public static func == (a: Self, b: Self) -> Bool { pcaOpaqueEqual(a.senderKeyId, b.senderKeyId) && a.through == b.through }
}
public struct PCAInboundReplayRetirementBoundary: Codable, Equatable {
    public let scope: PCAInboundScope
    public let authorityBinding: Data
    public let minimumTrustSetEpoch: Int
    public let minimumKeyEpoch: Int
    public let closedNumericPrefixes: [PCAInboundReplayNumericPrefix]
    public init(scope: PCAInboundScope, authorityBinding: Data, minimumTrustSetEpoch: Int,
                minimumKeyEpoch: Int, closedNumericPrefixes: [PCAInboundReplayNumericPrefix] = []) {
        self.scope = scope; self.authorityBinding = authorityBinding; self.minimumTrustSetEpoch = minimumTrustSetEpoch
        self.minimumKeyEpoch = minimumKeyEpoch; self.closedNumericPrefixes = closedNumericPrefixes
    }
}

/// Durable denial primitive, not a cryptographic verifier. Production trusted inputs remain gated.
public final class PCAInboundReplayDenialLedger {
    private struct Snapshot: Codable { let version: Int; var boundaries: [PCAInboundReplayRetirementBoundary] }
    private static let lock = NSRecursiveLock()
    private let keychain: KeychainStoreProtocol
    fileprivate let backingIdentity: AnyObject
    fileprivate let applicationCoordinationService: String
    private let service: String
    private let expectedDeviceId: String
    private let account = "current.replay-denial"
    private let requiredAccount = "required.replay-denial"
    private var requiredMarker: Data { Data(("v1:" + expectedDeviceId).utf8) }
    public init(keychain: KeychainStoreProtocol, serviceNamespace: String, expectedDeviceId: String) {
        self.keychain = keychain; self.service = serviceNamespace + ".replay-denial"; self.expectedDeviceId = expectedDeviceId
        backingIdentity = keychain as AnyObject; applicationCoordinationService = serviceNamespace + ".inbound-application"
    }
    /// Explicit first initialization only. A missing snapshot after the marker is never recreated.
    public func initializeFresh(assertAuthority: () throws -> Void) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try assertAuthority()
        guard !expectedDeviceId.isEmpty, expectedDeviceId.utf16.count <= 128 else { throw PCAInboundInboxError.unavailable }
        for entry in [account, requiredAccount] {
            do { _ = try keychain.retrieve(forAccount: entry, service: service); throw PCAInboundInboxError.unavailable }
            catch KeychainStoreError.itemNotFound { }
        }
        try keychain.storeReplacingAtomically(requiredMarker, forAccount: requiredAccount, service: service, accessibility: .whenUnlockedThisDeviceOnly)
        guard try keychain.retrieve(forAccount: requiredAccount, service: service) == requiredMarker else { throw PCAInboundInboxError.unavailable }
        try assertAuthority()
        try persist(Snapshot(version: 1, boundaries: []))
    }
    public func boundaries() throws -> [PCAInboundReplayRetirementBoundary] {
        Self.lock.lock(); defer { Self.lock.unlock() }
        return try load().boundaries
    }
    fileprivate func matchesJournal(_ journal: PCAInboundApplicationJournal) -> Bool {
        backingIdentity === journal.backingIdentity && pcaOpaqueEqual(applicationCoordinationService, journal.coordinationService)
    }
    /// Must be serialized with admission by the shared application coordinator.
    public func install(_ boundary: PCAInboundReplayRetirementBoundary, assertAuthority: () throws -> Void) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try assertAuthority(); try validate(boundary)
        var snapshot = try load()
        var prefixes = boundary.closedNumericPrefixes
        if let prior = snapshot.boundaries.first(where: { $0.scope == boundary.scope }) {
            guard boundary.minimumTrustSetEpoch >= prior.minimumTrustSetEpoch, boundary.minimumKeyEpoch >= prior.minimumKeyEpoch else { throw PCAInboundInboxError.unavailable }
            for previous in prior.closedNumericPrefixes {
                if let current = prefixes.first(where: { pcaOpaqueEqual($0.senderKeyId, previous.senderKeyId) }) {
                    guard current.through >= previous.through else { throw PCAInboundInboxError.unavailable }
                } else { prefixes.append(previous) }
            }
        }
        let merged = PCAInboundReplayRetirementBoundary(scope: boundary.scope, authorityBinding: boundary.authorityBinding,
            minimumTrustSetEpoch: boundary.minimumTrustSetEpoch, minimumKeyEpoch: boundary.minimumKeyEpoch, closedNumericPrefixes: prefixes)
        try validate(merged)
        snapshot.boundaries.removeAll { $0.scope == merged.scope }; snapshot.boundaries.append(merged)
        try assertAuthority(); try persist(snapshot); try assertAuthority()
    }
    public func isEnvelopeDenied(_ envelope: PCAInboundEnvelope, scope: PCAInboundScope) throws -> Bool {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try envelope.validate(scope: scope)
        guard pcaOpaqueEqual(scope.recipientDeviceId, expectedDeviceId) else { throw PCAInboundInboxError.unavailable }
        guard let boundary = try load().boundaries.first(where: { $0.scope == scope }) else { return false }
        if envelope.trustSetEpoch < boundary.minimumTrustSetEpoch || envelope.keyEpoch < boundary.minimumKeyEpoch { return true }
        guard let prefix = boundary.closedNumericPrefixes.first(where: { pcaOpaqueEqual($0.senderKeyId, envelope.senderKeyId) }) else { return false }
        let bytes = Array(envelope.sequenceOrNonce.utf8)
        guard !bytes.isEmpty, bytes.count <= 15, bytes.allSatisfy({ $0 >= 48 && $0 <= 57 }),
              bytes.count == 1 || bytes[0] != 48, let sequence = UInt64(envelope.sequenceOrNonce) else { return true }
        return sequence <= prefix.through
    }
    /// Declared epoch rejection is not permanent replay identity coverage.
    public func coversReplayIdentityPermanently(_ envelope: PCAInboundEnvelope, scope: PCAInboundScope) throws -> Bool {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try envelope.validate(scope: scope)
        guard pcaOpaqueEqual(scope.recipientDeviceId, expectedDeviceId) else { throw PCAInboundInboxError.unavailable }
        guard let boundary = try load().boundaries.first(where: { $0.scope == scope }),
              let prefix = boundary.closedNumericPrefixes.first(where: { pcaOpaqueEqual($0.senderKeyId, envelope.senderKeyId) }) else { return false }
        let bytes = Array(envelope.sequenceOrNonce.utf8)
        guard !bytes.isEmpty, bytes.count <= 15, bytes.allSatisfy({ $0 >= 48 && $0 <= 57 }),
              bytes.count == 1 || bytes[0] != 48, let sequence = UInt64(envelope.sequenceOrNonce) else { return true }
        return sequence <= prefix.through
    }
    private func validate(_ boundary: PCAInboundReplayRetirementBoundary) throws {
        guard pcaOpaqueEqual(boundary.scope.recipientDeviceId, expectedDeviceId),
              [boundary.scope.familyId, boundary.scope.recipientDeviceId].allSatisfy({ !$0.isEmpty && $0.utf16.count <= 128 }),
              !boundary.authorityBinding.isEmpty, boundary.authorityBinding.count <= 8192,
              boundary.minimumTrustSetEpoch >= 0, boundary.minimumTrustSetEpoch <= Int(Int32.max),
              boundary.minimumKeyEpoch >= 0, boundary.minimumKeyEpoch <= Int(Int32.max),
              boundary.closedNumericPrefixes.count <= 64 else { throw PCAInboundInboxError.unavailable }
        var senders = Set<Data>()
        for prefix in boundary.closedNumericPrefixes {
            guard !prefix.senderKeyId.isEmpty, prefix.senderKeyId.utf16.count <= 128, prefix.through <= 999_999_999_999_999,
                  senders.insert(Data(prefix.senderKeyId.utf8)).inserted else { throw PCAInboundInboxError.unavailable }
        }
    }
    private func load() throws -> Snapshot {
        guard try keychain.retrieve(forAccount: requiredAccount, service: service) == requiredMarker else { throw PCAInboundInboxError.unavailable }
        let data = try keychain.retrieve(forAccount: account, service: service)
        guard data.count <= 131072, let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data), snapshot.version == 1,
              snapshot.boundaries.count <= 16, snapshot.boundaries.reduce(0, { $0 + $1.closedNumericPrefixes.count }) <= 64 else { throw PCAInboundInboxError.unavailable }
        var scopes = Set<Data>()
        for boundary in snapshot.boundaries {
            try validate(boundary)
            guard scopes.insert(try JSONEncoder().encode([boundary.scope.familyId, boundary.scope.recipientDeviceId])).inserted else { throw PCAInboundInboxError.unavailable }
        }
        return snapshot
    }
    private func persist(_ snapshot: Snapshot) throws {
        guard try keychain.retrieve(forAccount: requiredAccount, service: service) == requiredMarker,
              snapshot.boundaries.count <= 16, snapshot.boundaries.reduce(0, { $0 + $1.closedNumericPrefixes.count }) <= 64 else { throw PCAInboundInboxError.unavailable }
        for boundary in snapshot.boundaries { try validate(boundary) }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(snapshot)
        guard data.count <= 131072 else { throw PCAInboundInboxError.unavailable }
        try keychain.storeReplacingAtomically(data, forAccount: account, service: service, accessibility: .whenUnlockedThisDeviceOnly)
        guard try keychain.retrieve(forAccount: account, service: service) == data,
              try keychain.retrieve(forAccount: requiredAccount, service: service) == requiredMarker else { throw PCAInboundInboxError.unavailable }
    }
}

/// Device-local application intent, independent of relay custody acknowledgements.
/// Authority bytes are supplied by the verified consumer; this journal establishes
/// durability only and cannot authenticate an envelope or authorize an effect.
public struct PCAInboundApplicationIntent: Codable, Equatable {
    public let operationId: String
    public let scope: PCAInboundScope
    public let envelope: PCAInboundEnvelope
    public let authorityBinding: Data
    public let acceptedCommandBinding: Data
    public let preparedAt: Date

    public init(operationId: String, scope: PCAInboundScope, envelope: PCAInboundEnvelope,
                authorityBinding: Data, acceptedCommandBinding: Data, preparedAt: Date) {
        self.operationId = operationId; self.scope = scope; self.envelope = envelope
        self.authorityBinding = authorityBinding; self.acceptedCommandBinding = acceptedCommandBinding
        self.preparedAt = preparedAt
    }
    public static func == (a: Self, b: Self) -> Bool {
        a.operationId.utf8.elementsEqual(b.operationId.utf8) && a.scope == b.scope && a.envelope == b.envelope &&
            a.authorityBinding == b.authorityBinding && a.acceptedCommandBinding == b.acceptedCommandBinding &&
            a.preparedAt == b.preparedAt
    }
    public func validate() throws {
        guard let operation = UUID(uuidString: operationId),
              operationId.utf8.elementsEqual(operation.uuidString.lowercased().utf8), preparedAt.timeIntervalSince1970.isFinite,
              !authorityBinding.isEmpty, authorityBinding.count <= 8192,
              !acceptedCommandBinding.isEmpty, acceptedCommandBinding.count <= 8192 else {
            throw PCAInboundInboxError.unavailable
        }
        try envelope.validate(scope: scope)
    }
}

public enum PCAInboundApplicationOutcome: String, Codable {
    case applied, rejected
}

public enum PCAInboundVerificationResult {
    case unavailable
    /// Bindings must come from full authenticated acceptance, never custody parsing.
    case accepted(authorityBinding: Data, commandBinding: Data, revalidateAuthority: () throws -> Void)
}
@MainActor public protocol PCAInboundCommandVerifying {
    func verify(_ envelope: PCAInboundEnvelope, scope: PCAInboundScope) async throws -> PCAInboundVerificationResult
}
@MainActor public struct PCAUnavailableInboundCommandVerifier: PCAInboundCommandVerifying {
    public init() {}
    public func verify(_ envelope: PCAInboundEnvelope, scope: PCAInboundScope) async throws -> PCAInboundVerificationResult { .unavailable }
}
public enum PCAInboundEffectRecovery {
    case unknown, notApplied, completed(PCAInboundApplicationOutcome)
}
private enum PCAInboundConsumerDeferred: Error { case timing }
@MainActor public protocol PCAInboundCommandApplying {
    /// Unknown effects remain pending. Only a proven notApplied result permits apply.
    func reconcile(_ intent: PCAInboundApplicationIntent) async throws -> PCAInboundEffectRecovery
    /// The handler must call assertAuthority immediately before its actual effect,
    /// including after any internal suspension. It must use intent.operationId
    /// as its durable idempotency/reconciliation identity.
    func apply(_ intent: PCAInboundApplicationIntent, assertAuthority: @escaping () throws -> Void) async throws -> PCAInboundApplicationOutcome
}

/// Host-process coordination only. Shared extension writers require an OS-level
/// transaction lock before retirement can be composed for shared storage.
@MainActor private final class PCAInboundApplicationCoordinator {
    private static var coordinators: [Data: PCAInboundApplicationCoordinator] = [:]
    var consuming = false
    static func shared(service: String) -> PCAInboundApplicationCoordinator {
        let identity = Data(service.utf8)
        if let existing = coordinators[identity] { return existing }
        let coordinator = PCAInboundApplicationCoordinator()
        coordinators[identity] = coordinator
        return coordinator
    }
}

public enum PCAInboundRetirementVerification {
    case unavailable
    case accepted(boundary: PCAInboundReplayRetirementBoundary, revalidateAuthority: () throws -> Void)
}
@MainActor public protocol PCAInboundRetirementVerifying {
    func verify(scope: PCAInboundScope) async throws -> PCAInboundRetirementVerification
}
@MainActor public struct PCAUnavailableInboundRetirementVerifier: PCAInboundRetirementVerifying {
    public init() {}
    public func verify(scope: PCAInboundScope) async throws -> PCAInboundRetirementVerification { .unavailable }
}

/// Host-process cleanup; shared extension writers require a real cross-process transaction coordinator.
@MainActor public final class PCAInboundReplayReclaimer {
    private let journal: PCAInboundApplicationJournal
    private let inbox: PCAKeychainInboundInboxStore
    private let denial: PCAInboundReplayDenialLedger
    private let verifier: PCAInboundRetirementVerifying
    private let coordinator: PCAInboundApplicationCoordinator
    public init(journal: PCAInboundApplicationJournal, inbox: PCAKeychainInboundInboxStore,
                denial: PCAInboundReplayDenialLedger, verifier: PCAInboundRetirementVerifying? = nil) throws {
        guard denial.matchesJournal(journal), inbox.backingIdentity === journal.backingIdentity,
              pcaOpaqueEqual(inbox.applicationCoordinationService, journal.coordinationService) else { throw PCAInboundInboxError.unavailable }
        self.journal = journal; self.inbox = inbox; self.denial = denial
        self.verifier = verifier ?? PCAUnavailableInboundRetirementVerifier()
        coordinator = PCAInboundApplicationCoordinator.shared(service: journal.coordinationService)
    }
    /// Returns retired journal records and inbox-only entries, never application completion or custody acknowledgement evidence.
    public func reclaim(scope: PCAInboundScope, assertAuthority: @escaping () throws -> Void) async throws -> Int {
        guard !coordinator.consuming else { return 0 }
        coordinator.consuming = true; defer { coordinator.consuming = false }
        let started = ProcessInfo.processInfo.systemUptime
        func check() throws {
            try Task.checkCancellation(); try assertAuthority()
            guard ProcessInfo.processInfo.systemUptime - started < 30 else { throw PCAInboundInboxError.unavailable }
        }
        try check()
        guard try inbox.retainedScope() == scope else { throw PCAInboundInboxError.unavailable }
        let verification = try await verifier.verify(scope: scope)
        try check()
        guard case .accepted(let boundary, let revalidate) = verification else { return 0 }
        guard boundary.scope == scope else { throw PCAInboundInboxError.unavailable }
        func freshAuthority() throws {
            try check(); try revalidate(); _ = try denial.boundaries(); try check()
        }
        try freshAuthority()
        try journal.requireReplayDenial(scope: scope)
        try denial.install(boundary, assertAuthority: freshAuthority)
        try freshAuthority()
        try journal.assertReplayDenialConfiguration(scope: scope, denial: denial)
        var reclaimed = 0
        let journalAtStart = try journal.records().filter { $0.intent.scope == scope }
        for record in journalAtStart.filter({ $0.outcome != nil }) {
            try freshAuthority()
            guard try denial.coversReplayIdentityPermanently(record.intent.envelope, scope: scope) else { continue }
            func coverage() throws {
                try freshAuthority()
                try journal.assertReplayDenialConfiguration(scope: scope, denial: denial)
                guard try denial.coversReplayIdentityPermanently(record.intent.envelope, scope: scope) else { throw PCAInboundInboxError.unavailable }
            }
            if let held = try inbox.pendingCrypto(scope: scope).first(where: { pcaOpaqueEqual($0.envelope.messageId, record.intent.envelope.messageId) }) {
                guard held.envelope == record.intent.envelope else { throw PCAInboundInboxError.unavailable }
                guard held.relayAcknowledged else { continue }
                _ = try inbox.removeRetiredAcknowledged(held, scope: scope, assertPermanentCoverage: coverage)
            }
            // Absence within the retained scope resumes interrupted ciphertext-first cleanup.
            try coverage()
            if try journal.removeRetiredTerminal(record, assertPermanentCoverage: coverage) { reclaimed += 1 }
        }
        // A denied redelivery can be captured after its terminal journal record was retired.
        // Preserve all journal-backed items (including prepared operations), and reclaim only
        // exact, already-acknowledged inbox entries whose replay identity has permanent coverage.
        let remaining = try journal.records().filter { $0.intent.scope == scope }
        for held in try inbox.pendingCrypto(scope: scope) {
            try freshAuthority()
            try held.envelope.validate(scope: scope)
            if let prior = remaining.first(where: {
                pcaOpaqueEqual($0.intent.envelope.messageId, held.envelope.messageId)
            }) {
                guard prior.intent.envelope == held.envelope else { throw PCAInboundInboxError.unavailable }
                continue
            }
            if let priorAtStart = journalAtStart.first(where: {
                pcaOpaqueEqual($0.intent.envelope.messageId, held.envelope.messageId)
            }) {
                guard priorAtStart.intent.envelope == held.envelope else { throw PCAInboundInboxError.unavailable }
                continue
            }
            guard held.relayAcknowledged,
                  try denial.coversReplayIdentityPermanently(held.envelope, scope: scope) else { continue }
            func coverage() throws {
                try freshAuthority()
                try journal.assertReplayDenialConfiguration(scope: scope, denial: denial)
                guard try denial.coversReplayIdentityPermanently(held.envelope, scope: scope) else { throw PCAInboundInboxError.unavailable }
            }
            if try inbox.removeRetiredAcknowledged(held, scope: scope, assertPermanentCoverage: coverage) { reclaimed += 1 }
        }
        return reclaimed
    }
}

@MainActor public final class PCAInboundCommandConsumer {
    private let journal: PCAInboundApplicationJournal
    private let verifier: PCAInboundCommandVerifying
    private let handler: PCAInboundCommandApplying
    private let coordinator: PCAInboundApplicationCoordinator
    private let replayDenial: PCAInboundReplayDenialLedger?
    public init(journal: PCAInboundApplicationJournal, verifier: PCAInboundCommandVerifying,
                handler: PCAInboundCommandApplying, replayDenial: PCAInboundReplayDenialLedger? = nil) {
        self.journal = journal; self.verifier = verifier; self.handler = handler
        coordinator = PCAInboundApplicationCoordinator.shared(service: journal.coordinationService)
        self.replayDenial = replayDenial
    }
    public func pending(_ candidates: [PCAStoredInboundEnvelope], scope: PCAInboundScope) throws -> [PCAStoredInboundEnvelope] {
        try journal.assertReplayDenialConfiguration(scope: scope, denial: replayDenial)
        let records = try journal.records()
        var seen = Set<Data>()
        return try candidates.filter { candidate in
            try candidate.envelope.validate(scope: scope)
            guard seen.insert(Data(candidate.envelope.messageId.utf8)).inserted else { throw PCAInboundInboxError.unavailable }
            guard let prior = records.first(where: {
                $0.intent.scope == scope && pcaOpaqueEqual($0.intent.envelope.messageId, candidate.envelope.messageId)
            }) else { return try replayDenial?.isEnvelopeDenied(candidate.envelope, scope: scope) != true }
            guard prior.intent.envelope == candidate.envelope else { throw PCAInboundInboxError.unavailable }
            return prior.outcome == nil
        }
    }
    /// Returns only durable completed records. Pending ciphertext remains in its
    /// custody inbox; neither this count nor an ACK establishes protection ACTIVE.
    public func consume(_ candidates: [PCAStoredInboundEnvelope], scope: PCAInboundScope,
                        now: @escaping () -> Date = Date.init,
                        assertAuthority: @escaping () throws -> Void) async throws -> Int {
        guard !coordinator.consuming else { return 0 }
        coordinator.consuming = true; defer { coordinator.consuming = false }
        let started = ProcessInfo.processInfo.systemUptime
        var completed = 0
        func check() throws {
            try Task.checkCancellation(); try assertAuthority()
            guard ProcessInfo.processInfo.systemUptime - started < 30 else { throw PCAInboundInboxError.unavailable }
        }
        try check()
        let pendingCandidates = try pending(candidates, scope: scope)
        let cursor = try journal.processingCursor()
        let start = cursor.flatMap { cursor in pendingCandidates.firstIndex(where: {
            (try? journal.identity(scope: scope, messageId: $0.envelope.messageId)) == cursor
        }) }.map { ($0 + 1) % max(1, pendingCandidates.count) } ?? 0
        let eligible = Array(pendingCandidates.dropFirst(start)) + Array(pendingCandidates.prefix(start))
        for candidate in eligible.prefix(32) {
            guard ProcessInfo.processInfo.systemUptime - started < 30 else { break }
            try check()
            try candidate.envelope.validate(scope: scope)
            try journal.advanceProcessingCursor(scope: scope, messageId: candidate.envelope.messageId)
            let verification = try await verifier.verify(candidate.envelope, scope: scope)
            try check()
            guard case .accepted(let authority, let command, let revalidate) = verification else { continue }
            func checkedAuthority() throws {
                try check(); try revalidate()
                try journal.assertReplayDenialConfiguration(scope: scope, denial: replayDenial)
                try check()
            }
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let issued = formatter.date(from: candidate.envelope.issuedAt),
                  let expires = formatter.date(from: candidate.envelope.expiresAt) else { throw PCAInboundInboxError.unavailable }
            func authorizeNewEffect() throws {
                try checkedAuthority()
                if try replayDenial?.isEnvelopeDenied(candidate.envelope, scope: scope) == true { throw PCAInboundConsumerDeferred.timing }
                let time = now()
                guard time.timeIntervalSince1970.isFinite, time >= issued, time < expires else { throw PCAInboundConsumerDeferred.timing }
            }
            try checkedAuthority()
            let existing = try journal.records().first {
                $0.intent.scope == scope && pcaOpaqueEqual($0.intent.envelope.messageId, candidate.envelope.messageId)
            }
            let intent: PCAInboundApplicationIntent
            if let existing {
                guard existing.intent.envelope == candidate.envelope,
                      existing.intent.authorityBinding == authority,
                      existing.intent.acceptedCommandBinding == command else { throw PCAInboundInboxError.unavailable }
                intent = existing.intent
                if existing.outcome != nil { continue }
            } else {
                intent = PCAInboundApplicationIntent(operationId: UUID().uuidString.lowercased(), scope: scope,
                    envelope: candidate.envelope, authorityBinding: authority,
                    acceptedCommandBinding: command, preparedAt: now())
                do { try authorizeNewEffect() } catch PCAInboundConsumerDeferred.timing { continue }
                try journal.prepare(intent)
            }
            try checkedAuthority()
            let recovery = try await handler.reconcile(intent)
            try checkedAuthority()
            let outcome: PCAInboundApplicationOutcome
            switch recovery {
            case .unknown: continue
            case .completed(let recovered): outcome = recovered
            case .notApplied:
                do {
                    try authorizeNewEffect()
                    outcome = try await handler.apply(intent, assertAuthority: authorizeNewEffect)
                } catch PCAInboundConsumerDeferred.timing { continue }
                try checkedAuthority()
            }
            try checkedAuthority()
            try journal.complete(intent, outcome: outcome, at: now())
            completed += 1
        }
        return completed
    }
}

/// A prepared record is never an application receipt. Interrupted effects require
/// handler reconciliation under the same operation ID before terminal publication.
public struct PCAInboundApplicationRecord: Codable, Equatable {
    public let intent: PCAInboundApplicationIntent
    public var outcome: PCAInboundApplicationOutcome?
    public var completedAt: Date?
}

public final class PCAInboundApplicationJournal {
    private struct Snapshot: Codable {
        let version: Int
        var records: [PCAInboundApplicationRecord]
        var processingCursor: Data? = nil
        // Optional for decoding snapshots written before replay retirement existed.
        var retirementRequired: Bool? = nil
    }
    private static let lock = NSRecursiveLock()
    private let keychain: KeychainStoreProtocol
    fileprivate let backingIdentity: AnyObject
    private let service: String
    fileprivate var coordinationService: String { service }
    private let account = "current.inbound-application-journal"
    private let retirementRequiredAccount = "required.inbound-application-retirement"
    public init(keychain: KeychainStoreProtocol, serviceNamespace: String) {
        self.keychain = keychain; service = serviceNamespace + ".inbound-application"
        backingIdentity = keychain as AnyObject
    }
    public func records() throws -> [PCAInboundApplicationRecord] {
        Self.lock.lock(); defer { Self.lock.unlock() }
        return try load().records
    }
    /// Installs a permanent fail-closed marker before retirement can delete any
    /// application or ciphertext record. The marker is authoritative if a crash
    /// occurs before the snapshot flag is persisted.
    fileprivate func requireReplayDenial(scope: PCAInboundScope) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        guard !scope.recipientDeviceId.isEmpty, scope.recipientDeviceId.utf16.count <= 128 else {
            throw PCAInboundInboxError.unavailable
        }
        let marker = Data(("v1:" + scope.recipientDeviceId).utf8)
        switch try retirementMarker() {
        case .some(let existing): guard existing == marker else { throw PCAInboundInboxError.unavailable }
        case .none:
            try keychain.storeReplacingAtomically(marker, forAccount: retirementRequiredAccount, service: service,
                accessibility: .whenUnlockedThisDeviceOnly)
            guard try retirementMarker() == marker else { throw PCAInboundInboxError.unavailable }
        }
        var snapshot = try load()
        snapshot.retirementRequired = true
        try persist(snapshot)
        guard try retirementMarker() == marker, try load().retirementRequired == true else {
            throw PCAInboundInboxError.unavailable
        }
    }
    /// Every consumer calls this before admission and after every suspension.
    /// Once retirement starts, only the matching durable ledger boundary can
    /// make this scope usable again.
    fileprivate func assertReplayDenialConfiguration(scope: PCAInboundScope,
        denial: PCAInboundReplayDenialLedger?) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        guard !scope.recipientDeviceId.isEmpty, scope.recipientDeviceId.utf16.count <= 128 else {
            throw PCAInboundInboxError.unavailable
        }
        let marker = try retirementMarker()
        let snapshot = try load()
        let expected = Data(("v1:" + scope.recipientDeviceId).utf8)
        if snapshot.retirementRequired == true && marker != expected { throw PCAInboundInboxError.unavailable }
        if let marker {
            guard marker == expected, let denial, denial.matchesJournal(self),
                  try denial.boundaries().contains(where: { $0.scope == scope }) else {
                throw PCAInboundInboxError.unavailable
            }
        } else if let denial {
            guard denial.matchesJournal(self) else { throw PCAInboundInboxError.unavailable }
            _ = try denial.boundaries()
        }
    }
    private func retirementMarker() throws -> Data? {
        do { return try keychain.retrieve(forAccount: retirementRequiredAccount, service: service) }
        catch KeychainStoreError.itemNotFound { return nil }
        catch { throw PCAInboundInboxError.unavailable }
    }
    fileprivate func identity(scope: PCAInboundScope, messageId: String) throws -> Data {
        guard [scope.familyId, scope.recipientDeviceId, messageId].allSatisfy({ !$0.isEmpty && $0.utf16.count <= 128 }) else {
            throw PCAInboundInboxError.unavailable
        }
        return try JSONEncoder().encode([scope.familyId, scope.recipientDeviceId, messageId])
    }
    fileprivate func processingCursor() throws -> Data? {
        Self.lock.lock(); defer { Self.lock.unlock() }
        return try load().processingCursor
    }
    fileprivate func advanceProcessingCursor(scope: PCAInboundScope, messageId: String) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        var snapshot = try load()
        snapshot.processingCursor = try identity(scope: scope, messageId: messageId)
        try persist(snapshot)
    }
    public func prepare(_ intent: PCAInboundApplicationIntent) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try intent.validate()
        var snapshot = try load()
        if let prior = snapshot.records.first(where: {
            $0.intent.scope == intent.scope && pcaOpaqueEqual($0.intent.envelope.messageId, intent.envelope.messageId)
        }) {
            guard prior.intent == intent else { throw PCAInboundInboxError.unavailable }
            try persist(snapshot)
            return
        }
        guard snapshot.records.count < 64,
              !snapshot.records.contains(where: { pcaOpaqueEqual($0.intent.operationId, intent.operationId) }) else {
            throw PCAInboundInboxError.unavailable
        }
        snapshot.records.append(PCAInboundApplicationRecord(intent: intent, outcome: nil, completedAt: nil))
        try persist(snapshot)
    }
    /// Caller must supply a freshly verified/reconciled effect outcome. This is
    /// a durability transition, never a verifier or a side-effect dispatcher.
    public func complete(_ intent: PCAInboundApplicationIntent, outcome: PCAInboundApplicationOutcome,
                         at: Date) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try intent.validate()
        guard at.timeIntervalSince1970.isFinite, at >= intent.preparedAt else { throw PCAInboundInboxError.unavailable }
        var snapshot = try load()
        guard let index = snapshot.records.firstIndex(where: { $0.intent == intent }) else {
            throw PCAInboundInboxError.unavailable
        }
        if let previous = snapshot.records[index].outcome {
            guard previous == outcome else { throw PCAInboundInboxError.unavailable }
            try persist(snapshot)
            return
        }
        snapshot.records[index].outcome = outcome
        snapshot.records[index].completedAt = at
        try persist(snapshot)
    }
    fileprivate func removeRetiredTerminal(_ expected: PCAInboundApplicationRecord, assertPermanentCoverage: () throws -> Void) throws -> Bool {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try expected.intent.validate()
        guard expected.outcome != nil, expected.completedAt.map({ $0.timeIntervalSince1970.isFinite && $0 >= expected.intent.preparedAt }) == true else { throw PCAInboundInboxError.unavailable }
        var snapshot = try load()
        let prior = snapshot.records.first(where: { pcaOpaqueEqual($0.intent.operationId, expected.intent.operationId) })
        guard prior == nil || prior == expected else { throw PCAInboundInboxError.unavailable }
        try assertPermanentCoverage()
        snapshot.records.removeAll { pcaOpaqueEqual($0.intent.operationId, expected.intent.operationId) }
        try persist(snapshot)
        return prior != nil
    }
    private func load() throws -> Snapshot {
        let data: Data
        do { data = try keychain.retrieve(forAccount: account, service: service) }
        catch KeychainStoreError.itemNotFound { return Snapshot(version: 1, records: []) }
        catch { throw PCAInboundInboxError.unavailable }
        guard data.count <= 1_048_576, let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
              snapshot.version == 1, snapshot.records.count <= 64 else { throw PCAInboundInboxError.unavailable }
        if snapshot.retirementRequired == true {
            guard let marker = try retirementMarker(), let value = String(data: marker, encoding: .utf8),
                  value.hasPrefix("v1:") else { throw PCAInboundInboxError.unavailable }
            let deviceId = String(value.dropFirst(3))
            guard !deviceId.isEmpty, deviceId.utf16.count <= 128,
                  Data(("v1:" + deviceId).utf8) == marker else { throw PCAInboundInboxError.unavailable }
        }
        if let cursor = snapshot.processingCursor {
            guard cursor.count <= 4096, let ids = try? JSONDecoder().decode([String].self, from: cursor), ids.count == 3,
                  ids.allSatisfy({ !$0.isEmpty && $0.utf16.count <= 128 }),
                  try JSONEncoder().encode(ids) == cursor else { throw PCAInboundInboxError.unavailable }
        }
        var operations = Set<Data>(), messages = Set<Data>()
        for record in snapshot.records {
            try record.intent.validate()
            let identity = try JSONEncoder().encode([record.intent.scope.familyId,
                record.intent.scope.recipientDeviceId, record.intent.envelope.messageId])
            guard operations.insert(Data(record.intent.operationId.utf8)).inserted,
                  messages.insert(identity).inserted,
                  (record.outcome == nil) == (record.completedAt == nil),
                  record.completedAt.map({ $0.timeIntervalSince1970.isFinite && $0 >= record.intent.preparedAt }) ?? true else {
                throw PCAInboundInboxError.unavailable
            }
        }
        return snapshot
    }
    private func persist(_ snapshot: Snapshot) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(snapshot)
        guard data.count <= 1_048_576 else { throw PCAInboundInboxError.unavailable }
        try keychain.storeReplacingAtomically(data, forAccount: account, service: service, accessibility: .whenUnlockedThisDeviceOnly)
        guard try keychain.retrieve(forAccount: account, service: service) == data else { throw PCAInboundInboxError.unavailable }
    }
}

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
    fileprivate let backingIdentity: AnyObject
    fileprivate let applicationCoordinationService: String
    private let service: String
    private let account = "current.ciphertext-inbox"
    private let maxRecords: Int
    private let maxBytes: Int

    public init(keychain: KeychainStoreProtocol, serviceNamespace: String, maxRecords: Int = 256, maxBytes: Int = 4 * 1024 * 1024) {
        precondition(maxRecords > 0 && maxRecords <= 256 && maxBytes > 0 && maxBytes <= 4 * 1024 * 1024)
        self.keychain = keychain
        backingIdentity = keychain as AnyObject; applicationCoordinationService = serviceNamespace + ".inbound-application"
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
    fileprivate func removeRetiredAcknowledged(_ expected: PCAStoredInboundEnvelope, scope: PCAInboundScope,
                                              assertPermanentCoverage: () throws -> Void) throws -> Bool {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try expected.envelope.validate(scope: scope)
        guard expected.relayAcknowledged else { throw PCAInboundInboxError.unavailable }
        var snapshot = try confirmed(scope: scope)
        let prior = snapshot.entries.first(where: { pcaOpaqueEqual($0.envelope.messageId, expected.envelope.messageId) })
        guard prior == nil || prior == expected else { throw PCAInboundInboxError.unavailable }
        try assertPermanentCoverage()
        snapshot.entries.removeAll { pcaOpaqueEqual($0.envelope.messageId, expected.envelope.messageId) }
        try persist(snapshot)
        return prior != nil
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

public enum PCAEnrollmentAttemptSubmissionState: String, Codable {
    /// No bootstrap request has been handed to the transport yet. After a
    /// restart, the same invitation can safely resume this attempt.
    case prepared
    /// Bootstrap may have reached the server; resolve it through recovery.
    case submitted
    /// Recovery must remain bound to this invitation. Older builds wrote this
    /// after a generic recovery 404; current code also uses it after an
    /// ambiguous preflight recovery so retries stay on the recovery endpoint.
    case awaitingInvitation
}

public struct PCAEnrollmentAttempt: Codable, Equatable {
    public let attemptId: String
    public let attemptRecoveryToken: String
    public let submissionState: PCAEnrollmentAttemptSubmissionState
    /// One-way binding to the invitation presented before process loss. The
    /// raw invitation remains in memory and is never written to Keychain.
    public let invitationTokenSHA256: String?

    public init(
        attemptId: String,
        attemptRecoveryToken: String,
        submissionState: PCAEnrollmentAttemptSubmissionState = .submitted,
        invitationTokenSHA256: String? = nil
    ) {
        self.attemptId = attemptId
        self.attemptRecoveryToken = attemptRecoveryToken
        self.submissionState = submissionState
        self.invitationTokenSHA256 = invitationTokenSHA256
    }

    private enum CodingKeys: String, CodingKey {
        case attemptId
        case attemptRecoveryToken
        case submissionState
        case invitationTokenSHA256
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        attemptId = try values.decode(String.self, forKey: .attemptId)
        attemptRecoveryToken = try values.decode(String.self, forKey: .attemptRecoveryToken)
        // Older records predate the local submission marker and must remain
        // on the conservative recovery path.
        submissionState = try values.decodeIfPresent(PCAEnrollmentAttemptSubmissionState.self, forKey: .submissionState) ?? .submitted
        invitationTokenSHA256 = try values.decodeIfPresent(String.self, forKey: .invitationTokenSHA256)
    }

    public func markingSubmitted() -> PCAEnrollmentAttempt {
        PCAEnrollmentAttempt(
            attemptId: attemptId,
            attemptRecoveryToken: attemptRecoveryToken,
            submissionState: .submitted,
            invitationTokenSHA256: invitationTokenSHA256
        )
    }

    public func markingAwaitingInvitation() -> PCAEnrollmentAttempt {
        PCAEnrollmentAttempt(
            attemptId: attemptId,
            attemptRecoveryToken: attemptRecoveryToken,
            submissionState: .awaitingInvitation,
            invitationTokenSHA256: invitationTokenSHA256
        )
    }

    /// Compare persisted authority snapshots without Unicode normalization.
    public static func == (left: PCAEnrollmentAttempt, right: PCAEnrollmentAttempt) -> Bool {
        (left.attemptId.utf8.elementsEqual(right.attemptId.utf8)) &&
        (left.attemptRecoveryToken.utf8.elementsEqual(right.attemptRecoveryToken.utf8)) &&
        (left.submissionState == right.submissionState) &&
        pcaOpaqueEqual(left.invitationTokenSHA256, right.invitationTokenSHA256)
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
    /// Runs the operation only while the exact durable attempt is current.
    /// Return true to clear that attempt after the operation succeeds, or
    /// false to retain it. Implementations serialize the check, operation and
    /// optional clear against all access to the same backing attempt record.
    func performIfCurrent(_ expected: PCAEnrollmentAttempt, _ operation: () throws -> Bool) throws -> Bool
    /// Clears only the exact attempt snapshot observed by the caller.
    func clearAttempt(ifCurrent expected: PCAEnrollmentAttempt) throws -> Bool
}

public extension PCAEnrollmentAttemptStore {
    func clearAttempt(ifCurrent expected: PCAEnrollmentAttempt) throws -> Bool {
        try performIfCurrent(expected) { true }
    }
}

/// Session and recovery material are secrets/security-sensitive state. Both
/// are encoded only into Keychain data; UserDefaults is intentionally used
/// for neither bearer tokens nor attempt recovery tokens.
public final class PCAKeychainDeviceStateStore: PCADeviceSessionStore, PCAEnrollmentAttemptStore {
    /// All wrappers for this account in the process share the same critical
    /// section, so compare-and-clear cannot delete a replacement written by a
    /// second store instance between its read and delete.
    private static let attemptLock = NSRecursiveLock()
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
        Self.attemptLock.lock()
        defer { Self.attemptLock.unlock() }
        return try loadValue(PCAEnrollmentAttempt.self, account: attemptAccount)
    }

    public func saveAttempt(_ attempt: PCAEnrollmentAttempt) throws {
        Self.attemptLock.lock()
        defer { Self.attemptLock.unlock() }
        try saveValue(attempt, account: attemptAccount)
    }

    public func clearAttempt() throws {
        Self.attemptLock.lock()
        defer { Self.attemptLock.unlock() }
        try keychain.delete(forAccount: attemptAccount, service: service)
    }

    public func performIfCurrent(_ expected: PCAEnrollmentAttempt, _ operation: () throws -> Bool) throws -> Bool {
        Self.attemptLock.lock()
        defer { Self.attemptLock.unlock() }
        guard try loadValue(PCAEnrollmentAttempt.self, account: attemptAccount) == expected else { return false }
        let shouldClear = try operation()
        // A recursive callback can still write through another store wrapper
        // on this thread. Never remove a replacement installed by that work.
        guard try loadValue(PCAEnrollmentAttempt.self, account: attemptAccount) == expected else { return false }
        if shouldClear {
            try keychain.delete(forAccount: attemptAccount, service: service)
        }
        return true
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
    private let attemptLock = NSRecursiveLock()
    public init() {}
    public func loadSession() throws -> PCADeviceSession? { session }
    public func saveSession(_ value: PCADeviceSession) throws { session = value }
    public func clearSession() throws { session = nil }
    public func loadAttempt() throws -> PCAEnrollmentAttempt? {
        attemptLock.lock()
        defer { attemptLock.unlock() }
        return attempt
    }
    public func saveAttempt(_ value: PCAEnrollmentAttempt) throws {
        attemptLock.lock()
        defer { attemptLock.unlock() }
        attempt = value
    }
    public func clearAttempt() throws {
        attemptLock.lock()
        defer { attemptLock.unlock() }
        attempt = nil
    }
    public func performIfCurrent(_ expected: PCAEnrollmentAttempt, _ operation: () throws -> Bool) throws -> Bool {
        attemptLock.lock()
        defer { attemptLock.unlock() }
        guard attempt == expected else { return false }
        let shouldClear = try operation()
        guard attempt == expected else { return false }
        if shouldClear { attempt = nil }
        return true
    }
}
