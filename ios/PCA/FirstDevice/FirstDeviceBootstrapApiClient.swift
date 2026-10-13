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
    private enum SuccessShape { case challenge, submit, status }

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
        return try await post(path: "v1/first-device-bootstrap/challenge", body: body,
                              shape: .challenge, as: FirstDeviceChallengeResponse.self)
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
        return try await post(path: "v1/first-device-bootstrap/submit", body: body,
                              shape: .submit, as: FirstDeviceSubmitResponse.self)
    }

    public func status(attemptId: String, attemptRecoveryToken: String, ceremonyId: String) async throws -> FirstDeviceStatusResponse {
        let body: [String: Any] = [
            "attemptId": attemptId,
            "attemptRecoveryToken": attemptRecoveryToken,
            "ceremonyId": ceremonyId,
        ]
        return try await post(path: "v1/first-device-bootstrap/status", body: body,
                              shape: .status, as: FirstDeviceStatusResponse.self)
    }

    private func post<T: Decodable>(path: String, body: [String: Any], shape: SuccessShape, as type: T.Type) async throws -> T {
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
            do {
                try validate(response.data, shape: shape)
                return try decoder.decode(type, from: response.data)
            } catch {
                // A malformed success response leaves the server-side result
                // ambiguous. Never infer a ceremony state from a partial or
                // parser-differential DTO.
                throw FirstDeviceBootstrapError.ambiguousOutcome
            }
        case 400: throw FirstDeviceBootstrapError.invalidRequest
        case 404: throw FirstDeviceBootstrapError.unavailable
        case 409: throw FirstDeviceBootstrapError.rejected
        default: throw FirstDeviceBootstrapError.unexpectedServerError
        }
    }

    private func validate(_ data: Data, shape: SuccessShape) throws {
        let objectShape = try StrictJSONDocument.parse(data, maximumBytes: 1_048_576)
        guard case .object = objectShape,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw FirstDeviceBootstrapError.ambiguousOutcome
        }

        func requireKeys(_ expected: Set<String>) throws {
            guard Set(object.keys) == expected else { throw FirstDeviceBootstrapError.ambiguousOutcome }
        }
        func requireString(_ key: String) throws -> String {
            guard let value = object[key] as? String else { throw FirstDeviceBootstrapError.ambiguousOutcome }
            return value
        }

        switch shape {
        case .challenge:
            try requireKeys(["status", "ceremonyId", "challengeId", "nonce", "expiresAt", "familyId", "deviceId"])
            guard try requireString("status") == "PENDING" else { throw FirstDeviceBootstrapError.ambiguousOutcome }
            let ceremonyId = try requireString("ceremonyId")
            let challengeId = try requireString("challengeId")
            let nonce = try requireString("nonce")
            let expiresAt = try requireString("expiresAt")
            let familyId = try requireString("familyId")
            let deviceId = try requireString("deviceId")
            let opaqueUuidPattern = #"^[A-Za-z0-9-]{36}$"#
            guard ceremonyId.range(of: opaqueUuidPattern, options: .regularExpression) != nil,
                  challengeId.range(of: opaqueUuidPattern, options: .regularExpression) != nil,
                  deviceId.range(of: opaqueUuidPattern, options: .regularExpression) != nil,
                  (1...128).contains(familyId.utf8.count),
                  Self.isCanonicalChallengeNonce(nonce),
                  Self.isCanonicalChallengeTimestamp(expiresAt) else {
                throw FirstDeviceBootstrapError.ambiguousOutcome
            }
        case .submit:
            try requireKeys(["status"])
            guard try requireString("status") == "ACCEPTED" else { throw FirstDeviceBootstrapError.ambiguousOutcome }
        case .status:
            try requireKeys(["status", "outcome"])
            let status = try requireString("status")
            guard let outcome = object["outcome"] else { throw FirstDeviceBootstrapError.ambiguousOutcome }
            switch status {
            case "PENDING", "APPROVED", "EXPIRED":
                guard outcome is NSNull else { throw FirstDeviceBootstrapError.ambiguousOutcome }
            case "COMMITTED":
                guard outcome is NSNull || (outcome as? String) == "ACCEPTED" else {
                    throw FirstDeviceBootstrapError.ambiguousOutcome
                }
            default:
                throw FirstDeviceBootstrapError.ambiguousOutcome
            }
        }
    }

    private static func isCanonicalChallengeNonce(_ value: String) -> Bool {
        guard value.utf8.count == 43,
              value.utf8.allSatisfy({
                  ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) ||
                  ($0 >= 48 && $0 <= 57) || $0 == 45 || $0 == 95
              }) else { return false }
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += "="
        guard let data = Data(base64Encoded: base64), data.count == 32 else { return false }
        return FirstDeviceCanonical.base64Url(data) == value
    }

    private static func isCanonicalChallengeTimestamp(_ value: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value) else { return false }
        return formatter.string(from: date) == value
    }
}
