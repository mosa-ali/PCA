import XCTest
@testable import PCA

/// WAVE 6D regression coverage: the iOS canonical encoders must reproduce
/// the shared golden vectors byte for byte
/// (`contracts/first-device-bootstrap/canonical-vectors.json`), the same
/// vectors the certified backend and the Android client pin. The vectors
/// file is read directly off disk (relative to this test file's own source
/// location) rather than through `Bundle.main` -- mirroring
/// `LocalizationKeyParityTests`' disk-level technique.
final class FirstDeviceCanonicalTests: XCTestCase {
    private struct Vectors: Decodable {
        struct ProofInput: Decodable {
            let familyId: String
            let deviceId: String
            let ceremonyId: String
            let challengeId: String
            let nonce: String
            let expiresAtIso: String
            let dskKeyId: String
            let dskPublicKeyBase64: String
            let epoch1Sha256Hex: String
            let attestationEvidenceDigest: String
        }
        struct Epoch1Input: Decodable {
            let familyId: String
            let deviceId: String
            let dskKeyId: String
            let dskPublicKeyBase64: String
            let dekKeyId: String
            let dekPublicKeyBase64: String
            let issuedAtIso: String
        }
        struct IosTranscriptInput: Decodable {
            let familyId: String
            let deviceId: String
            let ceremonyId: String
            let challengeId: String
            let nonce: String
            let dskKeyId: String
            let dskPublicKeyBase64: String
        }
        let proofInput: ProofInput
        let proofCanonicalBytes: String
        let proofCanonicalSha256Hex: String
        let epoch1Input: Epoch1Input
        let epoch1CanonicalBytes: String
        let epoch1CanonicalSha256Hex: String
        let iosTranscriptInput: IosTranscriptInput
        let iosTranscriptCanonicalBytes: String
        let iosTranscriptCanonicalSha256Hex: String
        let iosAttestationClientData: String
        let iosAttestationClientDataSha256Hex: String
    }

    private func loadVectors(sourceFile: StaticString = #filePath) throws -> Vectors {
        // This file lives at ios/PCATests/FirstDeviceCanonicalTests.swift;
        // the vectors live at contracts/first-device-bootstrap/ off the
        // repository root, three directories up.
        let thisFile = URL(fileURLWithPath: "\(sourceFile)")
        let repoRoot = thisFile
            .deletingLastPathComponent() // ios/PCATests
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // repository root
        let vectorsURL = repoRoot
            .appendingPathComponent("contracts")
            .appendingPathComponent("first-device-bootstrap")
            .appendingPathComponent("canonical-vectors.json")
        let data = try XCTUnwrap(
            FileManager.default.contents(atPath: vectorsURL.path),
            "canonical-vectors.json not found at \(vectorsURL.path)"
        )
        return try JSONDecoder().decode(Vectors.self, from: data)
    }

    func testProofEncodingMatchesSharedGoldenVector() throws {
        let vectors = try loadVectors()
        let proof = FirstDeviceCanonical.encodeProof(
            familyId: vectors.proofInput.familyId,
            deviceId: vectors.proofInput.deviceId,
            ceremonyId: vectors.proofInput.ceremonyId,
            challengeId: vectors.proofInput.challengeId,
            nonce: vectors.proofInput.nonce,
            expiresAt: vectors.proofInput.expiresAtIso,
            dskKeyId: vectors.proofInput.dskKeyId,
            dskPublicKeyBase64: vectors.proofInput.dskPublicKeyBase64,
            epoch1Sha256Hex: vectors.proofInput.epoch1Sha256Hex,
            attestationEvidenceDigest: vectors.proofInput.attestationEvidenceDigest
        )
        XCTAssertEqual(proof, vectors.proofCanonicalBytes)
        XCTAssertEqual(FirstDeviceCanonical.sha256Hex(proof), vectors.proofCanonicalSha256Hex)
        XCTAssertEqual(proof.utf8.count, 547, "proof byte length drifted from the certified encoding")
        XCTAssertTrue(proof.hasPrefix("29:PCA_FIRST_DEVICE_BOOTSTRAP_V11:1"))
    }

    func testEpoch1EncodingMatchesSharedGoldenVector() throws {
        let vectors = try loadVectors()
        let epoch1 = FirstDeviceCanonical.encodeEpoch1(
            familyId: vectors.epoch1Input.familyId,
            deviceId: vectors.epoch1Input.deviceId,
            dskKeyId: vectors.epoch1Input.dskKeyId,
            dskPublicKeyBase64: vectors.epoch1Input.dskPublicKeyBase64,
            dekKeyId: vectors.epoch1Input.dekKeyId,
            dekPublicKeyBase64: vectors.epoch1Input.dekPublicKeyBase64,
            issuedAt: vectors.epoch1Input.issuedAtIso
        )
        XCTAssertEqual(epoch1, vectors.epoch1CanonicalBytes)
        XCTAssertEqual(FirstDeviceCanonical.sha256Hex(epoch1), vectors.epoch1CanonicalSha256Hex)
        XCTAssertEqual(epoch1.utf8.count, 393)
        XCTAssertTrue(epoch1.hasSuffix("4:null"), "the supersedes marker must be the literal null field")
    }

