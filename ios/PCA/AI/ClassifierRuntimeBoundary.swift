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

/// Thrown by a `ClassifierRuntime` conformance that cannot honor a
/// `classify` call. Deliberately NOT a crash: doc 23 Section 1 requires
/// "no signed/verified model is currently loaded" to be treated as "no
/// classification," never as "classified safe," and a caller cannot
/// recover from -- or write a test against -- a `fatalError`. Throwing
/// keeps the fail-safe contract (no result is ever fabricated) while
/// staying within normal Swift error handling that both production
/// callers and XCTest can exercise.
public enum ClassifierRuntimeError: Error, Equatable {
    /// A concrete Core ML model/feature schema has not been wired at the
    /// doc-23 integration point yet (no signed model package ships in
    /// this source tree -- see doc 23 Section 3). Callers MUST treat this
    /// identically to `.modelUnavailable` from `availability()`: no
    /// classification happened, and nothing about the input was judged
    /// safe or unsafe.
    case modelSchemaNotWired
}

extension ClassifierRuntimeError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .modelSchemaNotWired:
            return "No concrete Core ML model schema is wired at the doc-23 integration point yet; this runtime cannot classify until a signed model package (doc 23 Section 3) is integrated by an owner decision."
        }
    }
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
        // input/output feature schema (doc 23), which no signed model
        // package in this repository currently supplies. `availability()`
        // is the contract callers must check before ever calling this
        // method; this throw is the fail-safe fallback for a caller that
        // calls anyway (or calls between an `availability()` check and a
        // model swap) -- it MUST NOT crash the host app (PCA-AI-001/
        // PCA-AI-002: a failed/unwired model retains deterministic-only
        // behavior, never an app crash) and MUST NOT fabricate a result.
        throw ClassifierRuntimeError.modelSchemaNotWired
    }
}
#endif
