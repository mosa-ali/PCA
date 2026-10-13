import Foundation
import XCTest
@testable import PCA

final class FirstDeviceBootstrapChallengeValidationTests: XCTestCase {
    private struct FixedResponseTransport: PCAHTTPTransport {
        let body: String
        func send(_ request: URLRequest) async throws -> PCAHTTPResponse {
            PCAHTTPResponse(statusCode: 200, data: Data(body.utf8))
        }
    }

    private func client(_ body: String) throws -> FirstDeviceBootstrapApiClient {
        try FirstDeviceBootstrapApiClient(
            baseURL: URL(string: "https://api.example.test")!,
            transport: FixedResponseTransport(body: body)
        )
    }

    private func challengeJSON(ceremonyId: String = "11111111-1111-4111-8111-111111111111",
                               challengeId: String = "22222222-2222-4222-8222-222222222222",
                               nonce: String = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                               expiresAt: String = "2030-01-01T00:00:00.000Z",
                               familyId: String = "family-1",
                               deviceId: String = "33333333-3333-4333-8333-333333333333") -> String {
        let values = [ceremonyId, challengeId, nonce, expiresAt, familyId, deviceId]
        let keys = ["ceremonyId", "challengeId", "nonce", "expiresAt", "familyId", "deviceId"]
        let fields = Dictionary(uniqueKeysWithValues: zip(keys, values))
        let data = try! JSONSerialization.data(withJSONObject: ["status": "PENDING"].merging(fields) { _, new in new },
            options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

    private func fetch(_ body: String) async throws -> FirstDeviceChallengeResponse {
        try await client(body).challenge(
            attemptId: "attempt-0000000000000000",
            attemptRecoveryToken: "recovery-token",
            dskKeyId: "44444444-4444-4444-8444-444444444444",
            dskPublicKeyBase64: "public-key"
        )
    }

    func testAcceptsBackendShapedChallengeAndPreservesExactFields() async throws {
        let response = try await fetch(challengeJSON())
        XCTAssertEqual(response.ceremonyId, "11111111-1111-4111-8111-111111111111")
        XCTAssertEqual(response.challengeId, "22222222-2222-4222-8222-222222222222")
        XCTAssertEqual(response.nonce, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        XCTAssertEqual(response.expiresAt, "2030-01-01T00:00:00.000Z")
        XCTAssertEqual(response.familyId, "family-1")
        XCTAssertEqual(response.deviceId, "33333333-3333-4333-8333-333333333333")
    }

    func testMalformedChallengeBindingsRemainAmbiguousAndFailClosed() async throws {
        let invalidBodies = [
            challengeJSON(ceremonyId: "ceremony"),
            challengeJSON(challengeId: "challenge"),
            challengeJSON(nonce: "short"),
            challengeJSON(nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA!"),
            challengeJSON(nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB"),
            challengeJSON(expiresAt: "2030-01-01T00:00:00Z"),
            challengeJSON(expiresAt: "2030-01-01T01:00:00.000+01:00"),
            challengeJSON(familyId: ""),
            challengeJSON(familyId: String(repeating: "f", count: 129)),
            challengeJSON(deviceId: "device"),
        ]

        for body in invalidBodies {
            do {
                _ = try await fetch(body)
                XCTFail("malformed challenge binding must be ambiguous and rejected")
            } catch let error as FirstDeviceBootstrapError {
                XCTAssertEqual(error, .ambiguousOutcome)
            }
        }
    }
}
