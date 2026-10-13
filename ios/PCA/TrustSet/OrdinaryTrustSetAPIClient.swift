import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CryptoKit)
import CryptoKit

/// Existing P256 / SHA256 DSK suite. Verifies raw P1363 signatures, with no software signing fallback.
public struct P256OrdinaryTrustSetSignatureVerifier: OrdinaryTrustSetSignatureVerifying {
    public init() {}
    public func verify(signature: String, canonicalBytes: Data, publicKey: String) throws -> Bool {
        // The shared backend acceptance contract treats a malformed or
        // non-canonical base64url key/signature as a verification failure,
        // not an exception. Keep this boundary fail-closed and consistent
        // with that Bool result so callers never need to distinguish parse
        // failures from cryptographic rejection.
        func urlBytes(_ value: String) -> Data? {
            let padded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
                + String(repeating: "=", count: (4 - value.count % 4) % 4)
            guard let bytes = Data(base64Encoded: padded),
                  bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                    .replacingOccurrences(of: "=", with: "") == value else { return nil }
            return bytes
        }
        guard let key = urlBytes(publicKey), let signed = urlBytes(signature) else { return false }
        guard key.count == 65, key.first == 4, signed.count == 64, P256DerSignature.isLowS(signed) else { return false }
        guard let verifier = try? P256.Signing.PublicKey(x963Representation: key),
              let decodedSignature = try? P256.Signing.ECDSASignature(rawRepresentation: signed) else { return false }
        return verifier.isValidSignature(decodedSignature, for: canonicalBytes)
    }
}
#endif

private final class OrdinaryTrustSetNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Transport v1 DTOs are closed objects, so validate their response shape
/// after the shared strict JSON parser rejects malformed or duplicate members.
enum OrdinaryTrustSetJSON {
    enum Kind { case submission, acceptedHead, acceptedRecord }
    private typealias Shape = StrictJSONDocument.Shape

    static func validate(_ data: Data, as kind: Kind) throws {
        let shape = try parse(data)
        switch kind {
        case .submission:
            let root = try object(shape, keys: ["outcome", "acceptedEpoch", "acceptedHead"])
            _ = try record(root[key("acceptedHead")])
            guard let accepted = root[key("acceptedEpoch")] else { throw PCAAPIError.malformedResponse }
            switch accepted {
            case .null: break
            case .object(_): _ = try record(accepted)
            default: throw PCAAPIError.malformedResponse
            }
        case .acceptedHead:
            let root = try object(shape, keys: ["acceptedHead"])
            _ = try record(root[key("acceptedHead")])
        case .acceptedRecord:
            let root = try object(shape, keys: ["acceptedEpoch"])
            _ = try record(root[key("acceptedEpoch")])
        }
    }

    private static func parse(_ data: Data) throws -> Shape {
        do { return try StrictJSONDocument.parse(data) }
        catch { throw PCAAPIError.malformedResponse }
    }

    private static let recordKeys = ["canonicalEpochBase64", "signatureBase64", "signerDeviceId",
                                     "signerKeyId", "trustSetEpoch", "keyEpoch"]
    private static func record(_ shape: Shape?) throws -> [Data: Shape] {
        guard let shape else { throw PCAAPIError.malformedResponse }
        return try object(shape, keys: recordKeys)
    }
    private static func object(_ shape: Shape, keys: [String]) throws -> [Data: Shape] {
        guard case let .object(values) = shape,
              Set(values.keys) == Set(keys.map(key)) else { throw PCAAPIError.malformedResponse }
        return values
    }
    private static func key(_ value: String) -> Data {
        var result = Data()
        for scalar in value.unicodeScalars {
            var encoded = scalar.value.bigEndian
            withUnsafeBytes(of: &encoded) { result.append(contentsOf: $0) }
        }
        return result
    }
}

