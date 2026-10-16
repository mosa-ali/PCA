import XCTest
import CryptoKit
@testable import PCA

final class PolicyApplicationGateTests: XCTestCase {
    func testMissingTrustedFloorFailsClosed() {
        let candidate = PolicyEpochStamp(trustSetEpoch: 5, keyEpoch: 3)
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: candidate, currentFloor: nil), .rejectMissingTrustedEpochFloor)
    }

    func testEqualEpochsAreAccepted() {
        let floor = PolicyEpochStamp(trustSetEpoch: 2, keyEpoch: 2)
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: floor, currentFloor: floor), .apply)
    }

    func testHigherEpochsAreAccepted() {
        let floor = PolicyEpochStamp(trustSetEpoch: 2, keyEpoch: 2)
        let candidate = PolicyEpochStamp(trustSetEpoch: 3, keyEpoch: 3)
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: candidate, currentFloor: floor), .apply)
    }

    func testStaleTrustSetEpochIsRejectedIndependentlyOfKeyEpoch() {
        let floor = PolicyEpochStamp(trustSetEpoch: 5, keyEpoch: 1)
        let candidate = PolicyEpochStamp(trustSetEpoch: 4, keyEpoch: 10) // keyEpoch higher, trustSetEpoch lower
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: candidate, currentFloor: floor), .rejectStaleTrustSetEpoch)
    }

    func testStaleKeyEpochIsRejectedIndependentlyOfTrustSetEpoch() {
        let floor = PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: 5)
        let candidate = PolicyEpochStamp(trustSetEpoch: 10, keyEpoch: 4) // trustSetEpoch higher, keyEpoch lower
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: candidate, currentFloor: floor), .rejectStaleKeyEpoch)
    }

    func testReplayOfAnAlreadyAcceptedStampIsAcceptedNotRejected() {
        // Idempotent redelivery of the exact current floor is not a
        // downgrade -- must not be rejected as stale.
        let floor = PolicyEpochStamp(trustSetEpoch: 3, keyEpoch: 3)
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: floor, currentFloor: floor), .apply)
    }

    func testInt32MaximumEpochsAreAccepted() {
        let maximum = PolicyApplicationGate.maximumEpoch
        let stamp = PolicyEpochStamp(trustSetEpoch: maximum, keyEpoch: maximum)

        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: stamp, currentFloor: stamp), .apply)
    }

    func testCandidateAboveInt32MaximumIsRejected() {
        let maximum = PolicyApplicationGate.maximumEpoch
        let floor = PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: 0)

        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: maximum + 1, keyEpoch: 0),
                currentFloor: floor
            ),
            .rejectInvalidCandidateEpoch
        )
        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: maximum + 1),
                currentFloor: floor
            ),
            .rejectInvalidCandidateEpoch
        )
    }

    func testPersistedFloorAboveInt32MaximumIsRejected() {
        let maximum = PolicyApplicationGate.maximumEpoch

        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: maximum, keyEpoch: 1),
                currentFloor: PolicyEpochStamp(trustSetEpoch: maximum + 1, keyEpoch: 1)
            ),
            .rejectInvalidTrustedEpochFloor
        )
        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: maximum),
                currentFloor: PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: maximum + 1)
            ),
            .rejectInvalidTrustedEpochFloor
        )
    }

    func testNegativeCandidateEpochsAreRejectedButZeroKeyEpochRemainsValid() {
        let zeroKeyFloor = PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: 0)

        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: -1, keyEpoch: 0),
                currentFloor: zeroKeyFloor
            ),
            .rejectInvalidCandidateEpoch
        )
        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: 0, keyEpoch: 0),
                currentFloor: zeroKeyFloor
            ),
            .rejectInvalidCandidateEpoch
        )
        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: -1),
                currentFloor: zeroKeyFloor
            ),
            .rejectInvalidCandidateEpoch
        )
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: zeroKeyFloor, currentFloor: zeroKeyFloor), .apply)
    }

    func testInvalidPersistedFloorIsRejectedIncludingNegativeAndZeroTrustSetEpoch() {
        let candidate = PolicyEpochStamp(trustSetEpoch: 2, keyEpoch: 0)

        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: candidate,
                currentFloor: PolicyEpochStamp(trustSetEpoch: 0, keyEpoch: 0)
            ),
            .rejectInvalidTrustedEpochFloor
        )
        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: candidate,
                currentFloor: PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: -1)
            ),
            .rejectInvalidTrustedEpochFloor
        )
    }

    func testDevicePolicyProofTranscriptUsesFrozenElevenNetstringFields() throws {
        let vector = try sharedProofVector()
        XCTAssertEqual(vector.validProof.fields.domain, PCADevicePolicyProofCodec.domain)
        XCTAssertEqual(vector.validProof.fields.applicationResult, PCADevicePolicyApplicationResult.applied.rawValue)
        let challenge = sharedVectorProofChallenge(vector.validProof.fields)
        let transcript = try PCADevicePolicyProofCodec.encode(challenge, result: .applied)
        let expectedTranscript = try XCTUnwrap(PCADevicePolicyProofCodec.decodeCanonicalBase64URL(
            vector.validProof.transcriptBase64Url))
        XCTAssertEqual(transcript, expectedTranscript)
        XCTAssertLessThanOrEqual(transcript.count, PCADevicePolicyProofCodec.maximumTranscriptBytes)
    }

    func testSharedVectorSignatureVerifiesWithSyntheticDsk() throws {
        let vector = try sharedProofVector()
        let fields = vector.validProof.fields
        let transcript = try PCADevicePolicyProofCodec.encode(sharedVectorProofChallenge(fields), result: .applied)
        let publicKeyBytes = try XCTUnwrap(PCADevicePolicyProofCodec.decodeCanonicalBase64URL(
            vector.validProof.syntheticDskPublicKeySec1Base64Url))
        let signatureBytes = try XCTUnwrap(PCADevicePolicyProofCodec.decodeCanonicalBase64URL(
            vector.validProof.signatureBase64Url))
        XCTAssertTrue(P256DerSignature.isLowS(signatureBytes))
        let key = try P256.Signing.PublicKey(x963Representation: publicKeyBytes)
        let signature = try P256.Signing.ECDSASignature(rawRepresentation: signatureBytes)
        XCTAssertTrue(key.isValidSignature(signature, for: transcript))
    }

    func testProofTranscriptBindsDigestFamilyDeviceEpochAndResult() throws {
        let value = proofChallenge()
        let baseline = try PCADevicePolicyProofCodec.encode(value, result: .applied)
        let changedDigest = PCADevicePolicyProofChallenge(challengeId: value.challengeId, nonce: value.nonce,
            familyId: value.familyId, deviceId: value.deviceId, policyEnvelopeMessageId: value.policyEnvelopeMessageId,
            policyEnvelopeSha256: PCADevicePolicyProofCodec.base64URL(Data(repeating: 1, count: 32)),
            trustSetEpoch: value.trustSetEpoch, keyEpoch: value.keyEpoch, expiresAt: value.expiresAt)
        let changedFamily = PCADevicePolicyProofChallenge(challengeId: value.challengeId, nonce: value.nonce,
            familyId: "00000000-0000-4000-8000-000000000009", deviceId: value.deviceId,
            policyEnvelopeMessageId: value.policyEnvelopeMessageId, policyEnvelopeSha256: value.policyEnvelopeSha256,
            trustSetEpoch: value.trustSetEpoch, keyEpoch: value.keyEpoch, expiresAt: value.expiresAt)
        XCTAssertNotEqual(try PCADevicePolicyProofCodec.encode(changedDigest, result: .applied), baseline)
        XCTAssertNotEqual(try PCADevicePolicyProofCodec.encode(changedFamily, result: .applied), baseline)
        XCTAssertNotEqual(try PCADevicePolicyProofCodec.encode(value, result: .degraded), baseline)
    }

    func testProofCodecRejectsNoncanonicalNonceEpochAndTimestamp() {
        let valid = proofChallenge()
        let paddedNonce = PCADevicePolicyProofChallenge(challengeId: valid.challengeId, nonce: valid.nonce + "=",
            familyId: valid.familyId, deviceId: valid.deviceId, policyEnvelopeMessageId: valid.policyEnvelopeMessageId,
            policyEnvelopeSha256: valid.policyEnvelopeSha256, trustSetEpoch: valid.trustSetEpoch,
            keyEpoch: valid.keyEpoch, expiresAt: valid.expiresAt)
        XCTAssertThrowsError(try PCADevicePolicyProofCodec.encode(paddedNonce, result: .applied))
        let zeroEpoch = PCADevicePolicyProofChallenge(challengeId: valid.challengeId, nonce: valid.nonce,
            familyId: valid.familyId, deviceId: valid.deviceId, policyEnvelopeMessageId: valid.policyEnvelopeMessageId,
            policyEnvelopeSha256: valid.policyEnvelopeSha256, trustSetEpoch: 0,
            keyEpoch: valid.keyEpoch, expiresAt: valid.expiresAt)
        XCTAssertThrowsError(try PCADevicePolicyProofCodec.encode(zeroEpoch, result: .applied))
        let alternateTimestamp = PCADevicePolicyProofChallenge(challengeId: valid.challengeId, nonce: valid.nonce,
            familyId: valid.familyId, deviceId: valid.deviceId, policyEnvelopeMessageId: valid.policyEnvelopeMessageId,
            policyEnvelopeSha256: valid.policyEnvelopeSha256, trustSetEpoch: valid.trustSetEpoch,
            keyEpoch: valid.keyEpoch, expiresAt: "2026-10-16T12:30:00Z")
        XCTAssertThrowsError(try PCADevicePolicyProofCodec.encode(alternateTimestamp, result: .applied))
    }

    func testEnvelopeCanonicalBytesMatchBackendFieldOrderAndChangeWithCiphertext() throws {
        let vector = try sharedProofVector()
        let fields = vector.canonicalEnvelope.envelopeFields
        let envelope = sharedVectorEnvelope(fields)
        let bytes = try PCADevicePolicyEnvelopeCanonicalizer.canonicalBytes(envelope)
        let expectedBytes = try XCTUnwrap(PCADevicePolicyProofCodec.decodeCanonicalBase64URL(
            vector.canonicalEnvelope.bytesBase64Url))
        XCTAssertEqual(bytes, expectedBytes)
        let digest = try PCADevicePolicyEnvelopeCanonicalizer.sha256(bytes)
        XCTAssertEqual(PCADevicePolicyProofCodec.base64URL(digest), vector.canonicalEnvelope.sha256Base64Url)
        XCTAssertEqual(digest.map { String(format: "%02x", $0) }.joined(), vector.canonicalEnvelope.sha256Hex)
        XCTAssertNotEqual(bytes, try PCADevicePolicyEnvelopeCanonicalizer.canonicalBytes(sharedVectorEnvelope(
            fields,
            payload: Data([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
                0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xfe]))))
        XCTAssertLessThanOrEqual(bytes.count, PCADevicePolicyEnvelopeCanonicalizer.maximumCanonicalBytes)
        XCTAssertThrowsError(try PCADevicePolicyEnvelopeCanonicalizer.canonicalBytes(
            sharedVectorEnvelope(fields, issuedAt: "2026-10-15T03:55:00.000+03:00")
        ))
    }

    private struct SharedDevicePolicyProofVector: Decodable {
        let canonicalEnvelope: CanonicalEnvelope
        let validProof: ValidProof

        struct CanonicalEnvelope: Decodable {
            let bytesBase64Url: String
            let sha256Hex: String
            let sha256Base64Url: String
            let envelopeFields: EnvelopeFields

            struct EnvelopeFields: Decodable {
                let protocolMajor: Int
                let protocolMinor: Int
                let messageId: String
                let familyId: String
                let senderDeviceId: String
                let recipientKind: String
                let recipientDeviceId: String
                let senderKeyId: String
                let messageType: String
                let sequenceOrNonce: String
                let issuedAt: String
                let expiresAt: String
                let trustSetEpoch: Int
                let keyEpoch: Int
                let semanticVersion: String
                let correlationId: String?
                let encryptedPayloadBase64: String
            }
        }

        struct ValidProof: Decodable {
            let fields: ProofFields
            let transcriptBase64Url: String
            let syntheticDskPublicKeySec1Base64Url: String
            let signatureBase64Url: String

            struct ProofFields: Decodable {
                let domain: String
                let familyId: String
                let deviceId: String
                let policyEnvelopeMessageId: String
                let policyEnvelopeSha256: String
                let trustSetEpoch: Int
                let keyEpoch: Int
                let applicationResult: String
                let challengeId: String
                let challengeNonce: String
                let challengeExpiresAt: String
            }
        }
    }

    func testProofStoreReturnsByteIdenticalRetryAndPrunesAtFourteenDays() throws {
        let now = ISO8601DateFormatter().date(from: "2026-10-16T12:00:00Z")!
        let challenge = proofChallenge()
        let signer = TestProofSigner()
        let store = PCADeviceApplicationProofStore(keychain: InMemoryKeychainStore(), serviceNamespace: "proof-test")
        let proof = try store.proofOrCreate(challenge: challenge, result: .applied, dsk: signer, now: now)
        XCTAssertEqual(try store.proofOrCreate(challenge: challenge, result: .applied, dsk: signer, now: now), proof)
        XCTAssertEqual(signer.signCount, 1)
        XCTAssertThrowsError(try store.proofOrCreate(challenge: challenge, result: .degraded, dsk: signer, now: now))
        let afterRetention = now.addingTimeInterval(PCADevicePolicyProofCodec.tombstoneRetention + 1)
        XCTAssertNil(try store.proof(challengeId: proof.challengeId, now: afterRetention))
    }

    func testPairedBootstrapClientUsesNarrowRoutesAndPinsTargetDigest() async throws {
        let now = ISO8601DateFormatter().date(from: "2026-10-16T12:00:00Z")!
        let challengeId = "00000000-0000-4000-8000-000000000003"
        let nonce = PCADevicePolicyProofCodec.base64URL(Data(repeating: 0, count: 32))
        let sessionToken = String(repeating: "A", count: 48)
        let envelope = policyEnvelope(payload: Data([1, 2, 3]))
        let canonical = try PCADevicePolicyEnvelopeCanonicalizer.canonicalBytes(envelope)
        let digest = PCADevicePolicyProofCodec.base64URL(try PCADevicePolicyEnvelopeCanonicalizer.sha256(canonical))
        var paths: [String] = []
        let transport = InMemoryPCAHTTPTransport { request in
            paths.append(request.url!.path)
            let body: [String: Any]
            switch request.url!.path {
            case "/v1/device-policy-activation/bootstrap/challenge":
                body = ["challengeId": challengeId, "nonce": nonce, "expiresAt": "2026-10-16T12:01:00.000Z"]
            case "/v1/device-policy-activation/bootstrap/complete":
                body = ["challengeId": challengeId, "nonce": nonce, "expiresAt": "2026-10-16T12:01:00.000Z",
                    "sessionToken": sessionToken, "sessionExpiresAt": "2026-10-16T12:10:00.000Z", "policyEnvelopeMessageId": "policy1",
                    "policyEnvelopeSha256": digest, "trustSetEpoch": 7, "keyEpoch": 4]
            case "/v1/device-policy-activation/bootstrap/fetch":
                body = ["challengeId": challengeId, "policyEnvelopeMessageId": "policy1",
                    "policyEnvelopeSha256": digest, "canonicalEnvelopeBytes": PCADevicePolicyProofCodec.base64URL(canonical),
                    "envelopeSignature": "test-signature", "trustSetEpoch": 7, "keyEpoch": 4]
            case "/v1/device-policy-activation/proof":
                body = ["outcome": "ACTIVATED", "idempotent": false]
            case "/v1/device-policy-activation/proof/status":
                body = ["outcome": "ACTIVATED", "idempotent": true]
            default: throw PCAHTTPTransportError.invalidResponse
            }
            return PCAHTTPResponse(statusCode: 200, data: try JSONSerialization.data(withJSONObject: body))
        }
        let client = try PCADevicePolicyActivationClient(baseURL: URL(string: "https://api.example.test")!,
            transport: transport, now: { now })
        let first = try await client.challenge(familyId: envelope.familyId, deviceId: envelope.recipientDeviceId!)
        var signatureBytes = Data(repeating: 0, count: 64); signatureBytes[31] = 1; signatureBytes[63] = 1
        let response = try await client.complete(familyId: envelope.familyId, deviceId: envelope.recipientDeviceId!,
            challenge: first, signature: PCADevicePolicyProofCodec.base64URL(signatureBytes))
        let target = try await client.fetch(familyId: envelope.familyId, deviceId: envelope.recipientDeviceId!, session: response)
        XCTAssertEqual(try target.canonicalBytes(), canonical)
        XCTAssertEqual(response.proofChallenge.familyId, envelope.familyId)
        let proof = try PCADevicePolicyProofCodec.proof(challenge: response.proofChallenge, result: .applied,
            dsk: TestProofSigner(), now: now)
        let submitResult = try await client.submit(proof, session: response)
        XCTAssertEqual(submitResult, PCADevicePolicyApplicationProofResponse(outcome: .activated, idempotent: false))
        let recoveredResult = try await client.recoverExactProof(proof, session: response)
        XCTAssertEqual(recoveredResult, PCADevicePolicyApplicationProofResponse(outcome: .activated, idempotent: true))
        XCTAssertEqual(paths, ["/v1/device-policy-activation/bootstrap/challenge",
            "/v1/device-policy-activation/bootstrap/complete", "/v1/device-policy-activation/bootstrap/fetch",
            "/v1/device-policy-activation/proof", "/v1/device-policy-activation/proof/status"])
        XCTAssertNil(transport.requests[0].value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(transport.requests[1].value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(transport.requests.dropFirst(2).map { $0.value(forHTTPHeaderField: "Authorization") },
            Array(repeating: "Bearer \(sessionToken)", count: 3))
        let proofBody = try XCTUnwrap(transport.requests.first(where: { $0.url?.path == "/v1/device-policy-activation/proof" })?.httpBody)
        let proofObject = try XCTUnwrap(JSONSerialization.jsonObject(with: proofBody) as? [String: Any])
        XCTAssertEqual(Set(proofObject.keys), Set(["familyId", "deviceId", "policyEnvelopeMessageId", "policyEnvelopeSha256",
            "trustSetEpoch", "keyEpoch", "applicationResult", "challengeId", "challengeNonce", "challengeExpiresAt", "signature"]))
    }

    private final class TestProofSigner: PCADeviceProofProvider {
        var signingPublicKey = "test-only"
        var encryptionPublicKey = "test-only"
        private(set) var signCount = 0
        func sign(challenge: String) throws -> String {
            signCount += 1
            var raw = Data(repeating: 0, count: 64)
            raw[31] = 1
            raw[63] = 1
            return PCADevicePolicyProofCodec.base64URL(raw)
        }
    }

    private func proofChallenge() -> PCADevicePolicyProofChallenge {
        let zero = PCADevicePolicyProofCodec.base64URL(Data(repeating: 0, count: 32))
        return PCADevicePolicyProofChallenge(challengeId: "00000000-0000-4000-8000-000000000003",
            nonce: zero, familyId: "00000000-0000-4000-8000-000000000001",
            deviceId: "00000000-0000-4000-8000-000000000002", policyEnvelopeMessageId: "policy1",
            policyEnvelopeSha256: zero, trustSetEpoch: 7, keyEpoch: 4, expiresAt: "2026-10-16T12:30:00.000Z")
    }

    private func sharedProofVector() throws -> SharedDevicePolicyProofVector {
        let testFile = URL(fileURLWithPath: #filePath)
        let repositoryRoot = testFile.deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let fixtureURL = repositoryRoot.appendingPathComponent("shared/test-vectors/device-policy-application-proof-v1.json")
        return try JSONDecoder().decode(SharedDevicePolicyProofVector.self, from: Data(contentsOf: fixtureURL))
    }

    private func sharedVectorProofChallenge(
        _ fields: SharedDevicePolicyProofVector.ValidProof.ProofFields
    ) -> PCADevicePolicyProofChallenge {
        PCADevicePolicyProofChallenge(challengeId: fields.challengeId, nonce: fields.challengeNonce,
            familyId: fields.familyId, deviceId: fields.deviceId,
            policyEnvelopeMessageId: fields.policyEnvelopeMessageId,
            policyEnvelopeSha256: fields.policyEnvelopeSha256,
            trustSetEpoch: fields.trustSetEpoch, keyEpoch: fields.keyEpoch,
            expiresAt: fields.challengeExpiresAt)
    }

    private func sharedVectorEnvelope(
        _ fields: SharedDevicePolicyProofVector.CanonicalEnvelope.EnvelopeFields,
        payload: Data? = nil,
        issuedAt: String? = nil
    ) -> PCAInboundEnvelope {
        let encryptedPayload = payload ?? Data(base64Encoded: fields.encryptedPayloadBase64)!
        precondition(fields.recipientKind == "DEVICE")
        return PCAInboundEnvelope(protocolMajor: fields.protocolMajor, protocolMinor: fields.protocolMinor,
            messageId: fields.messageId, familyId: fields.familyId,
            senderDeviceId: fields.senderDeviceId, recipientDeviceId: fields.recipientDeviceId,
            recipientGroup: nil, senderKeyId: fields.senderKeyId,
            messageType: fields.messageType, trustSetEpoch: fields.trustSetEpoch,
            keyEpoch: fields.keyEpoch, sequenceOrNonce: fields.sequenceOrNonce,
            issuedAt: issuedAt ?? fields.issuedAt, expiresAt: fields.expiresAt,
            semanticVersion: fields.semanticVersion, correlationId: fields.correlationId,
            payload: encryptedPayload.base64EncodedString(), signature: "ignored")
    }

    private func policyEnvelope(payload: Data, issuedAt: String = "2026-10-16T12:00:00.000Z") -> PCAInboundEnvelope {
        PCAInboundEnvelope(protocolMajor: 1, protocolMinor: 0, messageId: "policy1",
            familyId: "00000000-0000-4000-8000-000000000001",
            senderDeviceId: "00000000-0000-4000-8000-000000000004", recipientDeviceId: "00000000-0000-4000-8000-000000000002",
            recipientGroup: nil, senderKeyId: "key1", messageType: "POLICY_UPDATE", trustSetEpoch: 7,
            keyEpoch: 4, sequenceOrNonce: "seq1", issuedAt: issuedAt,
            expiresAt: "2026-10-16T13:00:00.000Z", semanticVersion: "1.0.0", correlationId: nil,
            payload: payload.base64EncodedString(), signature: "ignored")
    }
}
