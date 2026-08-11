import Foundation

/// PCA-6 iOS honesty adapter (doc 07 Section 8, doc 15). iOS has no
/// UsageStats-equivalent public API for arbitrary per-app duration the
/// way Android does -- app/category usage signal on iOS comes only
/// through `DeviceActivityReport`'s own privacy-preserving, extension-
/// rendered surface (doc 07 Section 5). This type exists solely to make
/// that platform difference explicit in code, not to claim Android parity.
public enum YouTubeVisibilityMode: Equatable {
    /// Normal YouTube app: iOS can, at most, know a Device-Activity
    /// monitored duration for the YouTube application token via the same
    /// mechanism as any other monitored app -- never a per-video watch
    /// history. Mirrors doc 15's Mode A limitation, translated to iOS's
    /// own DeviceActivity-based (not UsageStats-based) evidence source.
    case modeA_AppDurationOnly

    /// PCA-controlled playback experience, where officially supported and
    /// approved (doc 15 Mode B) -- iOS-specific implementation (e.g. a
    /// compliant embedded player) is a separate, owner-decision-gated
    /// workstream this type does not implement; it exists only to keep
    /// the same two-mode vocabulary consistent across platforms.
    case modeB_ControlledPlaybackObserved

    /// Neither mode currently active/available on this device (e.g.
    /// entitlement unavailable, or the feature has not been enabled).
    case unavailable
}

public struct YouTubeVisibilityStatus: Equatable {
    public let mode: YouTubeVisibilityMode
    public let label: String

    public init(mode: YouTubeVisibilityMode) {
        self.mode = mode
        switch mode {
        case .modeA_AppDurationOnly:
            self.label = "App usage only"
        case .modeB_ControlledPlaybackObserved:
            self.label = "Mode B — PCA-controlled"
        case .unavailable:
            self.label = "Unavailable"
        }
    }
}
