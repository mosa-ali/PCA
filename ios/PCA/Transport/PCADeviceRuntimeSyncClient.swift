import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct PCAInboundEnvelope: Decodable, Equatable {
    public let messageId: String
    public let senderDeviceId: String
    public let messageType: String
    public let payload: String
}

public struct PCAInboundRuntimeSyncResponse: Decodable, Equatable {
    public let applied: [PCAInboundEnvelope]
    public let unparseableMessageIds: [String]
    public let droppedForListBound: Bool
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
        var request = URLRequest(url: baseURL.appendingPathComponent("v1/runtime-sync/inbound/\(messageId)/ack"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(session.sessionToken)", forHTTPHeaderField: "Authorization")
        _ = try await send(request, decodeAs: EmptyPCAResponse.self)
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
