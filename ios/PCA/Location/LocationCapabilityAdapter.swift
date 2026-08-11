import Foundation
#if canImport(CoreLocation)
import CoreLocation
#endif

/// iOS-side capability adapter for PCA-7 (doc 16), built ONLY on public
/// CoreLocation authorization APIs -- no private API, no location-fetch
/// logic of its own (that belongs to a `CLLocationManagerDelegate` wired
/// elsewhere; this type's job is exposing an honest CAPABILITY STATE,
/// mirroring backend/src/location/types.ts's `LocationCapabilityState`
/// enumeration so the same doc-16 state names are used across platforms).
public enum LocationCapabilityState: Equatable {
    case notConfigured
    case permissionDenied
    case approximate
    case backgroundNotGranted
    case locationServicesOff
    case active
}

/// Platform-independent mirrors of the two `CoreLocation` enums this
/// mapping depends on -- kept separate from the real `CLAuthorizationStatus`/
/// `CLAccuracyAuthorization` so `LocationCapabilityAdapter.state(...)`
/// itself is testable on any platform, including this Windows workspace.
/// The `canImport(CoreLocation)` extension below maps the real types onto
/// these one-to-one; it contains no logic of its own.
public enum PCALocationAuthorizationStatus: Equatable {
    case notDetermined
    case restricted
    case denied
    case authorizedWhenInUse
    case authorizedAlways
}

public enum PCALocationAccuracyAuthorization: Equatable {
    case fullAccuracy
    case reducedAccuracy
}

public enum LocationCapabilityAdapter {
    public static func state(
        authorizationStatus: PCALocationAuthorizationStatus,
        accuracyAuthorization: PCALocationAccuracyAuthorization,
        servicesEnabled: Bool,
        backgroundGranted: Bool
    ) -> LocationCapabilityState {
        guard servicesEnabled else { return .locationServicesOff }
        switch authorizationStatus {
        case .notDetermined, .restricted:
            return .notConfigured
        case .denied:
            return .permissionDenied
        case .authorizedWhenInUse:
            return backgroundGranted ? .active : .backgroundNotGranted
        case .authorizedAlways:
            return accuracyAuthorization == .reducedAccuracy ? .approximate : .active
        }
    }
}

#if canImport(CoreLocation)
public extension PCALocationAuthorizationStatus {
    init(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined: self = .notDetermined
        case .restricted: self = .restricted
        case .denied: self = .denied
        case .authorizedWhenInUse: self = .authorizedWhenInUse
        case .authorizedAlways: self = .authorizedAlways
        @unknown default: self = .notDetermined
        }
    }
}

public extension PCALocationAccuracyAuthorization {
    init(_ accuracy: CLAccuracyAuthorization) {
        self = (accuracy == .reducedAccuracy) ? .reducedAccuracy : .fullAccuracy
    }
}
#endif
