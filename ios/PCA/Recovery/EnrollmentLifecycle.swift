import Foundation

/// Doc 08 Section 3's complete enrollment/device lifecycle. The machine is
/// deliberately platform-neutral so the iOS caller can report the same
/// states as the backend and Android paths without claiming a platform
/// capability that has not been established.
public enum EnrollmentLifecycleState: String, CaseIterable, Codable {
    case new = "NEW"
    case invited = "INVITED"
    case paired = "PAIRED"
    case active = "ACTIVE"
    case degraded = "DEGRADED"
    case recoveryPending = "RECOVERY_PENDING"
    case revoked = "REVOKED"
    case removed = "REMOVED"
}

public struct EnrollmentLifecycleAuditRecord: Equatable, Codable, Identifiable {
    public let id: UUID
    public let familyId: String
    public let deviceId: String
    public let actorId: String
    public let fromState: EnrollmentLifecycleState
    public let toState: EnrollmentLifecycleState
    public let reason: String
    public let occurredAtUtc: Date

    public init(
        id: UUID = UUID(),
        familyId: String,
        deviceId: String,
        actorId: String,
        fromState: EnrollmentLifecycleState,
        toState: EnrollmentLifecycleState,
        reason: String,
        occurredAtUtc: Date
    ) {
        self.id = id
        self.familyId = familyId
        self.deviceId = deviceId
        self.actorId = actorId
        self.fromState = fromState
        self.toState = toState
        self.reason = reason
        self.occurredAtUtc = occurredAtUtc
    }
}

public protocol EnrollmentLifecycleAuditSink {
    func append(_ record: EnrollmentLifecycleAuditRecord)
}

/// Local/E2EE audit sink used by source tests and by a device-local adapter.
/// No server-readable family-data audit store is introduced here.
public final class InMemoryEnrollmentLifecycleAuditSink: EnrollmentLifecycleAuditSink {
    public private(set) var records: [EnrollmentLifecycleAuditRecord] = []

    public init() {}

    public func append(_ record: EnrollmentLifecycleAuditRecord) {
        records.append(record)
    }
}

public enum EnrollmentLifecycleTransitionError: Error, Equatable {
    case invalidTransition(from: EnrollmentLifecycleState, to: EnrollmentLifecycleState)
    case missingOpaqueIdentifier
    case invalidReason
}

/// Every successful transition appends one audit record before changing the
/// exposed state. Invalid transitions never mutate state or append a record.
public final class EnrollmentLifecycleMachine {
    public private(set) var state: EnrollmentLifecycleState

    private let familyId: String
    private let deviceId: String
    private let auditSink: EnrollmentLifecycleAuditSink
    private let now: () -> Date

    public init(
        familyId: String,
        deviceId: String,
        initialState: EnrollmentLifecycleState = .new,
        auditSink: EnrollmentLifecycleAuditSink,
        now: @escaping () -> Date = Date.init
    ) throws {
        guard !familyId.isEmpty, !deviceId.isEmpty else {
            throw EnrollmentLifecycleTransitionError.missingOpaqueIdentifier
        }
        self.familyId = familyId
        self.deviceId = deviceId
        self.state = initialState
        self.auditSink = auditSink
        self.now = now
    }

    @discardableResult
    public func transition(to nextState: EnrollmentLifecycleState, actorId: String, reason: String) throws -> EnrollmentLifecycleAuditRecord {
        guard !actorId.isEmpty else { throw EnrollmentLifecycleTransitionError.missingOpaqueIdentifier }
        guard !reason.isEmpty, reason.count <= 280 else { throw EnrollmentLifecycleTransitionError.invalidReason }
        guard Self.isAllowed(from: state, to: nextState) else {
            throw EnrollmentLifecycleTransitionError.invalidTransition(from: state, to: nextState)
        }

        let record = EnrollmentLifecycleAuditRecord(
            familyId: familyId,
            deviceId: deviceId,
            actorId: actorId,
            fromState: state,
            toState: nextState,
            reason: reason,
            occurredAtUtc: now()
        )
        auditSink.append(record)
        state = nextState
        return record
    }

    private static func isAllowed(from: EnrollmentLifecycleState, to: EnrollmentLifecycleState) -> Bool {
        switch (from, to) {
        case (.new, .invited),
             (.invited, .paired),
             (.paired, .active),
             (.active, .degraded),
             (.degraded, .active),
             (.active, .recoveryPending),
             (.degraded, .recoveryPending),
             (.recoveryPending, .active),
             (.active, .revoked),
             (.degraded, .revoked),
             (.invited, .revoked),
             (.revoked, .removed),
             (.removed, .new):
            return true
        default:
            return false
        }
    }
}
