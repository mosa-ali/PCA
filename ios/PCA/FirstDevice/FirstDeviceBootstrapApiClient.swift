import Foundation

/// WAVE 6D: client contract for the certified first-device trust-root
/// ceremony endpoints (`backend/src/http/routes/firstDeviceBootstrapRoutes.ts`):
///
///   POST /v1/first-device-bootstrap/challenge -> ceremony/challenge/nonce
///   POST /v1/first-device-bootstrap/submit    -> ACCEPTED (or 409 rejected)
///   POST /v1/first-device-bootstrap/status    -> PENDING|APPROVED|COMMITTED|EXPIRED
///
/// Device authority on every call is the enrollment attempt's
/// (attemptId, attemptRecoveryToken) credential pair ONLY; the server's
/// collapsed vocabulary is preserved, never re-split (404 never
/// distinguishes not-found from not-yet-approved from expired; 409 never
/// reveals a verification cause). Ambiguity is resolved through `status`,
/// never by guessing.
public struct FirstDeviceChallengeResponse: Decodable, Equatable {
    public let ceremonyId: String
    public let challengeId: String
    public let nonce: String
    /// Server ISO timestamp, echoed VERBATIM into the proof bytes (never re-formatted).
    public let expiresAt: String
    public let familyId: String
    public let deviceId: String
}

public struct FirstDeviceSubmitResponse: Decodable, Equatable {
    public let status: String
}

public struct FirstDeviceStatusResponse: Decodable, Equatable {
    /// One of PENDING, APPROVED, COMMITTED, EXPIRED (server vocabulary).
    public let status: String
    /// 'ACCEPTED' only for COMMITTED ceremonies whose outcome is the accepted root.
    public let outcome: String?
}

/// External outcomes of a ceremony call; the backend's collapsed vocabulary
/// is preserved, never re-split.
public enum FirstDeviceBootstrapError: Error, Equatable {
    /// 404 `ceremony_unavailable` -- unknown/expired/not-yet-approved/invalid credential, deliberately indistinguishable.
    case unavailable
    /// 409 `bootstrap_rejected` -- submit verification failed OR the ceremony already committed different bytes. Resolution requires `status`.
    case rejected
    /// 400 `invalid_request` -- our own request shape is malformed (a caller bug, not a user-recoverable state).
    case invalidRequest
    /// No HTTP response at all (timeout/reset) or an unparseable success body -- the true server-side outcome is unknown; resolve via `status`.
    case ambiguousOutcome
    /// Any other status code (e.g. 5xx): a response was received; ordinary transient failure.
    case unexpectedServerError
}

public protocol FirstDeviceBootstrapApiClienting {
    func challenge(
        attemptId: String,
        attemptRecoveryToken: String,
        dskKeyId: String,
        dskPublicKeyBase64: String
    ) async throws -> FirstDeviceChallengeResponse

    func submit(
        attemptId: String,
        attemptRecoveryToken: String,
        ceremonyId: String,
        proofBytes: String,
        proofSignature: String,
        epoch1Bytes: String,
        epoch1Signature: String,
        attestationEvidence: String
    ) async throws -> FirstDeviceSubmitResponse

    func status(attemptId: String, attemptRecoveryToken: String, ceremonyId: String) async throws -> FirstDeviceStatusResponse
}

/// Real HTTP transport over the existing hardened `PCAHTTPTransport`.
/// No credential, key, proof byte, signature or evidence string is ever
/// logged anywhere in this file (grep-provable: no print/Logger call).
public struct FirstDeviceBootstrapApiClient: FirstDeviceBootstrapApiClienting {
    private let baseURL: URL
    private let transport: PCAHTTPTransport
    private let decoder = JSONDecoder()

    public init(baseURL: URL, transport: PCAHTTPTransport) throws {
        guard baseURL.scheme?.lowercased() == "https" else { throw PCAAPIError.invalidConfiguration }
        self.baseURL = baseURL
        self.transport = transport
    }

    public func challenge(
        attemptId: String,
        attemptRecoveryToken: String,
        dskKeyId: String,
        dskPublicKeyBase64: String
    ) async throws -> FirstDeviceChallengeResponse {
        let body: [String: Any] = [
            "attemptId": attemptId,
            "attemptRecoveryToken": attemptRecoveryToken,
            "dskKeyId": dskKeyId,
            "dskPublicKey": dskPublicKeyBase64,
        ]
        return try await post(path: "v1/first-device-bootstrap/challenge", body: body, as: FirstDeviceChallengeResponse.self)
    }

    public func submit(
        attemptId: String,
        attemptRecoveryToken: String,
        ceremonyId: String,
        proofBytes: String,
        proofSignature: String,
        epoch1Bytes: String,
        epoch1Signature: String,
        attestationEvidence: String
    ) async throws -> FirstDeviceSubmitResponse {
        let body: [String: Any] = [
            "attemptId": attemptId,
            "attemptRecoveryToken": attemptRecoveryToken,
            "ceremonyId": ceremonyId,
            "proofBytes": proofBytes,
            "proofSignature": proofSignature,
            "epoch1Bytes": epoch1Bytes,
            "epoch1Signature": epoch1Signature,
            "attestationEvidence": attestationEvidence,
        ]
        return try await post(path: "v1/first-device-bootstrap/submit", body: body, as: FirstDeviceSubmitResponse.self)
    }

    public func status(attemptId: String, attemptRecoveryToken: String, ceremonyId: String) async throws -> FirstDeviceStatusResponse {
        let body: [String: Any] = [
            "attemptId": attemptId,
            "attemptRecoveryToken": attemptRecoveryToken,
            "ceremonyId": ceremonyId,
        ]
        return try await post(path: "v1/first-device-bootstrap/status", body: body, as: FirstDeviceStatusResponse.self)
    }

    private func post<T: Decodable>(path: String, body: [String: Any], as type: T.Type) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = (try? JSONSerialization.data(withJSONObject: body)) ?? Data()

        let response: PCAHTTPResponse
        do {
            response = try await transport.send(request)
        } catch {
            // No HTTP response at all: the true server-side outcome is unknown.
            throw FirstDeviceBootstrapError.ambiguousOutcome
        }
        switch response.statusCode {
        case 200...299:
            guard let value = try? decoder.decode(type, from: response.data) else {
                throw FirstDeviceBootstrapError.ambiguousOutcome
            }
            return value
        case 400: throw FirstDeviceBootstrapError.invalidRequest
        case 404: throw FirstDeviceBootstrapError.unavailable
        case 409: throw FirstDeviceBootstrapError.rejected
        default: throw FirstDeviceBootstrapError.unexpectedServerError
        }
    }
}
