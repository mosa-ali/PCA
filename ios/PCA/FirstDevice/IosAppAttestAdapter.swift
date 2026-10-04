import Foundation
#if canImport(DeviceCheck)
import DeviceCheck
#endif
#if canImport(Security)
import Security
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// Fail-closed failures of the iOS App Attest adapter.
public enum IosAppAttestError: Error, Equatable {
    /// `DCAppAttestService.isSupported == false` on this device.
    case appAttestUnsupported
    /// The platform could not generate a fresh App Attest key.
    case keyGenerationFailed
    /// `attestKey` refused or failed.
    case attestationFailed
    /// `generateAssertion` refused or failed.
    case assertionFailed
    /// The platform returned a key id that is not 32 base64-decoded bytes.
    case malformedKeyId
    /// The serialized evidence exceeds the certified 16 KiB budget.
    case evidenceTooLarge
}

public struct IosAppAttestEvidence: Equatable {
    /// The ONE exact JSON string submitted as `attestationEvidence` and
    /// hashed into the DSK-signed bootstrap proof.
    public let json: String
    /// The App Attest key id in unpadded base64url (canonical transcription
    /// of Apple's standard base64 form).
    public let keyIdBase64Url: String
}

/// Seam over `DCAppAttestService` so the adapter's hashing/bounds/envelope
/// logic is unit-testable everywhere; production uses the real service.
public protocol IosAppAttestServing {
    var isSupported: Bool { get }
    func generateKey() async throws -> String
    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data
    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data
}

#if canImport(DeviceCheck)

extension DCAppAttestService: IosAppAttestServing {}

/// WAVE 6D: App Attest as the iOS platform-authenticity attestor for the
/// first-device ceremony. The App Attest key is STRUCTURALLY different from
/// the Secure Enclave DSK (it signs only Apple-app-scoped statements, never
/// arbitrary bytes), so it can never serve as a signing oracle for the
/// trust root; the ASSERTION instead signs
/// `sha256("PCA_IOS_DSK_ATTESTATION_V1" transcript)` -- binding the exact
/// DSK, family/device/ceremony/challenge/nonce and algorithm the DSK-signed
/// proof also covers. The ATTESTATION's `clientDataHash` is
/// ENROLLMENT-STABLE: `sha256("PCA_IOS_APPATTEST_ATTESTATION_V1|<dskKeyId>|<dskPublicKey>")`,
/// derivable by the server from the M1-expected DSK before any request, so
/// the client can never choose the attested content.
///
/// NO CIRCULAR HASH: the evidence JSON is assembled AFTER both platform
/// calls and is hashed by the CALLER into the DSK-signed proof; nothing here
/// depends on the proof.
public final class IosAppAttestAdapter {
    private let service: IosAppAttestServing

    public init(service: IosAppAttestServing) {
        self.service = service
    }

    public func isSupported() -> Bool {
        service.isSupported
    }

    /// Performs the two platform calls and returns the evidence envelope.
    /// `transcript` is the exact 10-field canonical transcript string.
    public func buildEvidence(
        transcript: String,
        dskKeyId: String,
        dskPublicKeyBase64: String
    ) async throws -> IosAppAttestEvidence {
        guard service.isSupported else { throw IosAppAttestError.appAttestUnsupported }

        let appleKeyId: String
        do {
            appleKeyId = try await service.generateKey()
        } catch {
            throw IosAppAttestError.keyGenerationFailed
        }
        let keyIdBase64Url = try canonicalKeyId(appleKeyId)

        // Attestation clientDataHash: enrollment-stable, server-derivable
        // from the M1-expected DSK; NEVER ceremony- or client-selected.
        let attestationClientData = FirstDeviceCanonical.iosAttestationClientData(
            dskKeyId: dskKeyId,
            dskPublicKeyBase64: dskPublicKeyBase64
        )
        let attestation: Data
        do {
            attestation = try await service.attestKey(
                appleKeyId,
                clientDataHash: FirstDeviceCanonical.sha256(Data(attestationClientData.utf8))
            )
        } catch {
            throw IosAppAttestError.attestationFailed
        }

        // Assertion: signs the ceremony transcript that binds the exact DSK.
        let assertion: Data
        do {
            assertion = try await service.generateAssertion(
                appleKeyId,
                clientDataHash: FirstDeviceCanonical.sha256(Data(transcript.utf8))
            )
        } catch {
            throw IosAppAttestError.assertionFailed
        }

        let envelope: [String: Any] = [
            "v": 1,
            "platform": "IOS",
            "keyId": keyIdBase64Url,
            "transcript": transcript,
            "attestation": FirstDeviceCanonical.base64Url(attestation),
            "assertion": FirstDeviceCanonical.base64Url(assertion),
        ]
        // sortedKeys makes the serialization byte-deterministic; the backend
        // parses by keyset, and the raw string is digested identically on
        // both sides (bound into the DSK-signed proof).
        let json = try jsonString(envelope)
        guard json.utf8.count <= IosAppAttestAdapter.maxEvidenceBytes else {
            throw IosAppAttestError.evidenceTooLarge
        }
        return IosAppAttestEvidence(json: json, keyIdBase64Url: keyIdBase64Url)
    }

    /// Certified evidence budget, identical to the Android envelope builder.
    public static let maxEvidenceBytes = 16_384

    private func canonicalKeyId(_ appleKeyId: String) throws -> String {
        var normalized = appleKeyId
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while normalized.count % 4 != 0 {
            normalized += "="
        }
        guard let data = Data(base64Encoded: normalized), data.count == 32 else {
            throw IosAppAttestError.malformedKeyId
        }
        return FirstDeviceCanonical.base64Url(data)
    }

    private func jsonString(_ envelope: [String: Any]) throws -> String {
        let serialized = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
        guard let json = String(data: serialized, encoding: .utf8) else {
            throw IosAppAttestError.evidenceTooLarge
        }
        return json
    }
}

#endif
