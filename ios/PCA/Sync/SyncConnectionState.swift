import Foundation

/// iOS-side mirror of backend/src/familysync/connectionState.ts's state
/// machine (PCA-11). Pure derivation, no networking of its own -- the
/// actual envelope submit/hold-pending/drain logic remains the backend
/// SyncCoordinator's job; this device only needs to render its OWN
/// connection health honestly (doc 07 Section 14: never claim "protected"
/// from stale sync state).
public enum SyncConnectionState: Equatable {
    case offline
    case syncPending
    case syncing
    case live
    case stale
}

public struct SyncConnectionStateInput {
    public let isTransportConnected: Bool
    public let isSyncing: Bool
    public let hasPendingLocalWork: Bool
    public let lastSuccessfulSyncAtUtc: Date?
    public let nowUtc: Date
    public let staleThresholdSeconds: TimeInterval

    public init(isTransportConnected: Bool, isSyncing: Bool, hasPendingLocalWork: Bool, lastSuccessfulSyncAtUtc: Date?, nowUtc: Date, staleThresholdSeconds: TimeInterval = 24 * 60 * 60) {
        self.isTransportConnected = isTransportConnected
        self.isSyncing = isSyncing
        self.hasPendingLocalWork = hasPendingLocalWork
        self.lastSuccessfulSyncAtUtc = lastSuccessfulSyncAtUtc
        self.nowUtc = nowUtc
        self.staleThresholdSeconds = staleThresholdSeconds
    }
}

public enum SyncConnectionStateComputer {
    /// Deliberately does NOT equate "transport connected" with "policy
    /// successfully applied" -- `.live` requires both a connected
    /// transport AND a recent successful sync, exactly like the backend's
    /// `computeSyncConnectionState`.
    public static func compute(_ input: SyncConnectionStateInput) -> SyncConnectionState {
        guard input.isTransportConnected else { return .offline }
        if input.isSyncing { return .syncing }

        guard let lastSync = input.lastSuccessfulSyncAtUtc else {
            return input.hasPendingLocalWork ? .syncPending : .stale
        }
        let age = input.nowUtc.timeIntervalSince(lastSync)
        if age < 0 || age > input.staleThresholdSeconds { return .stale }
        return input.hasPendingLocalWork ? .syncPending : .live
    }
}
