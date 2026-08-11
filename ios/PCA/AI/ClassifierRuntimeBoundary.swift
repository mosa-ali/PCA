import Foundation
#if canImport(CoreML)
import CoreML
#endif

/// PCA-14 iOS runtime boundary (doc 07 Section 13, doc 23). This module
/// defines ONLY the interface a Core ML classifier runs behind -- no
/// model ships in this source tree, no network egress path exists here,
/// and this type never overrides a deterministic policy decision (e.g.
/// `ScheduleEngine`/web-filter results) -- it can only ever produce an
/// ADVISORY classification a caller elsewhere chooses to consult,
/// mirroring the backend PCA-14 kill-switch/gate-completeness discipline
/// already verified there (see PROGRAMME_STATUS.md's Lane 4B review:
/// "classifier confirmed structurally unable to override deterministic
/// WebFilterEngine decisions").
public struct ClassificationResult: Equatable {
    public let label: String
    public let confidence: Double
    public init(label: String, confidence: Double) {
        self.label = label
        self.confidence = confidence
    }
}

public enum ClassifierAvailability: Equatable {
    case available
    /// No signed/verified model is currently loaded -- the caller must
    /// treat this as "no classification," never as "classified safe."
    case modelUnavailable
    /// Backend/doc-23 kill-switch signal received -- classification is
    /// disabled even if a model is technically loaded.
    case killSwitchEngaged
}

public protocol ClassifierRuntime {
    func availability() -> ClassifierAvailability
    func classify(inputDigest: Data) throws -> ClassificationResult
}

#if canImport(CoreML)
/// Placement-only production conformance: this type says WHERE inference
/// runs (Core ML, on-device, no network call in this method), not WHAT
/// model runs -- model provisioning/signing verification is doc 23's
/// governance, consumed here, never re-decided.
public final class CoreMLClassifierRuntime: ClassifierRuntime {
    private let model: MLModel?
    private let killSwitchEngaged: () -> Bool

    public init(model: MLModel?, killSwitchEngaged: @escaping () -> Bool) {
        self.model = model
        self.killSwitchEngaged = killSwitchEngaged
    }

    public func availability() -> ClassifierAvailability {
        if killSwitchEngaged() { return .killSwitchEngaged }
        return model != nil ? .available : .modelUnavailable
    }

    public func classify(inputDigest: Data) throws -> ClassificationResult {
        // Concrete `MLModel` invocation is intentionally not implemented
        // in this source-only slice -- it requires the specific model's
        // input/output feature schema (doc 23), which this boundary file
        // does not select. `availability()` is the contract callers must
        // check before ever calling this method.
        fatalError("CoreMLClassifierRuntime.classify requires a concrete model schema wired at the doc-23 integration point.")
    }
}
#endif
