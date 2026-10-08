import Foundation

public enum PCAAPIError: Error, Equatable {
    case invalidConfiguration
    case invalidRequest
    case unauthorized
    case unavailable
    case rejected
    case attemptAbandoned
    case preparationRejected
    case malformedResponse
    /// A successful bootstrap/recovery response with an unusable DTO cannot
    /// prove that the server did not commit the saved enrollment attempt.
    case enrollmentOutcomeUnknown
    case transport(PCAHTTPTransportError)
}

public struct PCAEnrollmentBootstrapRequest: Encodable, Equatable {
    public let rawInvitationToken: String
    public let platform: String
    public let signingPublicKey: String
    public let encryptionPublicKey: String
    public let bootstrapAttemptId: String
    public let attemptRecoveryToken: String

    public init(rawInvitationToken: String, signingPublicKey: String, encryptionPublicKey: String, bootstrapAttemptId: String, attemptRecoveryToken: String) {
        self.rawInvitationToken = rawInvitationToken
        self.platform = "IOS"
        self.signingPublicKey = signingPublicKey
        self.encryptionPublicKey = encryptionPublicKey
        self.bootstrapAttemptId = bootstrapAttemptId
        self.attemptRecoveryToken = attemptRecoveryToken
    }
}

public struct PCAEnrollmentBootstrapResponse: Decodable, Equatable {
    public let deviceId: String
    /// Server-minted M1 DSK label for this enrollment (Wave 6D seed capture).
    public let signingKeyId: String
    /// Server-minted DEK label for this enrollment (Wave 6D seed capture).
    public let encryptionKeyId: String
    public let status: String
    public let childProfileId: String?
    public let ageUxTier: PCAAgeUxTier
    public let initialPolicyProfile: PCAInitialPolicyProfile

    private enum CodingKeys: String, CodingKey {
        case deviceId
        case signingKeyId
        case encryptionKeyId
        case status
        case childProfileId
        case ageUxTier
        case initialPolicyProfile
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        deviceId = try container.decode(String.self, forKey: .deviceId)
        signingKeyId = try container.decode(String.self, forKey: .signingKeyId)
        encryptionKeyId = try container.decode(String.self, forKey: .encryptionKeyId)
        status = try container.decode(String.self, forKey: .status)
        ageUxTier = try container.decode(PCAAgeUxTier.self, forKey: .ageUxTier)
        initialPolicyProfile = try container.decode(PCAInitialPolicyProfile.self, forKey: .initialPolicyProfile)

        for (key, value) in [
            (CodingKeys.deviceId, deviceId),
            (.signingKeyId, signingKeyId),
            (.encryptionKeyId, encryptionKeyId),
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: container,
                debugDescription: "Server enrollment identifiers must be nonblank strings."
            )
        }

        guard container.contains(.childProfileId) else {
            throw DecodingError.keyNotFound(
                CodingKeys.childProfileId,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "The server enrollment DTO must include childProfileId as a string or null."
                )
            )
        }
        if try container.decodeNil(forKey: .childProfileId) {
            childProfileId = nil
        } else {
            let value = try container.decode(String.self, forKey: .childProfileId)
            guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw DecodingError.dataCorruptedError(
                    forKey: .childProfileId,
                    in: container,
                    debugDescription: "A non-null childProfileId must be a nonblank string."
                )
            }
            childProfileId = value
        }
    }
}

public struct PCAEnrollmentBootstrapClient {
    public let baseURL: URL
    private let transport: PCAHTTPTransport
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(baseURL: URL, transport: PCAHTTPTransport) throws {
        guard baseURL.scheme?.lowercased() == "https", baseURL.user == nil, baseURL.password == nil else {
            throw PCAAPIError.invalidConfiguration
        }
        self.baseURL = baseURL
        self.transport = transport
    }

