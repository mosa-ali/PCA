import Foundation

public enum PCAAPIError: Error, Equatable {
    case invalidConfiguration
    case invalidRequest
    case unauthorized
    case unavailable
    case rejected
    case malformedResponse
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
    public let status: String
    public let childProfileId: String?
    public let ageUxTier: PCAAgeUxTier
    public let initialPolicyProfile: PCAInitialPolicyProfile
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

    public func bootstrap(_ value: PCAEnrollmentBootstrapRequest) async throws -> PCAEnrollmentBootstrapResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("v1/enrollment/bootstrap"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(value)
        return try await decode(request)
    }

    public func recover(attemptId: String, attemptRecoveryToken: String) async throws -> PCAEnrollmentBootstrapResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("v1/enrollment/bootstrap/recover"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(["bootstrapAttemptId": attemptId, "attemptRecoveryToken": attemptRecoveryToken])
        return try await decode(request)
    }

    private func decode(_ request: URLRequest) async throws -> PCAEnrollmentBootstrapResponse {
        let response: PCAHTTPResponse
        do { response = try await transport.send(request) }
        catch let error as PCAHTTPTransportError { throw PCAAPIError.transport(error) }
        catch { throw PCAAPIError.transport(.network) }

        switch response.statusCode {
        case 200...299: break
        case 400: throw PCAAPIError.invalidRequest
        case 401: throw PCAAPIError.unauthorized
        case 404: throw PCAAPIError.unavailable
        case 408, 429, 500...599: throw PCAAPIError.rejected
        default: throw PCAAPIError.rejected
        }
        guard let decoded = try? decoder.decode(PCAEnrollmentBootstrapResponse.self, from: response.data) else {
            throw PCAAPIError.malformedResponse
        }
        return decoded
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

    public func establishSession(deviceId: String) async throws -> PCADeviceSessionResponse {
        var challengeRequest = URLRequest(url: baseURL.appendingPathComponent("v1/runtime-sync/devices/\(deviceId)/challenge"))
        challengeRequest.httpMethod = "POST"
        let challenge = try await decode(challengeRequest, as: PCADeviceSessionChallenge.self)
        let signature: String
        do { signature = try proof.sign(challenge: challenge.nonce) }
        catch let error as PCADeviceProofError { throw error }
        catch { throw PCAAPIError.rejected }

        var sessionRequest = URLRequest(url: baseURL.appendingPathComponent("v1/runtime-sync/devices/\(deviceId)/session"))
        sessionRequest.httpMethod = "POST"
        sessionRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        sessionRequest.httpBody = try JSONSerialization.data(withJSONObject: ["challengeId": challenge.challengeId, "signature": signature])
        return try await decode(sessionRequest, as: PCADeviceSessionResponse.self)
    }

    private func decode<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
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
