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
              recipientGroup == nil, protocolMajor == 1, protocolMinor >= 0,
              protocolMinor <= Self.maximumSafeProtocolInteger,
              trustSetEpoch >= 0, trustSetEpoch <= Int(Int32.max), keyEpoch >= 0, keyEpoch <= Int(Int32.max),
              !signature.isEmpty, signature.utf16.count <= 512,
              semanticVersion.utf16.count <= 32,
              semanticVersion.range(of: #"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$"#, options: .regularExpression) != nil,
              Self.messageTypes.contains(messageType),
              let bytes = Data(base64Encoded: payload), bytes.count > 0, bytes.count <= 65536,
              bytes.base64EncodedString() == payload else { throw PCAInboundInboxError.unavailable }
        guard let encodedEnvelope = try? JSONEncoder().encode(self),
              var wireObject = try? JSONSerialization.jsonObject(with: encodedEnvelope) as? [String: Any] else {
            throw PCAInboundInboxError.unavailable
        }
        // The backend's RawFamilyEnvelope serializer emits correlationId as
        // explicit null when absent. Match that complete wire shape when
        // enforcing the shared relay ciphertext ceiling.
        if correlationId == nil { wireObject["correlationId"] = NSNull() }
        guard let completeWireBytes = try? JSONSerialization.data(withJSONObject: wireObject, options: [.withoutEscapingSlashes]),
              completeWireBytes.count <= Self.maximumWireEnvelopeBytes else {
            throw PCAInboundInboxError.unavailable
        }
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
    private static let maximumSafeProtocolInteger = 9_007_199_254_740_991
    private static let maximumWireEnvelopeBytes = 64 * 1024
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

// MARK: - PAIRED activation bootstrap and application-proof transport

public struct PCADevicePolicyBootstrapChallenge: Decodable, Equatable {
    public let challengeId: String
    public let nonce: String
    public let expiresAt: String
}

public struct PCADevicePolicyActivationCapability: Equatable {
    public let challengeId: String
    public let nonce: String
    public let expiresAt: String
    public let activationCapability: String
    public let policyEnvelopeMessageId: String
    public let policyEnvelopeSha256: String
    public let trustSetEpoch: Int
    public let keyEpoch: Int

    public var proofChallenge: PCADevicePolicyProofChallenge {
        PCADevicePolicyProofChallenge(challengeId: challengeId, nonce: nonce,
            familyId: familyId, deviceId: deviceId, policyEnvelopeMessageId: policyEnvelopeMessageId,
            policyEnvelopeSha256: policyEnvelopeSha256, trustSetEpoch: trustSetEpoch,
            keyEpoch: keyEpoch, expiresAt: expiresAt)
    }

    public let familyId: String
    public let deviceId: String

    fileprivate init(response: PCADevicePolicyActivationCapabilityResponse, familyId: String, deviceId: String) {
        challengeId = response.challengeId; nonce = response.nonce; expiresAt = response.expiresAt
        activationCapability = response.activationCapability; policyEnvelopeMessageId = response.policyEnvelopeMessageId
        policyEnvelopeSha256 = response.policyEnvelopeSha256; trustSetEpoch = response.trustSetEpoch
        keyEpoch = response.keyEpoch; self.familyId = familyId; self.deviceId = deviceId
    }
}

private struct PCADevicePolicyActivationCapabilityResponse: Decodable {
    let challengeId: String
    let nonce: String
    let expiresAt: String
    let activationCapability: String
    let policyEnvelopeMessageId: String
    let policyEnvelopeSha256: String
    let trustSetEpoch: Int
    let keyEpoch: Int
}

public struct PCADevicePolicyActivationTarget: Decodable, Equatable {
    public let challengeId: String
    public let policyEnvelopeMessageId: String
    public let policyEnvelopeSha256: String
    public let canonicalEnvelopeBytes: String
    public let envelopeSignature: String
    public let trustSetEpoch: Int
    public let keyEpoch: Int

    /// Exact canonical bytes signed by the sender and hashed by the proof.
    public func canonicalBytes() throws -> Data {
        guard let bytes = PCADevicePolicyProofCodec.decodeCanonicalBase64URL(canonicalEnvelopeBytes),
              !bytes.isEmpty, bytes.count <= PCADevicePolicyEnvelopeCanonicalizer.maximumCanonicalBytes,
              PCADevicePolicyProofCodec.canonicalBase64URL32(policyEnvelopeSha256),
              !envelopeSignature.isEmpty, envelopeSignature.utf8.count <= 512,
              (1...Int(Int32.max)).contains(trustSetEpoch),
              (1...Int(Int32.max)).contains(keyEpoch),
              !policyEnvelopeMessageId.isEmpty, policyEnvelopeMessageId.utf8.count <= 512 else {
            throw PCAAPIError.malformedResponse
        }
        guard try PCADevicePolicyProofCodec.base64URL(PCADevicePolicyEnvelopeCanonicalizer.sha256(bytes)) == policyEnvelopeSha256 else {
            throw PCAAPIError.malformedResponse
        }
        return bytes
    }
}

public struct PCADevicePolicyApplicationProofResponse: Decodable, Equatable {
    public enum Outcome: String, Decodable { case activated = "ACTIVATED", recordedNotActivated = "RECORDED_NOT_ACTIVATED" }
    public let outcome: Outcome
    public let idempotent: Bool
}

private struct PCADevicePolicyApplicationProofRequest: Encodable {
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
    let signature: String

    init(_ proof: PCADeviceApplicationProof) {
        familyId = proof.challenge.familyId
        deviceId = proof.challenge.deviceId
        policyEnvelopeMessageId = proof.challenge.policyEnvelopeMessageId
        policyEnvelopeSha256 = proof.challenge.policyEnvelopeSha256
        trustSetEpoch = proof.challenge.trustSetEpoch
        keyEpoch = proof.challenge.keyEpoch
        applicationResult = proof.result.rawValue
        challengeId = proof.challenge.challengeId
        challengeNonce = proof.challenge.nonce
        challengeExpiresAt = proof.challenge.expiresAt
        signature = PCADevicePolicyProofCodec.base64URL(proof.signature)
    }
}

/// Device-scoped unauthenticated bootstrap: authorization comes only from the
/// server's one-use capability and the DSK proof. This adapter never creates
/// an ACTIVE session or invokes general relay endpoints.
public final class PCADevicePolicyActivationClient {
    private let baseURL: URL
    private let transport: PCAHTTPTransport
    private let now: () -> Date
    private let decoder = JSONDecoder()
    private let maximumResponseBytes = 136 * 1024

    public init(baseURL: URL, transport: PCAHTTPTransport, now: @escaping () -> Date = Date.init) throws {
        guard baseURL.scheme?.lowercased() == "https", baseURL.host != nil,
              baseURL.user == nil, baseURL.password == nil, baseURL.query == nil,
              baseURL.fragment == nil, baseURL.path.isEmpty || baseURL.path == "/" else {
            throw PCAAPIError.invalidConfiguration
        }
        self.baseURL = baseURL; self.transport = transport; self.now = now
    }

    public func challenge(familyId: String, deviceId: String) async throws -> PCADevicePolicyBootstrapChallenge {
        try Self.validateIdentity(familyId, deviceId)
        let response: PCADevicePolicyBootstrapChallenge = try await post("v1/device-policy-activation/bootstrap/challenge",
            body: ["familyId": familyId, "deviceId": deviceId], as: PCADevicePolicyBootstrapChallenge.self)
        try validateChallenge(response.challengeId, nonce: response.nonce, expiresAt: response.expiresAt)
        return response
    }

    /// `signature` is the current-device DSK signature over the UTF-8 bytes of
    /// the canonical base64url nonce, as required by the bootstrap verifier.
    public func complete(familyId: String, deviceId: String,
                         challenge: PCADevicePolicyBootstrapChallenge,
                         signature: String) async throws -> PCADevicePolicyActivationCapability {
        try Self.validateIdentity(familyId, deviceId)
        try validateChallenge(challenge.challengeId, nonce: challenge.nonce, expiresAt: challenge.expiresAt)
        guard Self.canonicalSignature(signature) else { throw PCAAPIError.invalidRequest }
        let body = ["familyId": familyId, "deviceId": deviceId, "challengeId": challenge.challengeId,
                    "nonce": challenge.nonce, "signature": signature]
        let response: PCADevicePolicyActivationCapabilityResponse = try await post(
            "v1/device-policy-activation/bootstrap/complete", body: body, as: PCADevicePolicyActivationCapabilityResponse.self)
        guard (try? validateChallenge(response.challengeId, nonce: response.nonce, expiresAt: response.expiresAt)) != nil,
              PCADevicePolicyProofCodec.canonicalBase64URL32(response.activationCapability),
              PCADevicePolicyProofCodec.canonicalBase64URL32(response.policyEnvelopeSha256),
              !response.policyEnvelopeMessageId.isEmpty, response.policyEnvelopeMessageId.utf8.count <= 512,
              (1...Int(Int32.max)).contains(response.trustSetEpoch),
              (1...Int(Int32.max)).contains(response.keyEpoch) else { throw PCAAPIError.malformedResponse }
        return PCADevicePolicyActivationCapability(response: response, familyId: familyId, deviceId: deviceId)
    }

    public func fetch(familyId: String, deviceId: String,
                      capability: PCADevicePolicyActivationCapability) async throws -> PCADevicePolicyActivationTarget {
        try Self.validateIdentity(familyId, deviceId)
        let body = ["familyId": familyId, "deviceId": deviceId, "activationCapability": capability.activationCapability]
        let target: PCADevicePolicyActivationTarget = try await post(
            "v1/device-policy-activation/bootstrap/fetch", body: body, as: PCADevicePolicyActivationTarget.self)
        guard target.challengeId == capability.challengeId,
              target.policyEnvelopeMessageId == capability.policyEnvelopeMessageId,
              target.policyEnvelopeSha256 == capability.policyEnvelopeSha256,
              target.trustSetEpoch == capability.trustSetEpoch, target.keyEpoch == capability.keyEpoch else {
            throw PCAAPIError.malformedResponse
        }
        _ = try target.canonicalBytes()
        return target
    }

    public func submit(_ proof: PCADeviceApplicationProof) async throws -> PCADevicePolicyApplicationProofResponse {
        guard proof.transcript == (try PCADevicePolicyProofCodec.encode(proof.challenge, result: proof.result)),
              proof.signature.count == 64, P256DerSignature.isLowS(proof.signature) else {
            throw PCAAPIError.invalidRequest
        }
        return try await post("v1/device-policy-activation/proof", body: PCADevicePolicyApplicationProofRequest(proof),
                              as: PCADevicePolicyApplicationProofResponse.self)
    }

    public func recoverExactProof(_ proof: PCADeviceApplicationProof) async throws -> PCADevicePolicyApplicationProofResponse {
        let body = ["challengeId": proof.challenge.challengeId,
                    "exactRequestSha256": try proof.exactRequestSha256()]
        return try await post("v1/device-policy-activation/proof/status", body: body,
                              as: PCADevicePolicyApplicationProofResponse.self)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B, as type: T.Type) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let response: PCAHTTPResponse
        do { response = try await transport.send(request) }
        catch is CancellationError { throw CancellationError() }
        catch let error as PCAHTTPTransportError { throw PCAAPIError.transport(error) }
        catch { throw PCAAPIError.transport(.network) }
        try Task.checkCancellation()
        guard response.data.count <= maximumResponseBytes else { throw PCAAPIError.malformedResponse }
        switch response.statusCode {
        case 200...299:
            do { return try decoder.decode(type, from: response.data) }
            catch { throw PCAAPIError.malformedResponse }
        case 400: throw PCAAPIError.invalidRequest
        case 401: throw PCAAPIError.unauthorized
        case 403: throw PCAAPIError.forbidden
        case 404: throw PCAAPIError.unavailable
        case 408, 429, 500...599: throw PCAAPIError.rejected
        default: throw PCAAPIError.rejected
        }
    }

    private func validateChallenge(_ id: String, nonce: String, expiresAt: String) throws {
        guard PCADevicePolicyProofCodec.canonicalUUID(id),
              PCADevicePolicyProofCodec.canonicalBase64URL32(nonce),
              let expiry = PCADevicePolicyProofCodec.canonicalDate(expiresAt), expiry > now() else {
            throw PCAAPIError.malformedResponse
        }
    }

    private static func validateIdentity(_ familyId: String, _ deviceId: String) throws {
        guard PCADevicePolicyProofCodec.canonicalUUID(familyId), PCADevicePolicyProofCodec.canonicalUUID(deviceId) else {
            throw PCAAPIError.invalidRequest
        }
    }

    private static func canonicalSignature(_ value: String) -> Bool {
        guard let bytes = PCADevicePolicyProofCodec.decodeCanonicalBase64URL(value), bytes.count == 64 else { return false }
        return P256DerSignature.isLowS(bytes)
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
        let appliedIds = Set(applied.map { Data($0.messageId.utf8) })
        let unparseableIds = Set(unparseableMessageIds.map { Data($0.utf8) })
        let droppedIds = Set(droppedForListBound.map { Data($0.utf8) })
        let receiptIds = Set(receipts.map { Data($0.messageId.utf8) })
        guard !scope.familyId.isEmpty, scope.familyId.utf16.count <= 128,
              !scope.recipientDeviceId.isEmpty, scope.recipientDeviceId.utf16.count <= 128,
              applied.count <= 256, unparseableMessageIds.count <= 100, droppedForListBound.count <= 100,
              appliedIds.count == applied.count,
              (unparseableMessageIds + droppedForListBound).allSatisfy({ !$0.isEmpty && $0.utf16.count <= 128 }),
              unparseableIds.count == unparseableMessageIds.count,
              droppedIds.count == droppedForListBound.count,
              receipts.count <= 100, receiptIds.count == receipts.count,
              appliedIds.isDisjoint(with: unparseableIds), appliedIds.isDisjoint(with: droppedIds),
              unparseableIds.isDisjoint(with: droppedIds),
              receiptIds.isDisjoint(with: unparseableIds), receiptIds.isDisjoint(with: droppedIds),
              receipts.allSatisfy({ !appliedIds.contains(Data($0.messageId.utf8)) || $0.outcome == .applied }) else {
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
    /// Matches the production URLSession transport's default response bound.
    private static let maximumResponseBytes = 4 * 1024 * 1024
    private let baseURL: URL
    private let transport: PCAHTTPTransport
    private let decoder = JSONDecoder()
    private let now: () -> Date

    public init(baseURL: URL, transport: PCAHTTPTransport, now: @escaping () -> Date = Date.init) throws {
        // The bearer credential is attached to every runtime-sync request. Require an
        // origin URL so URL.appendingPathComponent cannot inherit userinfo, a query,
        // a fragment, or an unrelated base path from injected configuration.
        guard baseURL.scheme?.lowercased() == "https", baseURL.host != nil,
              baseURL.user == nil, baseURL.password == nil,
              baseURL.query == nil, baseURL.fragment == nil,
              baseURL.path.isEmpty || baseURL.path == "/" else {
            throw PCAAPIError.invalidConfiguration
        }
        self.baseURL = baseURL
        self.transport = transport
        self.now = now
    }

    public func pull(session: PCADeviceSession, cursor: String? = nil) async throws -> PCAInboundRuntimeSyncResponse {
        try validateSession(session)
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
        try validateSession(session)
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%."))
        guard let component = messageId.addingPercentEncoding(withAllowedCharacters: allowed),
              let url = URL(string: baseURL.appendingPathComponent("v1/runtime-sync/inbound").absoluteString + "/" + component + "/ack") else {
            throw PCAAPIError.invalidRequest
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(session.sessionToken)", forHTTPHeaderField: "Authorization")
        _ = try await send(request, decodeAs: EmptyPCAResponse.self,
            terminalMissingAcknowledgement: EmptyPCAResponse())
    }

    /// Reports the host's observed protection state to the existing backend
    /// reconciliation route. This is deliberately a separate operation from
    /// pulling inbound envelopes: transport receipt never becomes a claim of
    /// local enforcement.
    public func reportProtectionStatus(_ status: PCAProtectionStatus, session: PCADeviceSession) async throws {
        try validateSession(session)
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
        guard response.data.count <= Self.maximumResponseBytes else { throw PCAAPIError.malformedResponse }
        switch response.statusCode {
        case 200...299: return
        case 401: throw PCAAPIError.unauthorized
        case 403: throw PCAAPIError.forbidden
        case 400: throw PCAAPIError.invalidRequest
        case 404: throw PCAAPIError.unavailable
        case 408, 429, 500...599: throw PCAAPIError.rejected
        default: throw PCAAPIError.rejected
        }
    }

    /// Device-session tokens use the backend's unpadded 32-byte base64url
    /// representation. Reject malformed persisted/session input before any
    /// authenticated runtime-sync request is sent.
    private func validateSession(_ session: PCADeviceSession) throws {
        try Self.validateSessionToken(session.sessionToken)
        let currentTime = now()
        guard currentTime.timeIntervalSince1970.isFinite,
              session.expiresAt.timeIntervalSince1970.isFinite,
              session.expiresAt > currentTime else {
            throw PCAAPIError.unauthorized
        }
    }

    private static func validateSessionToken(_ token: String) throws {
        let bytes = Array(token.utf8)
        guard bytes.count == 43,
              bytes.allSatisfy({
                  (0x41...0x5A).contains($0) || (0x61...0x7A).contains($0) ||
                  (0x30...0x39).contains($0) || $0 == 0x2D || $0 == 0x5F
              }) else {
            throw PCAAPIError.unauthorized
        }
    }

    private func send<T: Decodable>(_ request: URLRequest, decodeAs type: T.Type,
                                    terminalMissingAcknowledgement: T? = nil) async throws -> T {
        let response: PCAHTTPResponse
        do { response = try await transport.send(request) }
        catch is CancellationError { throw CancellationError() }
        catch let error as PCAHTTPTransportError { throw PCAAPIError.transport(error) }
        catch { throw PCAAPIError.transport(.network) }
        try Task.checkCancellation()
        switch response.statusCode {
        case 200...299: break
        case 401: throw PCAAPIError.unauthorized
        case 403: throw PCAAPIError.forbidden
        case 400:
            if request.url?.path == baseURL.appendingPathComponent("v1/runtime-sync/inbound").path,
               request.url?.query != nil {
                guard (try? StrictJSONDocument.validateNoDuplicateMembers(response.data,
                    maximumBytes: Self.maximumResponseBytes)) != nil else { throw PCAAPIError.malformedResponse }
                if let body = try? JSONSerialization.jsonObject(with: response.data) as? [String: Any],
                   body["error"] as? String == "invalid_cursor" { throw PCAInboundNavigationError.invalidCursor }
            }
            throw PCAAPIError.invalidRequest
        case 404:
            // A retained ACK may outlive the server's encrypted envelope.
            // Only this exact authenticated ACK response means there is no
            // remaining relay copy to acknowledge; a missing route or any
            // other 404 still leaves the local acknowledgement pending.
            if let terminalMissingAcknowledgement,
               response.data == Data(#"{"error":"not_found"}"#.utf8) {
                return terminalMissingAcknowledgement
            }
            throw PCAAPIError.unavailable
        case 408, 429, 500...599: throw PCAAPIError.rejected
        default: throw PCAAPIError.rejected
        }
        guard (try? StrictJSONDocument.validateNoDuplicateMembers(response.data,
                  maximumBytes: Self.maximumResponseBytes)) != nil,
              let value = try? decoder.decode(type, from: response.data) else {
            throw PCAAPIError.malformedResponse
        }
        return value
    }
}

private struct EmptyPCAResponse: Decodable {}
