import Foundation

/// WAVE 6D: durable local state of THIS device's first-device trust-root
/// ceremony. Written in two moments, both BEFORE any irreversible step:
///
///  1. The [FirstDeviceCeremonySeed] is captured at enrollment completion
///     (before the pending-attempt record is cleared), because the ceremony
///     authenticates with the attempt's (attemptId, attemptRecoveryToken)
///     credential pair and is M1-bound to the enrollment DSK. Without this
///     capture a process death would strand a perfectly committed-capable
///     device with no way to reach its own ceremony.
///  2. The submission payload (proof/epoch-1 bytes + signatures + evidence)
///     is persisted BEFORE the first submit, because ECDSA signatures are
///     randomized: the backend's commit identity is over the EXACT submitted
///     bytes, so a re-signed retry after a lost response would 409. Replays
///     must be byte-identical.
///
/// The record deliberately contains NO private key material (aliases only --
/// the key lives inside the Secure Enclave) and NO device-lifecycle field:
/// this store can never move the device lifecycle; server-authoritative
/// acceptance is tracked here and nowhere else.
///
/// The state raw values are the SAME vocabulary Android persists
/// (`NOT_STARTED` ... `UNKNOWN`), so both platforms describe one state
/// machine in one language.
public enum FirstDeviceRootState: String, Codable, Equatable {
    /// Seeded from a successful enrollment; no ceremony contact yet.
    case notStarted = "NOT_STARTED"
    /// Challenge obtained; waiting for the parent to approve server-side.
    case awaitingApproval = "AWAITING_APPROVAL"
    /// Server status APPROVED; ready to sign + submit.
    case approved = "APPROVED"
    /// Submission payload persisted; submit in flight or outcome ambiguous.
    case submitting = "SUBMITTING"
    /// Server-authoritative acceptance (status COMMITTED + outcome ACCEPTED). Terminal success.
    case rootCommitted = "ROOT_COMMITTED"
    /// The ceremony expired before an accepted submission; its persisted submission is trimmed and a NEW ceremony may be started explicitly.
    case expired = "EXPIRED"
    /// Server rejected the submission while the ceremony was still APPROVED. Terminal for this ceremony.
    case rejected = "REJECTED"
    /// Outcome not currently determinable (credential/ceremony ambiguity). Resolve via status, never by guessing.
    case unknown = "UNKNOWN"
}

/// Enrollment-time ceremony credentials (captured at enrollment success).
public struct FirstDeviceCeremonySeed: Codable, Equatable {
    public var attemptId: String
    public var attemptRecoveryToken: String
    public var serverBaseUrl: String
    public var deviceId: String
    public var signingKeyId: String
    public var encryptionKeyId: String
    public var dskPublicKeyBase64: String
    public var dekPublicKeyBase64: String
    public var dskAlias: String
    public var dekAlias: String

    public init(
        attemptId: String,
        attemptRecoveryToken: String,
        serverBaseUrl: String,
        deviceId: String,
        signingKeyId: String,
        encryptionKeyId: String,
        dskPublicKeyBase64: String,
        dekPublicKeyBase64: String,
        dskAlias: String,
        dekAlias: String
    ) {
        self.attemptId = attemptId
        self.attemptRecoveryToken = attemptRecoveryToken
        self.serverBaseUrl = serverBaseUrl
        self.deviceId = deviceId
        self.signingKeyId = signingKeyId
        self.encryptionKeyId = encryptionKeyId
        self.dskPublicKeyBase64 = dskPublicKeyBase64
        self.dekPublicKeyBase64 = dekPublicKeyBase64
        self.dskAlias = dskAlias
        self.dekAlias = dekAlias
    }
}

/// The exact bytes of one submission (persisted before first send; replayed verbatim).
public struct FirstDeviceSubmissionPayload: Codable, Equatable {
    public var proofBytes: String
    public var proofSignature: String
    public var epoch1Bytes: String
    public var epoch1Signature: String
    public var attestationEvidence: String

    public init(proofBytes: String, proofSignature: String, epoch1Bytes: String, epoch1Signature: String, attestationEvidence: String) {
        self.proofBytes = proofBytes
        self.proofSignature = proofSignature
        self.epoch1Bytes = epoch1Bytes
        self.epoch1Signature = epoch1Signature
        self.attestationEvidence = attestationEvidence
    }
}

public struct FirstDeviceRootRecord: Codable, Equatable {
    public var seed: FirstDeviceCeremonySeed
    public var state: FirstDeviceRootState
    public var ceremonyId: String?
    public var challengeId: String?
    public var nonce: String?
    /// Server ISO string from the challenge response; echoed verbatim into the proof.
    public var expiresAt: String?
    public var familyId: String?
    public var submission: FirstDeviceSubmissionPayload?
    public var committedAtMillis: Int64?