    func testIosAttestationTranscriptMatchesSharedGoldenVector() throws {
        let vectors = try loadVectors()
        let transcript = FirstDeviceCanonical.encodeIosAttestationTranscript(
            familyId: vectors.iosTranscriptInput.familyId,
            deviceId: vectors.iosTranscriptInput.deviceId,
            ceremonyId: vectors.iosTranscriptInput.ceremonyId,
            challengeId: vectors.iosTranscriptInput.challengeId,
            nonce: vectors.iosTranscriptInput.nonce,
            dskKeyId: vectors.iosTranscriptInput.dskKeyId,
            dskPublicKeyBase64: vectors.iosTranscriptInput.dskPublicKeyBase64
        )
        XCTAssertEqual(transcript, vectors.iosTranscriptCanonicalBytes)
        XCTAssertEqual(FirstDeviceCanonical.sha256Hex(transcript), vectors.iosTranscriptCanonicalSha256Hex)
        XCTAssertEqual(transcript.utf8.count, 383, "transcript byte length drifted from the frozen Option A encoding")
        XCTAssertTrue(transcript.hasPrefix("26:PCA_IOS_DSK_ATTESTATION_V11:1"))
        XCTAssertFalse(transcript.contains("expiresAt"), "frozen Option A: no expiresAt field may reappear")
        XCTAssertEqual(FirstDeviceCanonical.iosAttestationDomain, "PCA_IOS_DSK_ATTESTATION_V1")
        XCTAssertEqual(FirstDeviceCanonical.iosAttestationProtocolVersion, 1)
    }

    func testIosAttestationClientDataMatchesSharedGoldenVector() throws {
        let vectors = try loadVectors()
        let clientData = FirstDeviceCanonical.iosAttestationClientData(
            dskKeyId: vectors.iosTranscriptInput.dskKeyId,
            dskPublicKeyBase64: vectors.iosTranscriptInput.dskPublicKeyBase64
        )
        XCTAssertEqual(clientData, vectors.iosAttestationClientData)
        XCTAssertFalse(clientData.contains("expiresAt"))
        XCTAssertEqual(FirstDeviceCanonical.sha256Hex(clientData), vectors.iosAttestationClientDataSha256Hex)
        XCTAssertEqual(
            FirstDeviceCanonical.iosAttestationClientDataPrefix,
            "PCA_IOS_APPATTEST_ATTESTATION_V1"
        )
    }

    func testNetstringLengthIsUTF8ByteCount() {
        XCTAssertEqual(FirstDeviceCanonical.netstringField("abc"), "3:abc")
        XCTAssertEqual(FirstDeviceCanonical.netstringField(""), "0:")
        // Two two-byte UTF-8 scalars: 4 bytes, never 2 characters.
        XCTAssertEqual(FirstDeviceCanonical.netstringField("\u{00E9}\u{00E9}"), "4:\u{00E9}\u{00E9}")
    }

    func testBase64UrlEncodingIsUnpaddedAndURLSafe() {
        XCTAssertEqual(FirstDeviceCanonical.base64Url(Data([0xFB, 0xFF])), "-_8")
        XCTAssertEqual(FirstDeviceCanonical.base64Url(Data()), "")
        let sample = Data([0xBA, 0xEC, 0x03, 0x04, 0xFB, 0xFF])
        let encoded = FirstDeviceCanonical.base64Url(sample)
        XCTAssertFalse(encoded.contains("+"))
        XCTAssertFalse(encoded.contains("/"))
        XCTAssertFalse(encoded.contains("="))
    }

    func testIsoUtcMillisFormatIsExactlyThreeFractions() {
        var components = DateComponents()
        components.year = 2026
        components.month = 10
        components.day = 2
        components.hour = 0
        components.minute = 0
        components.second = 0
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = calendar.date(from: components)!
        XCTAssertEqual(FirstDeviceCanonical.isoUtcMillis(date), "2026-10-02T00:00:00.000Z")

        let dateWithMillis = date.addingTimeInterval(0.123)
        XCTAssertEqual(FirstDeviceCanonical.isoUtcMillis(dateWithMillis), "2026-10-02T00:00:00.123Z")

        let formatted = FirstDeviceCanonical.isoUtcMillis(Date())
        let pattern = #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#
        XCTAssertNotNil(formatted.range(of: pattern, options: .regularExpression), "shape drifted: \(formatted)")
    }

    func testSha256HexKnownVector() {
        // SHA-256("abc"), the standard NIST test vector.
        XCTAssertEqual(
            FirstDeviceCanonical.sha256Hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
        XCTAssertEqual(FirstDeviceCanonical.sha256(Data("abc".utf8)).count, 32)
    }
}
