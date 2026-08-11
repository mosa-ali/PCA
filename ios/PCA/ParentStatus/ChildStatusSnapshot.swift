import Foundation

/// PCA-10 iOS-facing status model: what the child device's own iOS
/// adapters can honestly report about themselves for the parent status
/// surface. Every field is a STATE, never a bare boolean "protected" --
/// consistent with doc 07 Section 14's "never silently say PROTECTED when
/// unavailable" instruction across every capability this snapshot covers.
public struct ChildStatusSnapshot: Equatable {
    public let authorization: ChildAuthorizationState
    public let syncConnection: SyncConnectionState
    public let deviceActivityHealth: DeviceActivityCallbackHealth
    public let locationCapability: LocationCapabilityState
    public let capturedAtUtc: Date

    public init(
        authorization: ChildAuthorizationState,
        syncConnection: SyncConnectionState,
        deviceActivityHealth: DeviceActivityCallbackHealth,
        locationCapability: LocationCapabilityState,
        capturedAtUtc: Date
    ) {
        self.authorization = authorization
        self.syncConnection = syncConnection
        self.deviceActivityHealth = deviceActivityHealth
        self.locationCapability = locationCapability
        self.capturedAtUtc = capturedAtUtc
    }

    /// True only when every underlying signal is in its fully-healthy
    /// state -- a single degraded signal (e.g. a missed DeviceActivity
    /// callback) is enough to make this false, so a caller cannot
    /// accidentally render "all good" from a partial read.
    public var isFullyHealthy: Bool {
        authorization == .approved
            && (syncConnection == .live)
            && deviceActivityHealth == .healthy
    }
}
