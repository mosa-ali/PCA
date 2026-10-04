import XCTest
@testable import PCA
#if canImport(DeviceCheck)
import DeviceCheck
#endif

#if canImport(DeviceCheck)

/// WAVE 6D regression coverage for the App Attest adapter: fail-closed
/// mapping, key-id canonicalization, the two EXACT clientDataHash inputs
/// (pinned against the shared golden vectors), the deterministic evidence
/// envelope, and the 16 KiB budget. The platform service is substituted by
/// a capturing fake, so this suite runs on any simulator.
final class IosAppAttestAdapterTests: XCTestCase {

    private struct EnvelopeDecodingError: Error {}

    private final class FakeAppAttestService: IosAppAttestServing {
        var isSupported = true
        var appleKeyId: String = {
            let keyBytes = Data([0xFB, 0xFF]) + Data(repeating: 0x11, count: 30)
            return keyBytes.base64EncodedString()
        }()
        var attestationData = Data([0x01, 0x02, 0x03])
        var assertionData = Data([0x04, 0x05])
        var generateKeyError: Error?
        var attestationError: Error?
        var assertionError: Error?
        private(set) var attestationClientDataHashes: [Data] = []
        private(set) var assertionClientDataHashes: [Data] = []
        private(set) var requestedKeyIds: [String] = []

        func generateKey() async throws -> String {
            if let generateKeyError { throw generateKeyError }
            return appleKeyId
        }

        func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data {
            requestedKeyIds.append(keyId)
            attestationClientDataHashes.append(clientDataHash)
            if let attestationError { throw attestationError }
            return attestationData
        }

        func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data {
            requestedKeyIds.append(keyId)
            assertionClientDataHashes.append(clientDataHash)
            if let assertionError { throw assertionError }
            return assertionData
        }
    }

    private struct Vectors: Decodable {
        struct IosTranscriptInput: Decodable {
            let familyId: String
            let deviceId: String
            let ceremonyId: String
            let challengeId: String
            let nonce: String
            let dskKeyId: String
            let dskPublicKeyBase64: String
        }
        let iosTranscriptInput: IosTranscriptInput
        let iosTranscriptCanonicalBytes: String
        let iosAttestationClientData: String
    }

    private func loadVectors(sourceFile: StaticString = #filePath) throws -> Vectors {
        let thisFile = URL(fileURLWithPath: "\(sourceFile)")
        let repoRoot = thisFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let vectorsURL = repoRoot
            .appendingPathComponent("contracts")
            .appendingPathComponent("first-device-bootstrap")
            .appendingPathComponent("canonical-vectors.json")
        let data = try XCTUnwrap(FileManager.default.contents(atPath: vectorsURL.path))
        return try JSONDecoder().decode(Vectors.self, from: data)
    }

    func testUnsupportedServiceFailsClosed() async {
        let service = FakeAppAttestService()
        service.isSupported = false
        let adapter = IosAppAttestAdapter(service: service)
        XCTAssertFalse(adapter.isSupported())
        do {
            _ = try await adapter.buildEvidence(transcript: "t", dskKeyId: "d", dskPublicKeyBase64: "p")
            XCTFail("unsupported App Attest must not produce evidence")
        } catch {
            XCTAssertEqual(error as? IosAppAttestError, .appAttestUnsupported)
        }
    }

    func testPlatformFailuresMapToTypedErrors() async {
        let service = FakeAppAttestService()
        let adapter = IosAppAttestAdapter(service: service)

        service.generateKeyError = EnvelopeDecodingError()
        do {
            _ = try await adapter.buildEvidence(transcript: "t", dskKeyId: "d", dskPublicKeyBase64: "p")
            XCTFail("expected keyGenerationFailed")
        } catch {
            XCTAssertEqual(error as? IosAppAttestError, .keyGenerationFailed)
        }

        service.generateKeyError = nil
        service.attestationError = EnvelopeDecodingError()
        do {
            _ = try await adapter.buildEvidence(transcript: "t", dskKeyId: "d", dskPublicKeyBase64: "p")
            XCTFail("expected attestationFailed")
        } catch {
            XCTAssertEqual(error as? IosAppAttestError, .attestationFailed)
        }

        service.attestationError = nil
        service.assertionError = EnvelopeDecodingError()
        do {
            _ = try await adapter.buildEvidence(transcript: "t", dskKeyId: "d", dskPublicKeyBase64: "p")
            XCTFail("expected assertionFailed")
        } catch {
            XCTAssertEqual(error as? IosAppAttestError, .assertionFailed)
        }
    }

