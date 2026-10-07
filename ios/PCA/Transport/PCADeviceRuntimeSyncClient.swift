import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Opaque protocol identity uses exact UTF-8 bytes, never Swift normalization.
func pcaOpaqueEqual(_ left: String?, _ right: String?) -> Bool {
    switch (left, right) {
    case (nil, nil): return true
    case let (left?, right?): return left.utf8.elementsEqual(right.utf8)
    default: return false
    }
}

public struct PCAInboundScope: Codable, Equatable {
    public let familyId: String
    public let recipientDeviceId: String
    public static func == (left: PCAInboundScope, right: PCAInboundScope) -> Bool {
        pcaOpaqueEqual(left.familyId, right.familyId) &&
        pcaOpaqueEqual(left.recipientDeviceId, right.recipientDeviceId)
    }

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
              pcaOpaqueEqual(familyId, scope.familyId), pcaOpaqueEqual(recipientDeviceId, scope.recipientDeviceId),
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
    public static func == (left: PCAInboundEnvelope, right: PCAInboundEnvelope) -> Bool {
        left.protocolMajor == right.protocolMajor &&
        left.protocolMinor == right.protocolMinor &&
        pcaOpaqueEqual(left.messageId, right.messageId) &&
        pcaOpaqueEqual(left.familyId, right.familyId) &&
        pcaOpaqueEqual(left.senderDeviceId, right.senderDeviceId) &&
        pcaOpaqueEqual(left.recipientDeviceId, right.recipientDeviceId) &&
        pcaOpaqueEqual(left.recipientGroup, right.recipientGroup) &&
        pcaOpaqueEqual(left.senderKeyId, right.senderKeyId) &&
        pcaOpaqueEqual(left.messageType, right.messageType) &&
        left.trustSetEpoch == right.trustSetEpoch &&
        left.keyEpoch == right.keyEpoch &&
        pcaOpaqueEqual(left.sequenceOrNonce, right.sequenceOrNonce) &&
        pcaOpaqueEqual(left.issuedAt, right.issuedAt) &&
        pcaOpaqueEqual(left.expiresAt, right.expiresAt) &&
        pcaOpaqueEqual(left.semanticVersion, right.semanticVersion) &&
        pcaOpaqueEqual(left.correlationId, right.correlationId) &&
        pcaOpaqueEqual(left.payload, right.payload) &&
        pcaOpaqueEqual(left.signature, right.signature)
    }

}

public struct PCAInboundReceipt: Codable, Equatable {
    public enum Outcome: String, Codable { case applied = "APPLIED", heldPending = "HELD_PENDING", rejected = "REJECTED" }
    public let messageId: String
    public let outcome: Outcome
    public let atUtc: String

    func validate() throws {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard !messageId.isEmpty, messageId.utf16.count <= 128,
              let date = formatter.date(from: atUtc), formatter.string(from: date) == atUtc else {
            throw PCAAPIError.malformedResponse
        }
    }
    public static func == (left: PCAInboundReceipt, right: PCAInboundReceipt) -> Bool {
        pcaOpaqueEqual(left.messageId, right.messageId) &&
        left.outcome == right.outcome &&
        pcaOpaqueEqual(left.atUtc, right.atUtc)
    }

}

/// Navigation and admission metadata never authorize decryption, policy application or ACK.
public struct PCAInboundNavigation: Codable, Equatable {
    public let nextCursor: String?
    public let hasMore: Bool
    public let hasUnresolved: Bool
    public let sessionIncarnation: String

    private enum CodingKeys: String, CodingKey { case nextCursor, hasMore, hasUnresolved, sessionIncarnation }
    public init(nextCursor: String?, hasMore: Bool, hasUnresolved: Bool, sessionIncarnation: String) {
        self.nextCursor = nextCursor; self.hasMore = hasMore
        self.hasUnresolved = hasUnresolved; self.sessionIncarnation = sessionIncarnation
    }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard container.contains(.nextCursor) else { throw PCAAPIError.malformedResponse }
        nextCursor = try container.decodeIfPresent(String.self, forKey: .nextCursor)
        hasMore = try container.decode(Bool.self, forKey: .hasMore)
        hasUnresolved = try container.decode(Bool.self, forKey: .hasUnresolved)
        sessionIncarnation = try container.decode(String.self, forKey: .sessionIncarnation)
        try validate()
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let nextCursor { try container.encode(nextCursor, forKey: .nextCursor) }
        else { try container.encodeNil(forKey: .nextCursor) }
        try container.encode(hasMore, forKey: .hasMore)
        try container.encode(hasUnresolved, forKey: .hasUnresolved)
        try container.encode(sessionIncarnation, forKey: .sessionIncarnation)
    }

    func validate() throws {
        guard sessionIncarnation.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil,
              hasMore == (nextCursor != nil) else { throw PCAAPIError.malformedResponse }
        if let nextCursor { try Self.validateCursor(nextCursor) }
    }

    static func validateCursor(_ cursor: String) throws {
        guard !cursor.isEmpty, cursor.utf8.count <= 6144,
              cursor.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else {
            throw PCAAPIError.malformedResponse
        }
    }
}

public enum PCAInboundNavigationError: Error { case invalidCursor }

