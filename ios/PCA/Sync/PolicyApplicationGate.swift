import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

/// Device-side defense-in-depth epoch/replay floor, consumed on top of
/// (never instead of) the envelope-level checks the backend
/// FamilyEnvelopeVerifier already performs before this device's payload
/// ever gets decrypted (doc 22; backend/src/familyenvelope). This type
/// exists because a decrypted, already-envelope-accepted policy can still
/// pass through additional local caching/storage before
/// `ScheduleEngine`/the DeviceActivity extension actually apply it -- this
/// gate is the LAST local check before that application, mirroring the
/// same "never move the floor backward" anti-downgrade discipline as the
/// backend's own trustSetEpoch/keyEpoch checks (never reimplementing
/// their cryptographic verification, only re-asserting the ordering
/// invariant once more at the point of local use).
public struct PolicyEpochStamp: Equatable {
    public let trustSetEpoch: Int
    public let keyEpoch: Int
    public init(trustSetEpoch: Int, keyEpoch: Int) {
        self.trustSetEpoch = trustSetEpoch
        self.keyEpoch = keyEpoch
    }
}

/// Output from the production envelope verification/decryption/decoding
/// boundary. Its initializer is module-internal so application callers cannot
/// label arbitrary transport JSON as verified policy. A concrete producer
/// must verify the signed envelope and decrypt/decode its payload first.
public struct PCADecryptedPolicyApplicationPayload {
    public let envelope: PCAInboundEnvelope
    public let scheduleData: Data
    public let applicationTokenData: Data
    public let protectedApplicationTokenData: Data?

    init(envelope: PCAInboundEnvelope, scheduleData: Data, applicationTokenData: Data,
         protectedApplicationTokenData: Data?) {
        self.envelope = envelope
        self.scheduleData = scheduleData
        self.applicationTokenData = applicationTokenData
        self.protectedApplicationTokenData = protectedApplicationTokenData
    }
}

/// Security boundary for the real receiver. There is intentionally no
/// permissive/default implementation: without an approved production crypto
/// pipeline, policy application remains unavailable.
public protocol PCADevicePolicyEnvelopeProcessing {
    func verifyDecryptAndDecode(target: PCADevicePolicyActivationTarget,
                                expectedFamilyId: String,
                                expectedDeviceId: String) throws -> PCADecryptedPolicyApplicationPayload
}

public enum PolicyApplicationDecision: Equatable {
    case apply
    case rejectMissingTrustedEpochFloor
    case rejectInvalidCandidateEpoch
    case rejectInvalidTrustedEpochFloor
    case rejectStaleTrustSetEpoch
    case rejectStaleKeyEpoch
}

public enum PolicyApplicationGate {
    /// Family protocol epochs stay inside signed 32-bit range on every
    /// platform. The lower bounds remain field-specific: trust-set epochs
    /// start at 1, while keyEpoch 0 remains a supported initial/sentinel value.
    public static let maximumEpoch = Int(Int32.max)

    /// `currentFloor` must come from a previously verified and durably
    /// accepted Trust Set/policy receipt. An absent floor is not authority
    /// to trust an arbitrary first epoch: the approved first-device root
    /// ceremony and receipt-verification path must establish it before local
    /// policy application is possible. Once a floor exists, both epochs
    /// must be >= the floor; EITHER one regressing is rejected independently.
    public static func evaluate(candidate: PolicyEpochStamp, currentFloor: PolicyEpochStamp?) -> PolicyApplicationDecision {
        guard let floor = currentFloor else { return .rejectMissingTrustedEpochFloor }
        guard isValid(candidate) else { return .rejectInvalidCandidateEpoch }
        guard isValid(floor) else { return .rejectInvalidTrustedEpochFloor }
        if candidate.trustSetEpoch < floor.trustSetEpoch { return .rejectStaleTrustSetEpoch }
        if candidate.keyEpoch < floor.keyEpoch { return .rejectStaleKeyEpoch }
        return .apply
    }