    func testClientDataHashesMatchSharedGoldenVectors() async throws {
        let vectors = try loadVectors()
        let service = FakeAppAttestService()
        let adapter = IosAppAttestAdapter(service: service)
        let transcript = vectors.iosTranscriptCanonicalBytes

        let evidence = try await adapter.buildEvidence(
            transcript: transcript,
            dskKeyId: vectors.iosTranscriptInput.dskKeyId,
            dskPublicKeyBase64: vectors.iosTranscriptInput.dskPublicKeyBase64
        )

        XCTAssertEqual(service.requestedKeyIds, [service.appleKeyId, service.appleKeyId])
        XCTAssertEqual(service.attestationClientDataHashes.count, 1)
        XCTAssertEqual(
            service.attestationClientDataHashes[0],
            FirstDeviceCanonical.sha256(Data(vectors.iosAttestationClientData.utf8)),
            "the attestation clientDataHash must equal sha256 of the enrollment-stable clientData string"
        )
        XCTAssertEqual(service.assertionClientDataHashes.count, 1)
        XCTAssertEqual(
            service.assertionClientDataHashes[0],
            FirstDeviceCanonical.sha256(Data(transcript.utf8)),
            "the assertion clientDataHash must equal sha256 of the exact 10-field transcript"
        )
        XCTAssertEqual(evidence.keyIdBase64Url.count, 43, "32 raw bytes must be 43 unpadded base64url characters")
        XCTAssertFalse(evidence.keyIdBase64Url.contains("="))
        XCTAssertFalse(evidence.keyIdBase64Url.contains("+"))
        XCTAssertFalse(evidence.keyIdBase64Url.contains("/"))
    }

    func testEvidenceEnvelopeIsDeterministicAndStrict() async throws {
        let service = FakeAppAttestService()
        service.attestationData = Data([0xAA, 0xBB])
        service.assertionData = Data([0xCC, 0xDD, 0xEE])
        let adapter = IosAppAttestAdapter(service: service)

        let evidence = try await adapter.buildEvidence(
            transcript: "26:PCA_IOS_DSK_ATTESTATION_V1",
            dskKeyId: "5555",
            dskPublicKeyBase64: "PK"
        )

        let expected = "{\"assertion\":\"\(FirstDeviceCanonical.base64Url(service.assertionData))\","
            + "\"attestation\":\"\(FirstDeviceCanonical.base64Url(service.attestationData))\","
            + "\"keyId\":\"\(evidence.keyIdBase64Url)\","
            + "\"platform\":\"IOS\","
            + "\"transcript\":\"26:PCA_IOS_DSK_ATTESTATION_V1\","
            + "\"v\":1}"
        XCTAssertEqual(evidence.json, expected)

        let parsed = try JSONSerialization.jsonObject(with: Data(evidence.json.utf8))
        guard let object = parsed as? [String: Any] else {
            throw EnvelopeDecodingError()
        }
        XCTAssertEqual(Set(object.keys), ["v", "platform", "keyId", "transcript", "attestation", "assertion"])
        XCTAssertEqual(object["v"] as? Int, 1)
        XCTAssertEqual(object["platform"] as? String, "IOS")
        XCTAssertFalse(evidence.json.contains("expiresAt"))
    }

    func testMalformedKeyIdFailsClosed() async {
        let service = FakeAppAttestService()
        service.appleKeyId = Data(repeating: 0x22, count: 16).base64EncodedString()
        let adapter = IosAppAttestAdapter(service: service)
        do {
            _ = try await adapter.buildEvidence(transcript: "t", dskKeyId: "d", dskPublicKeyBase64: "p")
            XCTFail("a non-32-byte key id must be refused")
        } catch {
            XCTAssertEqual(error as? IosAppAttestError, .malformedKeyId)
        }
    }

    func testOversizedEvidenceRejectedAtTheCertifiedBudget() async throws {
        let service = FakeAppAttestService()
        service.attestationData = Data(repeating: 0x33, count: 20_000)
        let adapter = IosAppAttestAdapter(service: service)
        do {
            _ = try await adapter.buildEvidence(transcript: "t", dskKeyId: "d", dskPublicKeyBase64: "p")
            XCTFail("evidence beyond 16 KiB must be refused locally")
        } catch {
            XCTAssertEqual(error as? IosAppAttestError, .evidenceTooLarge)
        }

        service.attestationData = Data(repeating: 0x33, count: 8_000)
        let evidence = try await adapter.buildEvidence(transcript: "t", dskKeyId: "d", dskPublicKeyBase64: "p")
        XCTAssertLessThanOrEqual(evidence.json.utf8.count, IosAppAttestAdapter.maxEvidenceBytes)
    }
}

#endif
