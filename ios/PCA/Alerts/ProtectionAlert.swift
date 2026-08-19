import Foundation

/// PCA-ADD-ENR-020's exact event list. The enum is metadata only; readable
/// family detail is never part of an alert record.
public enum ProtectionAlertTrigger: String, CaseIterable, Codable {
    case disableOrRemovalRequested = "DISABLE_OR_REMOVAL_REQUESTED"
    case repeatedInvalidPin = "REPEATED_INVALID_PIN"
    case authorityChange = "AUTHORITY_CHANGE"
    case criticalPermissionOrVpnLost = "CRITICAL_PERMISSION_OR_VPN_LOST"
    case unexpectedOffline = "UNEXPECTED_OFFLINE"
    case timeTampering = "TIME_TAMPERING"
    case protectionDegraded = "PROTECTION_DEGRADED"
    case reinstallation = "REINSTALLATION"
    case invitationRedeemed = "INVITATION_REDEEMED"
    case unenrollment = "UNENROLLMENT"
}

public struct E2EEProtectionAlert: Equatable, Codable, Identifiable {
    public let id: String
    public let familyId: String
    public let deviceId: String?
    public let parentDeviceId: String
    public let trigger: ProtectionAlertTrigger
    public let keyEpoch: Int
    public let generatedAtUtc: Date
    /// Already encrypted by the device/family crypto layer; never plaintext.
    public let encryptedPayload: Data
    public let nonce: Data
}

public enum ProtectionAlertGenerationError: Error, Equatable {
    case invalidOpaqueIdentifier
    case invalidKeyEpoch
    case invalidEncryptedPayload
    case deviceRequired
}

public struct ProtectionAlertGenerator {
    public static let maxEncryptedPayloadBytes = 16 * 1024
    public static let maxNonceBytes = 64

    public init() {}

    /// Returns nil when family alerting is disabled. The input payload must
    /// already be encrypted for `parentDeviceId`; this function does not
    /// implement cryptography and has no plaintext-detail parameter.
    public func generate(
        alertId: String,
        familyId: String,
        deviceId: String?,
        parentDeviceId: String,
        trigger: ProtectionAlertTrigger,
        keyEpoch: Int,
        generatedAtUtc: Date,
        encryptedPayload: Data,
        nonce: Data,
        alertsEnabled: Bool
    ) throws -> E2EEProtectionAlert? {
        guard alertsEnabled else { return nil }
        guard !alertId.isEmpty, !familyId.isEmpty, !parentDeviceId.isEmpty else {
            throw ProtectionAlertGenerationError.invalidOpaqueIdentifier
        }
        guard keyEpoch >= 0 else { throw ProtectionAlertGenerationError.invalidKeyEpoch }
        guard !encryptedPayload.isEmpty, encryptedPayload.count <= Self.maxEncryptedPayloadBytes,
              !nonce.isEmpty, nonce.count <= Self.maxNonceBytes else {
            throw ProtectionAlertGenerationError.invalidEncryptedPayload
        }
        if trigger != .invitationRedeemed, deviceId == nil {
            throw ProtectionAlertGenerationError.deviceRequired
        }

        return E2EEProtectionAlert(
            id: alertId,
            familyId: familyId,
            deviceId: deviceId,
            parentDeviceId: parentDeviceId,
            trigger: trigger,
            keyEpoch: keyEpoch,
            generatedAtUtc: generatedAtUtc,
            encryptedPayload: encryptedPayload,
            nonce: nonce
        )
    }
}