/// Device-session-only implementation of OrdinaryEpochTransportV1. The caller owns session renewal.
public final class OrdinaryTrustSetAPIClient: OrdinaryTrustSetTransport {
    private let baseURL: URL
    private let familyId: String
    private let sessionToken: () throws -> String
    private let http: PCAHTTPTransport
    public init(baseURL: URL, familyId: String, sessionToken: @escaping () throws -> String, http: PCAHTTPTransport? = nil) throws {
        guard baseURL.scheme == "https", baseURL.host != nil, baseURL.user == nil, baseURL.password == nil,
              baseURL.query == nil, baseURL.fragment == nil, baseURL.path.isEmpty || baseURL.path == "/",
              !familyId.isEmpty, familyId.utf8.count <= 128,
              familyId.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-.")).contains($0) })
        else { throw PCAAPIError.invalidConfiguration }
        self.baseURL = baseURL; self.familyId = familyId; self.sessionToken = sessionToken
        self.http = http ?? PCAURLSessionTransport(session: URLSession(configuration: .ephemeral,
            delegate: OrdinaryTrustSetNoRedirectDelegate(), delegateQueue: nil))
    }
    private struct Record: Decodable {
        let canonicalEpochBase64: String, signatureBase64: String, signerDeviceId: String, signerKeyId: String
        let trustSetEpoch: Int, keyEpoch: Int
        func head(familyId: String) throws -> OrdinaryTrustSetHead {
            guard canonicalEpochBase64.utf8.count <= 349_528, signatureBase64.utf8.count == 88,
                  let bytes = Data(base64Encoded: canonicalEpochBase64), bytes.base64EncodedString() == canonicalEpochBase64,
                  let sig = Data(base64Encoded: signatureBase64), sig.count == 64, sig.base64EncodedString() == signatureBase64,
                  !signerDeviceId.isEmpty, signerDeviceId.utf16.count <= 128,
                  !signerKeyId.isEmpty, signerKeyId.utf16.count <= 128
            else { throw PCAAPIError.malformedResponse }
            let signature = signatureBase64.replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            let value = OrdinaryTrustSetHead(familyId: familyId, canonicalBytes: bytes, signature: signature)
            let epoch = try value.epoch()
            guard let owner = epoch.entries.first(where: { $0.role == .owner && $0.status == .active }),
                  Data(signerDeviceId.utf8) == Data(owner.deviceId.utf8),
                  Data(signerKeyId.utf8) == Data(owner.dskKeyId.utf8) else {
                throw PCAAPIError.malformedResponse
            }
            // The DTO's signer projection must name the signed active Owner;
            // the coordinator still verifies the signature and predecessor
            // linkage against its persisted accepted floor before adoption.
            guard epoch.trustSetEpoch == trustSetEpoch, epoch.keyEpoch == keyEpoch else {
                throw PCAAPIError.malformedResponse
            }
            return value
        }
    }
    private struct Result: Decodable {
        let outcome: String
        let acceptedEpoch: Record?
        let acceptedEpochPresent: Bool
        let acceptedHead: Record