    private static func isValid(_ stamp: PolicyEpochStamp) -> Bool {
        stamp.trustSetEpoch >= 1 && stamp.trustSetEpoch <= maximumEpoch &&
        stamp.keyEpoch >= 0 && stamp.keyEpoch <= maximumEpoch
    }
}

// MARK: - Device Policy Application Proof V1

/// Exact byte-level representation used by backend `canonicalizeEnvelope`.
/// The signature is deliberately excluded. Do not replace this with JSON
/// serialization or a reconstructed policy model.
public enum PCADevicePolicyEnvelopeCanonicalizer {
    public static let maximumCanonicalBytes = 98_304

    public static func canonicalBytes(_ envelope: PCAInboundEnvelope) throws -> Data {
        guard envelope.messageType == "POLICY_UPDATE",
              envelope.recipientGroup == nil,
              let recipient = envelope.recipientDeviceId,
              let payload = Data(base64Encoded: envelope.payload),
              payload.count > 0, payload.count <= 65_536,
              payload.base64EncodedString() == envelope.payload else {
            throw PCAInboundInboxError.unavailable
        }
        try envelope.validate(scope: PCAInboundScope(familyId: envelope.familyId,
                                                      recipientDeviceId: recipient))
        guard let issuedAt = canonicalBackendDate(envelope.issuedAt),
              let expiresAt = canonicalBackendDate(envelope.expiresAt) else {
            throw PCAInboundInboxError.unavailable
        }
        let fields = [
            String(envelope.protocolMajor), String(envelope.protocolMinor), envelope.messageId,
            envelope.familyId, envelope.senderDeviceId, "DEVICE", recipient, envelope.senderKeyId,
            envelope.messageType, envelope.sequenceOrNonce, envelope.issuedAt, envelope.expiresAt,
            String(envelope.trustSetEpoch), String(envelope.keyEpoch), envelope.semanticVersion,
            envelope.correlationId == nil ? "0" : "1", envelope.correlationId ?? "",
            payload.base64EncodedString(),
        ]
        var canonicalFields = fields
        canonicalFields[10] = issuedAt
        canonicalFields[11] = expiresAt
        let text = canonicalFields.map { "\($0.utf8.count):\($0)" }.joined()
        let bytes = Data(text.utf8)
        guard bytes.count <= maximumCanonicalBytes else { throw PCAInboundInboxError.unavailable }
        return bytes
    }

    /// JavaScript Date.toISOString() is fixed UTC with exactly three
    /// fractional digits. Envelope validation currently accepts only that
    /// canonical spelling; parse/re-emit here so this serializer remains
    /// pinned to backend semantics if the transport parser later broadens.
    private static func canonicalBackendDate(_ value: String) -> String? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: value) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        let canonical = formatter.string(from: date)
        guard canonical == value else { return nil }
        return canonical
    }

    public static func sha256(_ canonicalBytes: Data) throws -> Data {
        guard canonicalBytes.count <= maximumCanonicalBytes else { throw PCAInboundInboxError.unavailable }
        #if canImport(CryptoKit)
        return Data(SHA256.hash(data: canonicalBytes))
        #else
        throw PCAInboundInboxError.unavailable
        #endif
    }
}

public enum PCADevicePolicyApplicationResult: String, Codable, Equatable {
    case applied = "APPLIED"
    case degraded = "DEGRADED"
    case rejected = "REJECTED"
}

/// Server-issued values are carried verbatim into the transcript. Expiry is
/// canonical UTC milliseconds and a challenge cannot be used after expiry.
public struct PCADevicePolicyProofChallenge: Codable, Equatable {
    public let challengeId: String
    public let nonce: String
    public let familyId: String
    public let deviceId: String
    public let policyEnvelopeMessageId: String
    public let policyEnvelopeSha256: String
    public let trustSetEpoch: Int
    public let keyEpoch: Int
    public let expiresAt: String

