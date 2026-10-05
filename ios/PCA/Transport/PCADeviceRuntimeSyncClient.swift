import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct PCAInboundScope: Codable, Equatable {
    public let familyId: String
    public let recipientDeviceId: String
}

public struct PCAInboundEnvelope: Codable, Equatable {
    public let protocolMajor: Int
    public let protocolMinor: Int
    public let messageId: String
    public let familyId: String
    public let senderDeviceId: String
    public let recipientDeviceId: String?
    public let recipientGroup: String?
    public let senderKeyId: String
    public let messageType: String
    public let trustSetEpoch: Int
    public let keyEpoch: Int
    public let sequenceOrNonce: String
    public let issuedAt: String
    public let expiresAt: String
    public let semanticVersion: String
    public let correlationId: String?
    public let payload: String
    public let signature: String

    /// Structural custody validation only; no signature/decryption/OS authority.
    func validate(scope: PCAInboundScope) throws {
        let ids = [messageId, familyId, senderDeviceId, senderKeyId, sequenceOrNonce]
        guard ids.allSatisfy({ !$0.isEmpty && $0.utf16.count <= 128 }),
              familyId == scope.familyId, recipientDeviceId == scope.recipientDeviceId,
              recipientGroup == nil, protocolMajor == 1, protocolMinor >= 0, protocolMinor <= Int(Int32.max),
              trustSetEpoch >= 0, trustSetEpoch <= Int(Int32.max), keyEpoch >= 0, keyEpoch <= Int(Int32.max),
              !signature.isEmpty, signature.utf16.count <= 512,
              semanticVersion.utf16.count <= 32,
              semanticVersion.range(of: #"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$"#, options: .regularExpression) != nil,
              Self.messageTypes.contains(messageType),
              let bytes = Data(base64Encoded: payload), bytes.count > 0, bytes.count <= 65536,
              bytes.base64EncodedString() == payload else { throw PCAInboundInboxError.unavailable }
        if let correlationId {
            guard !correlationId.isEmpty, correlationId.utf16.count <= 128 else { throw PCAInboundInboxError.unavailable }
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let issued = formatter.date(from: issuedAt), let expires = formatter.date(from: expiresAt),
              formatter.string(from: issued) == issuedAt, formatter.string(from: expires) == expiresAt,
              expires > issued else { throw PCAInboundInboxError.unavailable }
    }

    private static let messageTypes: Set<String> = ["POLICY_UPDATE", "POLICY_RECEIPT", "STATUS_SNAPSHOT", "ACTIVITY_SUMMARY",
        "LOCATION_RESPONSE", "CHILD_REQUEST", "PARENT_DECISION", "TAMPER_ALERT", "RETENTION_DELETION_INSTRUCTION",
        "RETENTION_RECEIPT", "FTS_UPDATE", "KEY_ROTATION", "DEVICE_REVOKE", "RECOVERY_TRANSACTION", "SIGNED_ROLLBACK"]
}

public struct PCAInboundRuntimeSyncResponse: Decodable, Equatable {
    public let scope: PCAInboundScope
    public let applied: [PCAInboundEnvelope]
    public let unparseableMessageIds: [String]
    public let droppedForListBound: [String]
}

public enum PCAReportedProtectionLevel: String, Encodable {
    case standard = "STANDARD"
    case protected = "PROTECTED"
    case degraded = "DEGRADED"
    case authorizationRequired = "AUTHORIZATION_REQUIRED"
    case notSupported = "NOT_SUPPORTED"
}

/// Device-session-authenticated runtime-sync adapter. It deliberately stops
/// at receipt/application input: encrypted payload verification/decryption
/// remains the approved crypto layer's responsibility, and a received item
/// is never reported as an applied policy by this transport.
public final class PCADeviceRuntimeSyncClient {
    private let baseURL: URL
    private let transport: PCAHTTPTransport
    private let decoder = JSONDecoder()

    public init(baseURL: URL, transport: PCAHTTPTransport) throws {
        guard baseURL.scheme?.lowercased() == "https" else { throw PCAAPIError.invalidConfiguration }
        self.baseURL = baseURL
        self.transport = transport
    }

    public func pull(session: PCADeviceSession) async throws -> PCAInboundRuntimeSyncResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("v1/runtime-sync/inbound"))
        request.httpMethod = "GET"
        request.setValue("Bearer \(session.sessionToken)", forHTTPHeaderField: "Authorization")
        return try await send(request, decodeAs: PCAInboundRuntimeSyncResponse.self)
    }

    public func acknowledge(messageId: String, session: PCADeviceSession) async throws {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%."))
        guard let component = messageId.addingPercentEncoding(withAllowedCharacters: allowed),
              let url = URL(string: baseURL.appendingPathComponent("v1/runtime-sync/inbound").absoluteString + "/" + component + "/ack") else {
            throw PCAAPIError.invalidRequest
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(session.sessionToken)", forHTTPHeaderField: "Authorization")
        _ = try await send(request, decodeAs: EmptyPCAResponse.self)
    }

    /// Reports the host's observed protection state to the existing backend
    /// reconciliation route. This is deliberately a separate operation from
    /// pulling inbound envelopes: transport receipt never becomes a claim of
    /// local enforcement.
    public func reportProtectionStatus(_ status: PCAProtectionStatus, session: PCADeviceSession) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("v1/runtime-sync/protection-status"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(session.sessionToken)", forHTTPHeaderField: "Authorization")
        let level: PCAReportedProtectionLevel
        switch status {
        case .active: level = .protected
        case .degraded: level = .degraded
        case .notReady: level = .standard
        }
        request.httpBody = try JSONEncoder().encode(["protectionLevel": level.rawValue])
        let response: PCAHTTPResponse
        do { response = try await transport.send(request) }
        catch let error as PCAHTTPTransportError { throw PCAAPIError.transport(error) }
        catch { throw PCAAPIError.transport(.network) }
        switch response.statusCode {
        case 200...299: return
        case 401: throw PCAAPIError.unauthorized
        case 400: throw PCAAPIError.invalidRequest
        case 404: throw PCAAPIError.unavailable
        case 408, 429, 500...599: throw PCAAPIError.rejected
        default: throw PCAAPIError.rejected
        }
    }

    private func send<T: Decodable>(_ request: URLRequest, decodeAs type: T.Type) async throws -> T {
        let response: PCAHTTPResponse
        do { response = try await transport.send(request) }
        catch let error as PCAHTTPTransportError { throw PCAAPIError.transport(error) }
        catch { throw PCAAPIError.transport(.network) }
        switch response.statusCode {
        case 200...299: break
        case 401: throw PCAAPIError.unauthorized
        case 400: throw PCAAPIError.invalidRequest
        case 404: throw PCAAPIError.unavailable
        case 408, 429, 500...599: throw PCAAPIError.rejected
        default: throw PCAAPIError.rejected
        }
        guard let value = try? decoder.decode(type, from: response.data) else { throw PCAAPIError.malformedResponse }
        return value
    }
}

private struct EmptyPCAResponse: Decodable {}
