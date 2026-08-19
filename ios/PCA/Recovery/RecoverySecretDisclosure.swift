import Foundation

/// PCA-FR-144 / PCA-SEC-018: the disclosure shown before a Recovery Secret
/// is accepted as generated. The secret itself is intentionally absent from
/// this type and from the generation gate; a separate local/offline crypto
/// implementation owns secret generation and presentation.
public struct RecoverySecretLossDisclosure: Equatable {
    public static let title = "Protect your Recovery Secret"
    public static let body = "PCA infrastructure never receives or stores this secret. If you lose the Recovery Secret and all active parent devices, family recovery is permanently impossible. PCA support cannot recover it; start a new family enrollment instead."

    public let acknowledgementRequired: Bool = true

    public init() {}
}

public struct RecoverySecretGenerationReceipt: Equatable {
    public let disclosureAcknowledgedAtUtc: Date
    public let generatedAtUtc: Date
}

public enum RecoverySecretGenerationError: Error, Equatable {
    case disclosureNotPresented
    case disclosureNotAcknowledged
    case alreadyCompleted
}

/// Reachable-flow primitive for family creation: presentation and explicit
/// acknowledgement are required before the caller may complete local secret
/// generation. It never accepts, returns, persists, or transmits the secret.
public final class RecoverySecretGenerationGate {
    public private(set) var disclosurePresented = false
    public private(set) var disclosureAcknowledged = false
    public private(set) var generationCompleted = false

    private var acknowledgedAtUtc: Date?
    private let now: () -> Date

    public init(now: @escaping () -> Date = Date.init) {
        self.now = now
    }

    @discardableResult
    public func presentDisclosure() -> RecoverySecretLossDisclosure {
        disclosurePresented = true
        return RecoverySecretLossDisclosure()
    }

    public func acknowledgeDisclosure() throws {
        guard disclosurePresented else { throw RecoverySecretGenerationError.disclosureNotPresented }
        disclosureAcknowledged = true
        acknowledgedAtUtc = now()
    }

    @discardableResult
    public func completeGeneration() throws -> RecoverySecretGenerationReceipt {
        guard disclosurePresented else { throw RecoverySecretGenerationError.disclosureNotPresented }
        guard disclosureAcknowledged, let acknowledgedAtUtc else {
            throw RecoverySecretGenerationError.disclosureNotAcknowledged
        }
        guard !generationCompleted else { throw RecoverySecretGenerationError.alreadyCompleted }
        generationCompleted = true
        return RecoverySecretGenerationReceipt(disclosureAcknowledgedAtUtc: acknowledgedAtUtc, generatedAtUtc: now())
    }
}