    public func bootstrap(
        _ value: PCAEnrollmentBootstrapRequest,
        willRecoverFromPreflightFailure: (@MainActor () throws -> Void)? = nil,
        didConfirmNoPreflightAttempt: (@MainActor () throws -> Void)? = nil,
        willSubmit: (@MainActor () throws -> Void)? = nil
    ) async throws -> PCAEnrollmentBootstrapResponse {
        do {
            try await prepare(value)
        } catch let error as PCAAPIError where error == .unavailable {
            // Only the backend's exact not-found envelope lets a second 404
            // prove the prepared attempt can be released.
            return try await recoverAfterPreflightFailure(
                value,
                releasePreparedAttemptOnNotFound: true,
                willRecoverFromPreflightFailure: willRecoverFromPreflightFailure,
                didConfirmNoPreflightAttempt: didConfirmNoPreflightAttempt,
                willSubmit: willSubmit
            )
        } catch let error as PCAAPIError where error == .enrollmentOutcomeUnknown {
            // A malformed success or an unrecognized 404 may follow a server
            // side reservation. Recovery is safe; absence is not yet proven.
            return try await recoverAfterPreflightFailure(
                value,
                releasePreparedAttemptOnNotFound: false,
                willRecoverFromPreflightFailure: willRecoverFromPreflightFailure,
                didConfirmNoPreflightAttempt: didConfirmNoPreflightAttempt,
                willSubmit: willSubmit
            )
        }
        var request = URLRequest(url: baseURL.appendingPathComponent("v1/enrollment/bootstrap"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(value)
        return try await decode(request, willSubmit: willSubmit)
    }

    private func recoverAfterPreflightFailure(
        _ value: PCAEnrollmentBootstrapRequest,
        releasePreparedAttemptOnNotFound: Bool,
        willRecoverFromPreflightFailure: (@MainActor () throws -> Void)?,
        didConfirmNoPreflightAttempt: (@MainActor () throws -> Void)?,
        willSubmit: (@MainActor () throws -> Void)?
    ) async throws -> PCAEnrollmentBootstrapResponse {
        // A local .prepared attempt has not sent bootstrap. Resolve any
        // reservation that may have succeeded before a prior response was
        // lost, and persist recovery-only custody before sending this lookup.
        try await willRecoverFromPreflightFailure?()
        let recovered: PCAEnrollmentBootstrapResponse
        do {
            recovered = try await recover(
                attemptId: value.bootstrapAttemptId,
                attemptRecoveryToken: value.attemptRecoveryToken
            )
        } catch let recoveryError as PCAAPIError where recoveryError == .unavailable {
            guard releasePreparedAttemptOnNotFound else {
                throw PCAAPIError.enrollmentOutcomeUnknown
            }
            try await didConfirmNoPreflightAttempt?()
            throw PCAAPIError.preparationRejected
        }
        try Task.checkCancellation()
        try await willSubmit?()
        return recovered
    }

    private func prepare(_ value: PCAEnrollmentBootstrapRequest) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("v1/enrollment/bootstrap/prepare"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(value)
        try Task.checkCancellation()
        let response: PCAHTTPResponse
        do { response = try await transport.send(request) }
        catch is CancellationError { throw CancellationError() }
        catch let error as PCAHTTPTransportError {
            try Task.checkCancellation()
            throw PCAAPIError.transport(error)
        }
        catch {
            try Task.checkCancellation()
            throw PCAAPIError.transport(.network)
        }
        try Task.checkCancellation()
        switch response.statusCode {
        case 200:
            guard let json = try? JSONSerialization.jsonObject(with: response.data) as? [String: String],
                  let status = json["status"], status == "READY" || status == "COMPLETED" else {
                throw PCAAPIError.enrollmentOutcomeUnknown
            }
        case 400: throw PCAAPIError.invalidRequest
        case 401: throw PCAAPIError.unauthorized
        case 404:
            throw Self.isInvitationUnavailableEnvelope(response.data)
                ? PCAAPIError.unavailable
                : PCAAPIError.enrollmentOutcomeUnknown
        case 408, 429, 500...599: throw PCAAPIError.rejected
        default: throw PCAAPIError.rejected
        }
    }

    public func recover(attemptId: String, attemptRecoveryToken: String) async throws -> PCAEnrollmentBootstrapResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("v1/enrollment/bootstrap/recover"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(["bootstrapAttemptId": attemptId, "attemptRecoveryToken": attemptRecoveryToken])
        return try await decode(request)
    }

    private func decode(
        _ request: URLRequest,
        willSubmit: (@MainActor () throws -> Void)? = nil
    ) async throws -> PCAEnrollmentBootstrapResponse {
        try Task.checkCancellation()
        try await willSubmit?()
        let response: PCAHTTPResponse
        do { response = try await transport.send(request) }
        catch is CancellationError { throw CancellationError() }
        catch let error as PCAHTTPTransportError {
            try Task.checkCancellation()
            throw PCAAPIError.transport(error)
        }
        catch {
            try Task.checkCancellation()
            throw PCAAPIError.transport(.network)
        }
        try Task.checkCancellation()

        switch response.statusCode {
        case 200...299: break
        case 400: throw PCAAPIError.invalidRequest
        case 401: throw PCAAPIError.unauthorized
        case 404:
            throw Self.isInvitationUnavailableEnvelope(response.data)
                ? PCAAPIError.unavailable
                : PCAAPIError.enrollmentOutcomeUnknown
        case 408, 429, 500...599: throw PCAAPIError.rejected
        default: throw PCAAPIError.rejected
        }
        if request.url?.path.hasSuffix("/v1/enrollment/bootstrap/recover") == true,
           let object = try? JSONSerialization.jsonObject(with: response.data) as? [String: String],
           object["status"] == "ATTEMPT_ABANDONED" {
            throw PCAAPIError.attemptAbandoned
        }
        guard let decoded = try? decoder.decode(PCAEnrollmentBootstrapResponse.self, from: response.data) else {
            throw PCAAPIError.enrollmentOutcomeUnknown
        }
        // Bootstrap and recovery return the original pending pairing only. A
        // later lifecycle status cannot be treated as enrollment proof or
        // persisted as this device's freshly enrolled identity.
        guard decoded.status == "PAIRING_PENDING" else {
            throw PCAAPIError.enrollmentOutcomeUnknown
        }
        return decoded
    }

    private static func isInvitationUnavailableEnvelope(_ data: Data) -> Bool {
        // Match the backend's canonical one-field body without dictionary
        // decoding, which could collapse duplicate JSON object members.
        let expected = Data(#"{"error":"invitation_unavailable"}"#.utf8)
        var start = data.startIndex
        var end = data.endIndex
        while start < end, isJSONWhitespace(data[start]) {
            start = data.index(after: start)
        }
        while start < end {
            let previous = data.index(before: end)
            guard isJSONWhitespace(data[previous]) else { break }
            end = previous
        }
        return data[start..<end].elementsEqual(expected)
    }

    private static func isJSONWhitespace(_ byte: UInt8) -> Bool {
        byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D
    }
}

public struct PCADeviceSessionChallenge: Decodable, Equatable {
    public let challengeId: String
    public let nonce: String
    public let expiresAt: Date
}

public struct PCADeviceSessionResponse: Decodable, Equatable {
    public let sessionToken: String
    public let expiresAt: Date
}

public protocol PCADeviceProofProvider {
    var signingPublicKey: String { get }
    var encryptionPublicKey: String { get }
    func sign(challenge: String) throws -> String
}

public enum PCADeviceProofError: Error, Equatable {
    case cryptoActivationPending
    /// Wave 6D: the Secure Enclave DSK is absent or refused (no prepared
    /// identity, missing key material, signing refusal). Fail closed --
    /// never a fabricated or software-signed challenge response.
    case secureKeyUnavailable
}

/// Explicit production boundary for the still-unapproved crypto suite. The
/// app can compose transport, persistence, authorization, and UI now, but it
/// must stop here rather than inventing key generation or signatures.
public struct PendingPCADeviceProofProvider: PCADeviceProofProvider {
    public init() {}
    public var signingPublicKey: String { "" }
    public var encryptionPublicKey: String { "" }
    public func sign(challenge: String) throws -> String { throw PCADeviceProofError.cryptoActivationPending }
}

public struct PCADeviceSessionClient {
    private let baseURL: URL
    private let transport: PCAHTTPTransport
    private let proof: PCADeviceProofProvider
    private let decoder: JSONDecoder

    public init(baseURL: URL, transport: PCAHTTPTransport, proof: PCADeviceProofProvider) throws {
        guard baseURL.scheme?.lowercased() == "https" else { throw PCAAPIError.invalidConfiguration }
        self.baseURL = baseURL; self.transport = transport; self.proof = proof
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    @MainActor public func establishSession(deviceId: String, assertContinuity: @MainActor () throws -> Void = {}) async throws -> PCADeviceSessionResponse {
        try Task.checkCancellation()
        try assertContinuity()
        var challengeRequest = URLRequest(url: baseURL.appendingPathComponent("v1/runtime-sync/devices/\(deviceId)/challenge"))
        challengeRequest.httpMethod = "POST"
        let challenge = try await decode(challengeRequest, as: PCADeviceSessionChallenge.self)
        try Task.checkCancellation()
        try assertContinuity()
        let signature: String
        do { signature = try proof.sign(challenge: challenge.nonce) }
        catch let error as PCADeviceProofError { throw error }
        catch { throw PCAAPIError.rejected }
        try Task.checkCancellation()
        try assertContinuity()

        var sessionRequest = URLRequest(url: baseURL.appendingPathComponent("v1/runtime-sync/devices/\(deviceId)/session"))
        sessionRequest.httpMethod = "POST"
        sessionRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        sessionRequest.httpBody = try JSONSerialization.data(withJSONObject: ["challengeId": challenge.challengeId, "signature": signature])
        let response = try await decode(sessionRequest, as: PCADeviceSessionResponse.self)
        try Task.checkCancellation()
        try assertContinuity()
        return response
    }

    private func decode<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let response: PCAHTTPResponse
        do { response = try await transport.send(request) }
        catch is CancellationError { throw CancellationError() }
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