    public init(challengeId: String, nonce: String, familyId: String, deviceId: String,
                policyEnvelopeMessageId: String, policyEnvelopeSha256: String,
                trustSetEpoch: Int, keyEpoch: Int, expiresAt: String) {
        self.challengeId = challengeId; self.nonce = nonce; self.familyId = familyId
        self.deviceId = deviceId; self.policyEnvelopeMessageId = policyEnvelopeMessageId
        self.policyEnvelopeSha256 = policyEnvelopeSha256; self.trustSetEpoch = trustSetEpoch
        self.keyEpoch = keyEpoch; self.expiresAt = expiresAt
    }
}

public enum PCADevicePolicyProofCodec {
    public static let domain = "PCA_DEVICE_POLICY_APPLICATION_PROOF_V1"
    public static let tombstoneRetention: TimeInterval = 14 * 24 * 60 * 60
    public static let maximumTranscriptBytes = 2_048

    public static func encode(_ challenge: PCADevicePolicyProofChallenge,
                              result: PCADevicePolicyApplicationResult) throws -> Data {
        guard canonicalUUID(challenge.familyId), canonicalUUID(challenge.deviceId),
              canonicalUUID(challenge.challengeId), canonicalBase64URL32(challenge.nonce),
              canonicalBase64URL32(challenge.policyEnvelopeSha256),
              (1...Int(Int32.max)).contains(challenge.trustSetEpoch),
              (1...Int(Int32.max)).contains(challenge.keyEpoch),
              !challenge.policyEnvelopeMessageId.isEmpty,
              challenge.policyEnvelopeMessageId.utf8.count <= 512,
              challenge.policyEnvelopeMessageId.utf16.count <= 128,
              canonicalTimestamp(challenge.expiresAt) else { throw PCAInboundInboxError.unavailable }
        let fields = [domain, challenge.familyId, challenge.deviceId,
                      challenge.policyEnvelopeMessageId, challenge.policyEnvelopeSha256,
                      String(challenge.trustSetEpoch), String(challenge.keyEpoch), result.rawValue,
                      challenge.challengeId, challenge.nonce, challenge.expiresAt]
        let text = fields.map { "\($0.utf8.count):\($0)" }.joined()
        let bytes = Data(text.utf8)
        guard bytes.count <= maximumTranscriptBytes else { throw PCAInboundInboxError.unavailable }
        return bytes
    }

    public static func proof(challenge: PCADevicePolicyProofChallenge,
                             result: PCADevicePolicyApplicationResult,
                             dsk: PCADeviceProofProvider,
                             now: Date = Date()) throws -> PCADeviceApplicationProof {
        guard let expires = canonicalDate(challenge.expiresAt), expires > now else {
            throw PCAInboundInboxError.unavailable
        }
        let transcript = try encode(challenge, result: result)
        let signature = try dsk.sign(challenge: String(decoding: transcript, as: UTF8.self))
        guard let raw = decodeCanonicalBase64URL(signature), raw.count == 64,
              P256DerSignature.isLowS(raw) else { throw PCAInboundInboxError.unavailable }
        return PCADeviceApplicationProof(challenge: challenge, result: result,
            transcript: transcript, signature: raw, createdAt: now)
    }

    static func canonicalUUID(_ value: String) -> Bool {
        guard let uuid = UUID(uuidString: value) else { return false }
        return uuid.uuidString.lowercased() == value
    }

    static func canonicalBase64URL32(_ value: String) -> Bool {
        guard let data = decodeCanonicalBase64URL(value) else { return false }
        return data.count == 32
    }

    static func decodeCanonicalBase64URL(_ value: String) -> Data? {
        guard !value.isEmpty, value.utf8.allSatisfy({
            ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || ($0 >= 48 && $0 <= 57) || $0 == 45 || $0 == 95
        }) else { return nil }
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64.append("=") }
        guard let data = Data(base64Encoded: base64), base64URL(data) == value else { return nil }
        return data
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func canonicalTimestamp(_ value: String) -> Bool {
        canonicalDate(value) != nil
    }

    static func canonicalDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value), formatter.string(from: date) == value,
              value.utf8.count == 24 else { return nil }
        return date
    }
}