public struct PCAInboundRuntimeSyncResponse: Decodable, Equatable {
    public let scope: PCAInboundScope
    public let applied: [PCAInboundEnvelope]
    public let unparseableMessageIds: [String]
    public let droppedForListBound: [String]
    /// Bounded-page continuation hint; it affects pending visibility only.
    public let hasMore: Bool
    public let receipts: [PCAInboundReceipt]
    public let navigation: PCAInboundNavigation?

    private enum CodingKeys: String, CodingKey {
        case scope, applied, unparseableMessageIds, droppedForListBound, hasMore
        case receipts, nextCursor, hasUnresolved, sessionIncarnation
    }

    public init(scope: PCAInboundScope, applied: [PCAInboundEnvelope], unparseableMessageIds: [String],
                droppedForListBound: [String], hasMore: Bool? = nil,
                receipts: [PCAInboundReceipt] = [], navigation: PCAInboundNavigation? = nil) {
        self.scope = scope
        self.applied = applied
        self.unparseableMessageIds = unparseableMessageIds
        self.droppedForListBound = droppedForListBound
        self.hasMore = hasMore ?? !droppedForListBound.isEmpty
        self.receipts = receipts
        self.navigation = navigation
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        scope = try container.decode(PCAInboundScope.self, forKey: .scope)
        applied = try container.decode([PCAInboundEnvelope].self, forKey: .applied)
        unparseableMessageIds = try container.decode([String].self, forKey: .unparseableMessageIds)
        droppedForListBound = try container.decode([String].self, forKey: .droppedForListBound)
        if container.contains(.hasMore) {
            // `contains` distinguishes an absent legacy field from explicit
            // null; present values must be actual JSON booleans.
            hasMore = try container.decode(Bool.self, forKey: .hasMore)
        } else {
            hasMore = !droppedForListBound.isEmpty
        }
        receipts = container.contains(.receipts) ? try container.decode([PCAInboundReceipt].self, forKey: .receipts) : []
        // Receipts predate cursor navigation and remain valid on the published legacy server.
        let modern = [.nextCursor, .hasUnresolved, .sessionIncarnation] as [CodingKeys]
        if modern.contains(where: { container.contains($0) }) {
            guard modern.allSatisfy({ container.contains($0) }), container.contains(.receipts), container.contains(.hasMore) else {
                throw PCAAPIError.malformedResponse
            }
            navigation = PCAInboundNavigation(
                nextCursor: try container.decodeIfPresent(String.self, forKey: .nextCursor), hasMore: hasMore,
                hasUnresolved: try container.decode(Bool.self, forKey: .hasUnresolved),
                sessionIncarnation: try container.decode(String.self, forKey: .sessionIncarnation))
            try navigation?.validate()
        } else {
            navigation = nil
        }
        guard !scope.familyId.isEmpty, scope.familyId.utf16.count <= 128,
              !scope.recipientDeviceId.isEmpty, scope.recipientDeviceId.utf16.count <= 128,
              applied.count <= 256, unparseableMessageIds.count <= 100, droppedForListBound.count <= 100,
              (unparseableMessageIds + droppedForListBound).allSatisfy({ !$0.isEmpty && $0.utf16.count <= 128 }),
              receipts.count <= 100, Set(receipts.map { Data($0.messageId.utf8) }).count == receipts.count else {
            throw PCAAPIError.malformedResponse
        }
        for receipt in receipts { try receipt.validate() }
    }
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

    public func pull(session: PCADeviceSession, cursor: String? = nil) async throws -> PCAInboundRuntimeSyncResponse {
        var components = URLComponents(url: baseURL.appendingPathComponent("v1/runtime-sync/inbound"), resolvingAgainstBaseURL: false)
        if let cursor {
            try PCAInboundNavigation.validateCursor(cursor)
            components?.queryItems = [URLQueryItem(name: "cursor", value: cursor)]
        }
        guard let url = components?.url else { throw PCAAPIError.invalidRequest }
        var request = URLRequest(url: url)
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
        catch is CancellationError { throw CancellationError() }
        catch let error as PCAHTTPTransportError { throw PCAAPIError.transport(error) }
        catch { throw PCAAPIError.transport(.network) }
        try Task.checkCancellation()
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
        catch is CancellationError { throw CancellationError() }
        catch let error as PCAHTTPTransportError { throw PCAAPIError.transport(error) }
        catch { throw PCAAPIError.transport(.network) }
        try Task.checkCancellation()
        switch response.statusCode {
        case 200...299: break
        case 401: throw PCAAPIError.unauthorized
        case 400:
            if request.url?.path == baseURL.appendingPathComponent("v1/runtime-sync/inbound").path,
               request.url?.query != nil,
               let body = try? JSONSerialization.jsonObject(with: response.data) as? [String: Any],
               body["error"] as? String == "invalid_cursor" { throw PCAInboundNavigationError.invalidCursor }
            throw PCAAPIError.invalidRequest
        case 404: throw PCAAPIError.unavailable
        case 408, 429, 500...599: throw PCAAPIError.rejected
        default: throw PCAAPIError.rejected
        }
        guard let value = try? decoder.decode(type, from: response.data) else { throw PCAAPIError.malformedResponse }
        return value
    }
}

private struct EmptyPCAResponse: Decodable {}