    public init(
        seed: FirstDeviceCeremonySeed,
        state: FirstDeviceRootState = .notStarted,
        ceremonyId: String? = nil,
        challengeId: String? = nil,
        nonce: String? = nil,
        expiresAt: String? = nil,
        familyId: String? = nil,
        submission: FirstDeviceSubmissionPayload? = nil,
        committedAtMillis: Int64? = nil
    ) {
        self.seed = seed
        self.state = state
        self.ceremonyId = ceremonyId
        self.challengeId = challengeId
        self.nonce = nonce
        self.expiresAt = expiresAt
        self.familyId = familyId
        self.submission = submission
        self.committedAtMillis = committedAtMillis
    }
}

public protocol FirstDeviceRootStoring {
    func current() -> FirstDeviceRootRecord?
    @discardableResult func save(_ record: FirstDeviceRootRecord) -> Bool
    func clear()

    /// Atomic compare-and-write with a durability/read-back barrier. An
    /// expected nil means the store must still be empty. Coordinator writes
    /// based on snapshots taken before network awaits use this to avoid
    /// overwriting a newer root or enrollment seed.
    func writeIfCurrent(expected: FirstDeviceRootRecord?, record: FirstDeviceRootRecord) -> Bool

    /// Idempotently captures an enrollment seed. A same-attempt recapture
    /// preserves the entire existing ceremony record. A different attempt
    /// replaces an existing record only when its state is explicitly listed
    /// by the platform's established terminal-replacement policy.
    func captureSeed(_ candidate: FirstDeviceRootRecord, replacingTerminalStates: [FirstDeviceRootState]) -> Bool

    /// Re-confirms persistence before replaying an already stored submission.
    func confirmDurable(_ record: FirstDeviceRootRecord) -> Bool

    /// Runs optional key cleanup under this instance's root write lock.
    /// The synchronous callback must not mutate the root. An unavailable
    /// or corrupt record skips cleanup so its keys remain intact.
    @discardableResult func withConfirmedCurrentRecord(_ operation: (FirstDeviceRootRecord) -> Void) -> Bool

    /// Synchronous durability barrier: returns only after everything written
    /// so far is durably stored. The first submit MUST be preceded by
    /// `flush` (a lost, non-persisted submission payload is unrecoverable
    /// byte-identically).
    func flush()
}

public extension FirstDeviceRootStoring {
    @discardableResult func withConfirmedCurrentRecord(_ operation: (FirstDeviceRootRecord) -> Void) -> Bool {
        // Compatibility stores cannot establish an atomic keep-set.
        false
    }
}

/// In-memory reference implementation -- usable for tests/dev builds, NOT
/// durable across process death.
public final class InMemoryFirstDeviceRootStore: FirstDeviceRootStoring {
    private var record: FirstDeviceRootRecord?
    private let lock = NSRecursiveLock()

    public init(record: FirstDeviceRootRecord? = nil) {
        self.record = record
    }

    public func current() -> FirstDeviceRootRecord? { synchronized { record } }
    @discardableResult public func save(_ record: FirstDeviceRootRecord) -> Bool {
        synchronized {
            self.record = record
            return true
        }
    }
    public func clear() { synchronized { record = nil } }
    public func writeIfCurrent(expected: FirstDeviceRootRecord?, record: FirstDeviceRootRecord) -> Bool {
        synchronized {
            guard self.record == expected else { return false }
            self.record = record
            return true
        }
    }
    public func captureSeed(_ candidate: FirstDeviceRootRecord, replacingTerminalStates: [FirstDeviceRootState]) -> Bool {
        synchronized {
            guard let existing = record else {
                record = candidate
                return true
            }
            if existing.seed.attemptId == candidate.seed.attemptId {
                // Confirm the complete same-attempt record is still readable
                // before recovery accepts it; never rebuild it from the new
                // seed-only candidate.
                return confirmDurable(existing)
            }
            if replacingTerminalStates.contains(existing.state) { record = candidate }
            return true
        }
    }
    public func confirmDurable(_ record: FirstDeviceRootRecord) -> Bool {
        synchronized { self.record == record }
    }
    public func flush() { /* nothing to flush */ }

    @discardableResult public func withConfirmedCurrentRecord(_ operation: (FirstDeviceRootRecord) -> Void) -> Bool {
        synchronized {
            guard let retained = record, !retained.seed.attemptId.isEmpty else { return false }
            operation(retained)
            return true
        }
    }

    private func synchronized<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}