/// Minimal local retry record. It contains only the signed transcript and
/// signature, never policy plaintext or family receipt data.
public struct PCADeviceApplicationProof: Codable, Equatable {
    public let challenge: PCADevicePolicyProofChallenge
    public let result: PCADevicePolicyApplicationResult
    public let transcript: Data
    public let signature: Data
    public let createdAt: Date

    public var challengeId: String { challenge.challengeId }

    public var canonicalRequestBytes: Data {
        var bytes = transcript
        bytes.append(signature)
        return bytes
    }

    public func exactRequestSha256() throws -> String {
        PCADevicePolicyProofCodec.base64URL(try PCADevicePolicyEnvelopeCanonicalizer.sha256(canonicalRequestBytes))
    }

    public static func == (left: Self, right: Self) -> Bool {
        left.challenge == right.challenge && left.result == right.result && left.transcript == right.transcript &&
        left.signature == right.signature && left.createdAt == right.createdAt
    }
}

/// Keychain-backed bounded retry window. Pruning at every read/write makes
/// records older than 14 days unusable after restart as well as in-process.
public final class PCADeviceApplicationProofStore {
    private struct Snapshot: Codable { var records: [PCADeviceApplicationProof] }
    private static let lock = NSRecursiveLock()
    private let keychain: KeychainStoreProtocol
    private let service: String
    private let account = "device-policy-application-proofs.v1"

    public init(keychain: KeychainStoreProtocol, serviceNamespace: String) {
        self.keychain = keychain
        self.service = serviceNamespace + ".policy-application-proof"
    }

    public func proof(challengeId: String, now: Date) throws -> PCADeviceApplicationProof? {
        Self.lock.lock(); defer { Self.lock.unlock() }
        return try load(now: now).records.first(where: { $0.challengeId == challengeId })
    }

    /// Reuses the byte-identical signed request after process death or a lost
    /// server response. Signing is performed only when no live challenge
    /// tombstone exists; a different transcript for the same challenge fails.
    public func proofOrCreate(challenge: PCADevicePolicyProofChallenge,
                              result: PCADevicePolicyApplicationResult,
                              dsk: PCADeviceProofProvider,
                              now: Date) throws -> PCADeviceApplicationProof {
        Self.lock.lock(); defer { Self.lock.unlock() }
        let transcript = try PCADevicePolicyProofCodec.encode(challenge, result: result)
        var snapshot = try load(now: now)
        if let existing = snapshot.records.first(where: { $0.challengeId == challenge.challengeId }) {
            guard existing.transcript == transcript, existing.result == result else { throw PCAInboundInboxError.unavailable }
            return existing
        }
        let created = try PCADevicePolicyProofCodec.proof(challenge: challenge, result: result, dsk: dsk, now: now)
        snapshot.records.append(created)
        try persist(snapshot)
        let readback = try load(now: now)
        guard readback.records.contains(where: { $0 == created }) else { throw PCAInboundInboxError.unavailable }
        return created
    }

    private func load(now: Date) throws -> Snapshot {
        var snapshot: Snapshot
        do { snapshot = try JSONDecoder().decode(Snapshot.self, from: keychain.retrieve(forAccount: account, service: service)) }
        catch KeychainStoreError.itemNotFound { snapshot = Snapshot(records: []) }
        catch { throw PCAInboundInboxError.unavailable }
        let cutoff = now.addingTimeInterval(-PCADevicePolicyProofCodec.tombstoneRetention)
        let live = snapshot.records.filter { $0.createdAt >= cutoff && $0.createdAt <= now }
        if live.count != snapshot.records.count {
            snapshot.records = live
            try persist(snapshot)
        }
        return snapshot
    }

    private func persist(_ snapshot: Snapshot) throws {
        let data = try JSONEncoder().encode(snapshot)
        try keychain.storeReplacingAtomically(data, forAccount: account, service: service,
                                              accessibility: .whenUnlockedThisDeviceOnly)
        guard try keychain.retrieve(forAccount: account, service: service) == data else {
            throw PCAInboundInboxError.unavailable
        }
    }
}
