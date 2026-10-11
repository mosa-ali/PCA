import XCTest
import Foundation
@testable import PCA

private final class DeviceSessionTestProof: PCADeviceProofProvider {
    var signingPublicKey = "public-key"
    var encryptionPublicKey = "encryption-key"
    private(set) var signedChallenges: [String] = []
    func sign(challenge: String) throws -> String {
        signedChallenges.append(challenge)
        return "signature"
    }
}

final class PCATests: XCTestCase {
    @MainActor
    func testLaunchShellHasStableAccessibilityLabel() {
        let view = ContentView()
        XCTAssertNotNil(view)
    }

    func testExpiredDeviceSessionChallengeIsRejectedBeforeSigning() async throws {
        let transport = InMemoryPCAHTTPTransport { request in
            XCTAssertTrue(request.url?.path.hasSuffix("/challenge") == true)
            return PCAHTTPResponse(statusCode: 200,
                data: Data(#"{"challengeId":"challenge-1","nonce":"nonce-1","expiresAt":"2000-01-01T00:00:00Z"}"#.utf8))
        }
        let proof = DeviceSessionTestProof()
        let client = try PCADeviceSessionClient(baseURL: URL(string: "https://api.example/")!, transport: transport, proof: proof)

        do {
            _ = try await client.establishSession(deviceId: "device-1")
            XCTFail("expired challenge must not be signed or submitted")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .malformedResponse)
        }
        XCTAssertTrue(proof.signedChallenges.isEmpty)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testBlankOrExpiredDeviceSessionResponseIsRejected() async throws {
        let canonicalToken = String(repeating: "A", count: 43)
        for responseBody in [
            #"{"sessionToken":"","expiresAt":"2099-01-01T00:00:00Z"}"#,
            #"{"sessionToken":"opaque-token","expiresAt":"2099-01-01T00:00:00Z"}"#,
            #"{"sessionToken":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA!","expiresAt":"2099-01-01T00:00:00Z"}"#,
            #"{"sessionToken":"\#(canonicalToken)","expiresAt":"2000-01-01T00:00:00Z"}"#,
        ] {
            let transport = InMemoryPCAHTTPTransport { request in
                if request.url?.path.hasSuffix("/challenge") == true {
                    return PCAHTTPResponse(statusCode: 200,
                        data: Data(#"{"challengeId":"challenge-1","nonce":"nonce-1","expiresAt":"2099-01-01T00:00:00Z"}"#.utf8))
                }
                return PCAHTTPResponse(statusCode: 200, data: Data(responseBody.utf8))
            }
            let client = try PCADeviceSessionClient(baseURL: URL(string: "https://api.example/")!,
                transport: transport, proof: DeviceSessionTestProof())

            do {
                _ = try await client.establishSession(deviceId: "device-1")
                XCTFail("unusable session response must be rejected")
            } catch let error as PCAAPIError {
                XCTAssertEqual(error, .malformedResponse)
            }
            XCTAssertEqual(transport.requests.count, 2)
        }
    }
}