        private enum CodingKeys: String, CodingKey { case outcome, acceptedEpoch, acceptedHead }

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            outcome = try values.decode(String.self, forKey: .outcome)
            acceptedEpochPresent = values.contains(.acceptedEpoch)
            acceptedEpoch = try values.decodeIfPresent(Record.self, forKey: .acceptedEpoch)
            acceptedHead = try values.decode(Record.self, forKey: .acceptedHead)
        }
    }
    private struct HeadResult: Decodable { let acceptedHead: Record }
    private struct RecordResult: Decodable { let acceptedEpoch: Record }
    private static func isCanonicalSessionToken(_ token: String) -> Bool {
        token.utf8.count == 43 && token.utf8.allSatisfy { byte in
            (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)
                || (byte >= 48 && byte <= 57) || byte == 45 || byte == 95
        }
    }
    private func call(suffix: String, pending: OrdinaryTrustSetPending?) async throws -> PCAHTTPResponse {
        let token = try sessionToken()
        guard Self.isCanonicalSessionToken(token) else { throw PCAAPIError.unauthorized }
        let path = "api/device/families/\(familyId)/trust-set/epochs" + suffix
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = pending == nil ? "GET" : "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let pending {
            try pending.validate()
            guard Data(pending.candidate.familyId.utf8) == Data(familyId.utf8) else { throw OrdinaryTrustSetError.scopeMismatch }
            let signature = pending.candidate.signature.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            let padded = signature + String(repeating: "=", count: (4 - signature.count % 4) % 4)
            guard let bytes = Data(base64Encoded: padded), bytes.count == 64 else { throw PCAAPIError.invalidRequest }
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["canonicalEpochBase64": pending.candidate.canonicalBytes.base64EncodedString(),
                "signatureBase64": bytes.base64EncodedString()], options: [.sortedKeys])
        }
        let response = try await http.send(request)
        let currentToken = try sessionToken()
        guard Self.isCanonicalSessionToken(currentToken), Data(currentToken.utf8) == Data(token.utf8) else {
            throw PCAAPIError.unauthorized
        }
        guard response.data.count <= 1_048_576 else { throw PCAAPIError.malformedResponse }
        return response
    }
    private func result(_ response: PCAHTTPResponse, request: OrdinaryTrustSetPending, status: Bool) throws -> OrdinaryTrustSetSubmissionResult {
        guard response.statusCode == 200 || response.statusCode == 201 else {
            if response.statusCode == 401 { throw PCAAPIError.unauthorized }
            if response.statusCode == 403 { throw PCAAPIError.forbidden }
            if response.statusCode == 409 || response.statusCode == 422 { return .rejected }
            throw PCAAPIError.unavailable
        }
        try OrdinaryTrustSetJSON.validate(response.data, as: .submission)
        let result = try JSONDecoder().decode(Result.self, from: response.data)
        // Optional decoding alone cannot distinguish an explicit null receipt from
        // an omitted field. The v1 status contract requires the field on every
        // outcome, and NOT_ACCEPTED/CONFLICT require its value to be null.
        guard result.acceptedEpochPresent else { throw PCAAPIError.malformedResponse }
        let head = try result.acceptedHead.head(familyId: familyId)
        let headEpoch = try head.epoch()
        if result.outcome == "ACCEPTED" || (!status && result.outcome == "IDEMPOTENT_MATCH") {
            guard let record = result.acceptedEpoch,
                  Data(record.signerDeviceId.utf8) == Data(request.signerDeviceId.utf8),
                  Data(record.signerKeyId.utf8) == Data(request.signerKeyId.utf8) else { throw PCAAPIError.malformedResponse }
            let accepted = try record.head(familyId: familyId)
            let acceptedMetadata = try accepted.epoch()
            let headMetadata = try head.epoch()
            guard accepted == request.candidate,
                  headMetadata.trustSetEpoch >= acceptedMetadata.trustSetEpoch,
                  headMetadata.keyEpoch >= acceptedMetadata.keyEpoch,
                  headMetadata.trustSetEpoch != acceptedMetadata.trustSetEpoch || head == accepted else {
                throw PCAAPIError.malformedResponse
            }
            return .accepted(accepted)
        }
        guard status, result.acceptedEpoch == nil else { throw PCAAPIError.malformedResponse }
        let requestEpoch = try request.candidate.epoch()
        if result.outcome == "NOT_ACCEPTED" {
            // The backend only reports NOT_ACCEPTED when the indexed request
            // epoch is absent and differs from the consistent current head.
            guard requestEpoch.trustSetEpoch != headEpoch.trustSetEpoch else {
                throw PCAAPIError.malformedResponse
            }
            return .unknown
        }
        if result.outcome == "CONFLICT" {
            // A conflict means different immutable content exists at the
            // requested epoch. That epoch cannot be ahead of the accepted
            // head, and an exact head match cannot be called a conflict.
            guard requestEpoch.trustSetEpoch <= headEpoch.trustSetEpoch,
                  requestEpoch.trustSetEpoch != headEpoch.trustSetEpoch ||
                    head.canonicalBytes != request.candidate.canonicalBytes ||
                    Data(head.signature.utf8) != Data(request.candidate.signature.utf8) else {
                throw PCAAPIError.malformedResponse
            }
            return .rejected
        }
        throw PCAAPIError.malformedResponse
    }
    public func submit(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult {
        try result(await call(suffix: "", pending: request), request: request, status: false)
    }
    public func status(_ request: OrdinaryTrustSetPending) async throws -> OrdinaryTrustSetSubmissionResult {
        try result(await call(suffix: "/status", pending: request), request: request, status: true)
    }
    public func acceptedRecord(familyId: String, epoch: Int) async throws -> OrdinaryTrustSetHead {
        guard Data(familyId.utf8) == Data(self.familyId.utf8), (1...Int(Int32.max)).contains(epoch) else {
            throw OrdinaryTrustSetError.scopeMismatch
        }
        let response = try await call(suffix: "/records/\(epoch)", pending: nil)
        try requireAcceptedRead(response, shape: .acceptedRecord)
        let head = try JSONDecoder().decode(RecordResult.self, from: response.data).acceptedEpoch.head(familyId: familyId)
        guard try head.epoch().trustSetEpoch == epoch else { throw PCAAPIError.malformedResponse }
        return head
    }
    public func acceptedHead(familyId: String) async throws -> OrdinaryTrustSetHead {
        guard Data(familyId.utf8) == Data(self.familyId.utf8) else { throw OrdinaryTrustSetError.scopeMismatch }
        let response = try await call(suffix: "/head", pending: nil)
        try requireAcceptedRead(response, shape: .acceptedHead)
        return try JSONDecoder().decode(HeadResult.self, from: response.data).acceptedHead.head(familyId: familyId)
    }

    private func requireAcceptedRead(_ response: PCAHTTPResponse, shape: OrdinaryTrustSetJSON.Kind) throws {
        switch response.statusCode {
        case 200: try OrdinaryTrustSetJSON.validate(response.data, as: shape)
        case 401: throw PCAAPIError.unauthorized
        case 403: throw PCAAPIError.forbidden
        default: throw PCAAPIError.unavailable
        }
    }
}