/// Durable binding over the OS Keychain ([KeychainStoreProtocol], the same
/// storage placement every other runtime snapshot uses). The record is a
/// JSON encoding; malformed or legacy records decode to nil (fail safe to
/// "no ceremony", never a fabricated state).
public final class KeychainFirstDeviceRootStore: FirstDeviceRootStoring {
    private enum StoredRecord {
        case missing
        case invalid
        case valid(FirstDeviceRootRecord)
    }

    public static let defaultAccount = "first-device-root"
    public static let defaultServiceSuffix = "first-device-root"

    private let keychain: KeychainStoreProtocol
    private let account: String
    private let service: String
    private let lock = NSRecursiveLock()

    public init(
        keychain: KeychainStoreProtocol,
        serviceNamespace: String,
        account: String = KeychainFirstDeviceRootStore.defaultAccount
    ) {
        self.keychain = keychain
        self.account = account
        self.service = "\(serviceNamespace).\(Self.defaultServiceSuffix)"
    }

    public func current() -> FirstDeviceRootRecord? {
        synchronized { currentUnlocked() }
    }

    @discardableResult public func save(_ record: FirstDeviceRootRecord) -> Bool {
        synchronized { saveUnlocked(record) }
    }

    public func clear() {
        synchronized { try? keychain.delete(forAccount: account, service: service) }
    }

    public func writeIfCurrent(expected: FirstDeviceRootRecord?, record: FirstDeviceRootRecord) -> Bool {
        synchronized {
            switch readStoredRecordUnlocked() {
            case .missing:
                guard expected == nil else { return false }
            case .invalid:
                return false
            case .valid(let current):
                guard current == expected else { return false }
            }
            guard saveUnlocked(record) else { return false }
            flush()
            return isCurrentUnlocked(record)
        }
    }

    public func captureSeed(_ candidate: FirstDeviceRootRecord, replacingTerminalStates: [FirstDeviceRootState]) -> Bool {
        synchronized {
            let existing: FirstDeviceRootRecord?
            switch readStoredRecordUnlocked() {
            case .missing:
                existing = nil
            case .invalid:
                return false
            case .valid(let record):
                existing = record
            }
            guard let existing else {
                return saveAndConfirmUnlocked(candidate)
            }
            if existing.seed.attemptId == candidate.seed.attemptId { return confirmDurable(existing) }
            guard replacingTerminalStates.contains(existing.state) else {
                // A competing enrollment cannot replace this ceremony, and
                // must verify the exact retained record before treating the
                // preservation as successful.
                return confirmDurable(existing)
            }
            return saveAndConfirmUnlocked(candidate)
        }
    }

    public func confirmDurable(_ record: FirstDeviceRootRecord) -> Bool {
        synchronized {
            flush()
            return isCurrentUnlocked(record)
        }
    }

    public func flush() {
        // The Keychain API writes synchronously: by the time `store` has
        // returned, the item is durably placed by the platform. This method
        // exists to keep the caller-visible durability contract explicit
        // and identical to Android's flush barrier.
    }

    @discardableResult public func withConfirmedCurrentRecord(_ operation: (FirstDeviceRootRecord) -> Void) -> Bool {
        synchronized {
            guard case .valid(let retained) = readStoredRecordUnlocked(),
                  !retained.seed.attemptId.isEmpty else { return false }
            flush()
            guard isCurrentUnlocked(retained) else { return false }
            operation(retained)
            return true
        }
    }

    private func readStoredRecordUnlocked() -> StoredRecord {
        let data: Data
        do {
            data = try keychain.retrieve(forAccount: account, service: service)
        } catch KeychainStoreError.itemNotFound {
            return .missing
        } catch {
            return .invalid
        }
        guard let record = try? JSONDecoder().decode(FirstDeviceRootRecord.self, from: data) else {
            return .invalid
        }
        return .valid(record)
    }

    private func currentUnlocked() -> FirstDeviceRootRecord? {
        guard case .valid(let record) = readStoredRecordUnlocked() else { return nil }
        return record
    }

    private func isCurrentUnlocked(_ expected: FirstDeviceRootRecord) -> Bool {
        guard case .valid(let current) = readStoredRecordUnlocked() else { return false }
        return current == expected
    }

    private func saveUnlocked(_ record: FirstDeviceRootRecord) -> Bool {
        guard let data = try? JSONEncoder().encode(record) else { return false }
        do {
            try keychain.storeReplacingAtomically(
                data,
                forAccount: account,
                service: service,
                accessibility: .whenUnlockedThisDeviceOnly
            )
            return true
        } catch {
            return false
        }
    }

    private func saveAndConfirmUnlocked(_ record: FirstDeviceRootRecord) -> Bool {
        guard saveUnlocked(record) else { return false }
        flush()
        return isCurrentUnlocked(record)
    }

    private func synchronized<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}
