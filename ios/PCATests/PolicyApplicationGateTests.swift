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
        let challenge = sharedVectorProofChallenge()
        let transcript = try PCADevicePolicyProofCodec.encode(challenge, result: .applied)
        XCTAssertEqual(PCADevicePolicyProofCodec.base64URL(transcript),
            "Mzg6UENBX0RFVklDRV9QT0xJQ1lfQVBQTElDQVRJT05fUFJPT0ZfVjEzNjoyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIzNjo0NDQ0NDQ0NC00NDQ0LTQ0NDQtODQ0NC00NDQ0NDQ0NDQ0NDQzNjoxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTE0MzpNcDZkOFJqc2NrWVJ5ZGZPLU1IWmR1bWEydnl5clRqc0FGMFlBbEhjRHVjMTo3MTo5NzpBUFBMSUVEMzY6NjY2NjY2NjYtNjY2Ni00NjY2LTg2NjYtNjY2NjY2NjY2NjY2NDM6b0tHaW82U2xwcWVvcWFxcnJLMnVyN0N4c3JPMHRiYTN1TG02dTd5OXZyODI0OjIwMjYtMTAtMTVUMDA6NTY6MDAuMDAwWg")
        XCTAssertLessThanOrEqual(transcript.count, PCADevicePolicyProofCodec.maximumTranscriptBytes)
    }

    func testSharedVectorSignatureVerifiesWithSyntheticDsk() throws {
        let transcript = try PCADevicePolicyProofCodec.encode(sharedVectorProofChallenge(), result: .applied)
        let publicKeyBytes = try XCTUnwrap(PCADevicePolicyProofCodec.decodeCanonicalBase64URL(
            "BEo3oAxgCztM8rd02sbHbuD_vdgAnjsGov_ou4xgVbZhoxiVVghyV_ugsENG3RI_K85pHV-wLnNB2FETA83c_lM"))
        let signatureBytes = try XCTUnwrap(PCADevicePolicyProofCodec.decodeCanonicalBase64URL(
            "qOnaqSm9irglYluuawYON6vfK8kTt75IaYXslvmTXHsIitr620VP4ZsvKSlZBHwRtWKuGP7HW3wDhT2O7ShJiw"))
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
        let envelope = sharedVectorEnvelope()
        let bytes = try PCADevicePolicyEnvelopeCanonicalizer.canonicalBytes(envelope)
        XCTAssertEqual(PCADevicePolicyProofCodec.base64URL(bytes),
            "MToxMTowMzY6MTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExMzY6MjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyMzY6MzMzMzMzMzMtMzMzMy00MzMzLTgzMzMtMzMzMzMzMzMzMzMzNjpERVZJQ0UzNjo0NDQ0NDQ0NC00NDQ0LTQ0NDQtODQ0NC00NDQ0NDQ0NDQ0NDQzNjo1NTU1NTU1NS01NTU1LTQ1NTUtODU1NS01NTU1NTU1NTU1NTUxMzpQT0xJQ1lfVVBEQVRFMToxMjQ6MjAyNi0xMC0xNVQwMDo1NTowMC4wMDBaMjQ6MjAyNi0xMC0xNVQwMTo1NTowMC4wMDBaMTo3MTo5NToxLjIuMzE6MDA6MjQ6QUJFaU0wUlZabmVJbWFxN3pOM3Uvdz09")
        XCTAssertEqual(PCADevicePolicyProofCodec.base64URL(try PCADevicePolicyEnvelopeCanonicalizer.sha256(bytes)),
            "Mp6d8RjsckYRydfO-MHZduma2vyyrTjsAF0YAlHcDuc")
        XCTAssertNotEqual(bytes, try PCADevicePolicyEnvelopeCanonicalizer.canonicalBytes(sharedVectorEnvelope(
            payload: Data([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
                0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xfe]))))
        XCTAssertLessThanOrEqual(bytes.count, PCADevicePolicyEnvelopeCanonicalizer.maximumCanonicalBytes)
        XCTAssertThrowsError(try PCADevicePolicyEnvelopeCanonicalizer.canonicalBytes(
            sharedVectorEnvelope(issuedAt: "2026-10-15T03:55:00.000+03:00")
        ))
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
        let capability = PCADevicePolicyProofCodec.base64URL(Data(repeating: 2, count: 32))
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
                    "activationCapability": capability, "policyEnvelopeMessageId": "policy1",
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
        let target = try await client.fetch(familyId: envelope.familyId, deviceId: envelope.recipientDeviceId!, capability: response)
        XCTAssertEqual(try target.canonicalBytes(), canonical)
        XCTAssertEqual(response.proofChallenge.familyId, envelope.familyId)
        let proof = try PCADevicePolicyProofCodec.proof(challenge: response.proofChallenge, result: .applied,
            dsk: TestProofSigner(), now: now)
        let submitResult = try await client.submit(proof)
        XCTAssertEqual(submitResult, PCADevicePolicyApplicationProofResponse(outcome: .activated, idempotent: false))
        let recoveredResult = try await client.recoverExactProof(proof)
        XCTAssertEqual(recoveredResult, PCADevicePolicyApplicationProofResponse(outcome: .activated, idempotent: true))
        XCTAssertEqual(paths, ["/v1/device-policy-activation/bootstrap/challenge",
            "/v1/device-policy-activation/bootstrap/complete", "/v1/device-policy-activation/bootstrap/fetch",
            "/v1/device-policy-activation/proof", "/v1/device-policy-activation/proof/status"])
        XCTAssertTrue(transport.requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil })
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

    private func sharedVectorProofChallenge() -> PCADevicePolicyProofChallenge {
        PCADevicePolicyProofChallenge(challengeId: "66666666-6666-4666-8666-666666666666",
            nonce: "oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8",
            familyId: "22222222-2222-4222-8222-222222222222",
            deviceId: "44444444-4444-4444-8444-444444444444",
            policyEnvelopeMessageId: "11111111-1111-4111-8111-111111111111",
            policyEnvelopeSha256: "Mp6d8RjsckYRydfO-MHZduma2vyyrTjsAF0YAlHcDuc",
            trustSetEpoch: 7, keyEpoch: 9, expiresAt: "2026-10-15T00:56:00.000Z")
    }

    private func sharedVectorEnvelope(payload: Data = Data([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
        0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]),
        issuedAt: String = "2026-10-15T00:55:00.000Z") -> PCAInboundEnvelope {
        PCAInboundEnvelope(protocolMajor: 1, protocolMinor: 0,
            messageId: "11111111-1111-4111-8111-111111111111",
            familyId: "22222222-2222-4222-8222-222222222222",
            senderDeviceId: "33333333-3333-4333-8333-333333333333",
            recipientDeviceId: "44444444-4444-4444-8444-444444444444",
            recipientGroup: nil, senderKeyId: "55555555-5555-4555-8555-555555555555",
            messageType: "POLICY_UPDATE", trustSetEpoch: 7, keyEpoch: 9, sequenceOrNonce: "1",
            issuedAt: issuedAt, expiresAt: "2026-10-15T01:55:00.000Z", semanticVersion: "1.2.3",
            correlationId: nil, payload: payload.base64EncodedString(), signature: "ignored")
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
