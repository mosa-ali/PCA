import XCTest
#if canImport(CoreML)
import CoreML
#endif
@testable import PCA

/// PCA-AI-001: `CoreMLClassifierRuntime` is a placement-only boundary --
/// no signed model package ships in this source tree (doc 23 Section 3),
/// so `classify()` cannot produce a real result. These tests prove the
/// CURRENT fail-safe behavior: an unwired runtime throws a typed,
/// catchable error rather than crashing (`fatalError` cannot be tested or
/// recovered from, which is exactly why it was replaced), and every
/// `ClassifierAvailability` state that is not `.available` is honestly
/// reported rather than defaulting to "safe." Full closure of PCA-AI-001
/// (an actual classification result) requires an owner-approved, signed
/// model package per doc 23 Section 3/4 -- that is an ML-asset/product
/// decision this source-only slice cannot make on its own.
final class ClassifierRuntimeBoundaryTests: XCTestCase {

    // MARK: - Platform-independent contract (fake conformance)

    /// A minimal fake so this contract is testable on any platform,
    /// mirroring the seam pattern the rest of PCATests uses for
    /// FamilyControls/DeviceActivity/Keychain types.
    private final class FakeClassifierRuntime: ClassifierRuntime {
        var stubAvailability: ClassifierAvailability
        var stubError: ClassifierRuntimeError?
        var stubResult: ClassificationResult?

        init(availability: ClassifierAvailability, error: ClassifierRuntimeError? = nil, result: ClassificationResult? = nil) {
            self.stubAvailability = availability
            self.stubError = error
            self.stubResult = result
        }

        func availability() -> ClassifierAvailability { stubAvailability }

        func classify(inputDigest: Data) throws -> ClassificationResult {
            if let stubError { throw stubError }
            guard let stubResult else { throw ClassifierRuntimeError.modelSchemaNotWired }
            return stubResult
        }
    }

    func testModelUnavailableIsNeverConfusedWithClassifiedSafe() {
        let runtime = FakeClassifierRuntime(availability: .modelUnavailable)
        XCTAssertEqual(runtime.availability(), .modelUnavailable)
        XCTAssertNotEqual(runtime.availability(), .available)
    }

    func testKillSwitchEngagedIsReportedEvenWhenAModelIsTechnicallyLoaded() {
        // doc 23 Section 1/6: kill-switch disables classification "even if
        // a model is technically loaded" -- availability must say so.
        let runtime = FakeClassifierRuntime(availability: .killSwitchEngaged)
        XCTAssertEqual(runtime.availability(), .killSwitchEngaged)
    }

    func testClassifyThrowsATypedCatchableErrorRatherThanCrashing() {
        let runtime = FakeClassifierRuntime(availability: .modelUnavailable, error: .modelSchemaNotWired)
        XCTAssertThrowsError(try runtime.classify(inputDigest: Data())) { error in
            XCTAssertEqual(error as? ClassifierRuntimeError, .modelSchemaNotWired)
        }
    }

    func testModelSchemaNotWiredHasAnExplainableErrorDescription() {
        // doc 23 Section 4: outputs (including failure) must be
        // explainable at a level appropriate for a parent/child, not a
        // bare crash or opaque error code.
        let description = ClassifierRuntimeError.modelSchemaNotWired.errorDescription
        XCTAssertNotNil(description)
        XCTAssertTrue(description?.contains("doc 23") ?? false)
    }

    func testAvailableRuntimeCanStillProduceAnAdvisoryResult() throws {
        // Confirms the contract also supports the eventual real-model
        // path (doc 23 Section 1 use case #4: "local model output for an
        // explicitly supported ambiguous input") without this boundary
        // ever asserting the result overrides deterministic policy --
        // that discipline lives in the callers this boundary is
        // deliberately advisory-only for.
        let expected = ClassificationResult(label: "ambiguous-low-confidence", confidence: 0.42)
        let runtime = FakeClassifierRuntime(availability: .available, result: expected)
        XCTAssertEqual(runtime.availability(), .available)
        XCTAssertEqual(try runtime.classify(inputDigest: Data("page-signal".utf8)), expected)
    }

    // MARK: - Real CoreML-backed conformance (macOS/iOS toolchain only)

    #if canImport(CoreML)
    func testCoreMLRuntimeReportsModelUnavailableWithoutAModel() {
        let runtime = CoreMLClassifierRuntime(model: nil, killSwitchEngaged: { false })
        XCTAssertEqual(runtime.availability(), .modelUnavailable)
    }

    func testCoreMLRuntimeReportsKillSwitchEngagedEvenWithoutAModel() {
        let runtime = CoreMLClassifierRuntime(model: nil, killSwitchEngaged: { true })
        XCTAssertEqual(runtime.availability(), .killSwitchEngaged)
    }

    func testCoreMLRuntimeClassifyFailsClosedInsteadOfCrashing() {
        // This is the direct regression test for PCA-AI-001: prior source
        // called `fatalError` here, which cannot be caught, cannot be
        // asserted on, and would take the whole host app down the moment
        // any caller invoked `classify()` before a model existed. Now it
        // must throw `ClassifierRuntimeError.modelSchemaNotWired`.
        let runtime = CoreMLClassifierRuntime(model: nil, killSwitchEngaged: { false })
        XCTAssertThrowsError(try runtime.classify(inputDigest: Data("anything".utf8))) { error in
            XCTAssertEqual(error as? ClassifierRuntimeError, .modelSchemaNotWired)
        }
    }
    #endif
}
