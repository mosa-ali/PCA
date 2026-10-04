import Foundation
import CryptoKit

/// WAVE 6D: byte-exact iOS mirrors of the certified backend canonical
/// encoders (`backend/src/familytrustset/FirstDeviceBootstrapProof.ts`,
/// `backend/src/familytrustset/IosAttestationTranscript.ts`,
/// `backend/src/familytrustset/canonicalize.ts`). Every function here exists
/// so an iOS device can produce the EXACT byte strings the backend
/// re-encodes and compares; any drift is a rejection, so the encodings are
/// pinned by shared golden vectors
/// (`contracts/first-device-bootstrap/canonical-vectors.json`) that the
/// backend, Android and iOS/Swift test suites ALL validate.
///
/// Encoding rules (mirrored, not reinterpreted):
///  - netstring framing: `${utf8ByteLength}:${value}` concatenation; length
///    prefixes are UTF-8 BYTE counts (ASCII by construction here).
///  - base64url: RFC 4648 Section 5, UNPADDED (`-`/`_`, no `=`); padding is
///    a rejection at the backend, so the `=` strip is mandatory.
///  - ISO timestamps: exactly `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` (UTC, literal
///    uppercase Z, ALWAYS three fractional digits), the shape JavaScript's
///    `Date.toISOString()` produces. Server-issued `expiresAt` is echoed
///    VERBATIM from the challenge response; only device-generated
///    `issuedAt` values are formatted here.
///  - public keys: canonical SEC1 uncompressed `0x04 || X || Y` (65 bytes),
///    unpadded base64url -- the exact same representation the Secure
///    Enclave provider emits, so every representation of one DSK is
///    byte-identical.
public enum FirstDeviceCanonical {
    public static let proofDomain = "PCA_FIRST_DEVICE_BOOTSTRAP_V1"
    public static let proofVersion = 1
    public static let dskAlgorithm = "ECDSA_P256_SHA256"

    /// Wave 6D: domain of the App Attest assertion transcript signed for the
    /// first-device ceremony. App Attest's assertion key is structurally
    /// different from the DSK (it signs only Apple-app-scoped statements,
    /// never arbitrary bytes), so this transcript binds the App Attest key
    /// to the DSK and ceremony without ever being a general signing oracle.
    public static let iosAttestationDomain = "PCA_IOS_DSK_ATTESTATION_V1"
    public static let iosAttestationProtocolVersion = 1

    /// Domain-separated prefix of the App Attest ATTESTATION clientDataHash
    /// (enrollment-stable: derived from the DSK key id + public key, never
    /// from ceremony data -- see the backend verifier).
    public static let iosAttestationClientDataPrefix = "PCA_IOS_APPATTEST_ATTESTATION_V1"

    /// One netstring field: `${utf8ByteLength}:${value}`.
    public static func netstringField(_ value: String) -> String {
        "\(value.utf8.count):\(value)"
    }

    public static func sha256(_ data: Data) -> Data {
        Data(SHA256.hash(data: data))
    }

    public static func sha256Hex(_ data: Data) -> String {
        sha256(data).map { String(format: "%02x", $0) }.joined()
    }

    public static func sha256Hex(_ text: String) -> String {
        sha256Hex(Data(text.utf8))
    }

    /// Unpadded base64url (RFC 4648 Section 5). The ONLY base64 form this
    /// protocol ever transmits.
    public static func base64Url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Device-generated `issuedAt` in the exact backend-accepted shape.
    public static func isoUtcMillis(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        return formatter.string(from: date)
    }

    /// The 13-field `PCA_FIRST_DEVICE_BOOTSTRAP_V1` proof (statement A).
    /// `expiresAt` MUST be the server challenge's own ISO string, passed
    /// through verbatim (never re-formatted).
    public static func encodeProof(
        familyId: String,
        deviceId: String,
        ceremonyId: String,
        challengeId: String,
        nonce: String,
        expiresAt: String,
        dskKeyId: String,
        dskPublicKeyBase64: String,
        epoch1Sha256Hex: String,
        attestationEvidenceDigest: String?
    ) -> String {
        let fields = [
            proofDomain,
            String(proofVersion),
            familyId,
            deviceId,
            ceremonyId,
            challengeId,
            nonce,
            expiresAt,
            dskAlgorithm,
            dskKeyId,
            dskPublicKeyBase64,
            epoch1Sha256Hex,
            attestationEvidenceDigest ?? "null",
        ]
        return fields.map { netstringField($0) }.joined()
    }

    /// The epoch-1 canonical bytes (statement B, certified Wave-5B format):
    /// 6 + 7N netstring fields. Exactly one ACTIVE OWNER entry.
    public static func encodeEpoch1(
        familyId: String,
        deviceId: String,
        dskKeyId: String,
        dskPublicKeyBase64: String,
        dekKeyId: String,
        dekPublicKeyBase64: String,
        issuedAt: String
    ) -> String {
        let fields = [
            familyId,
            "1",
            "1",
            "1",
            deviceId,
            "OWNER",
            dskKeyId,
            dskPublicKeyBase64,
            dekKeyId,
            dekPublicKeyBase64,
            "ACTIVE",
            issuedAt,
            "null",
        ]
        return fields.map { netstringField($0) }.joined()
    }

    /// The 10-field `PCA_IOS_DSK_ATTESTATION_V1` transcript: the exact bytes
    /// the App Attest ASSERTION signs (`clientDataHash` = SHA-256 of this
    /// string). Frozen Wave 6D (Option A): NO `expiresAt` field -- freshness
    /// is carried by the DSK-signed proof's `expiresAt`/`nonce`, and the
    /// transcript intentionally contains only enrollment/ceremony-identity
    /// fields the server can rebuild from durable state.
    public static func encodeIosAttestationTranscript(
        familyId: String,
        deviceId: String,
        ceremonyId: String,
        challengeId: String,
        nonce: String,
        dskKeyId: String,
        dskPublicKeyBase64: String
    ) -> String {
        let fields = [
            iosAttestationDomain,
            String(iosAttestationProtocolVersion),
            familyId,
            deviceId,
            ceremonyId,
            challengeId,
            nonce,
            dskAlgorithm,
            dskKeyId,
            dskPublicKeyBase64,
        ]
        return fields.map { netstringField($0) }.joined()
    }

    /// Enrollment-stable App Attest ATTESTATION clientData string; the
    /// `clientDataHash` passed to `attestKey` is `sha256` of this UTF-8
    /// string. Derived ONLY from the DSK identity (never client-selected
    /// ceremony data), so the server can recompute it from the M1-expected
    /// DSK before any request arrives.
    public static func iosAttestationClientData(dskKeyId: String, dskPublicKeyBase64: String) -> String {
        "\(iosAttestationClientDataPrefix)|\(dskKeyId)|\(dskPublicKeyBase64)"
    }
}
