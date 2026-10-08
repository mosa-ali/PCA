import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Small transport seam used by every child-device HTTP adapter. Keeping the
/// URLSession boundary here makes request construction and failure mapping
/// deterministic in XCTest without ever replacing the production transport.
public struct PCAHTTPResponse {
    public let statusCode: Int
    public let data: Data

    public init(statusCode: Int, data: Data) {
        self.statusCode = statusCode
        self.data = data
    }
}

public enum PCAHTTPTransportError: Error, Equatable {
    case insecureURL
    case invalidResponse
    case responseTooLarge
    case timeout
    case network
}

public protocol PCAHTTPTransport {
    func send(_ request: URLRequest) async throws -> PCAHTTPResponse
}

/// Production HTTP transport. It accepts only HTTPS endpoints, applies
/// bounded timeouts, never logs request headers/body, and returns the status
/// code to the API adapter for explicit endpoint-specific mapping.
public final class PCAURLSessionTransport: PCAHTTPTransport {
    private let session: URLSession
    private let maxResponseBytes: Int

    public init(session: URLSession = .shared, maxResponseBytes: Int = 4 * 1024 * 1024) {
        self.session = session
        self.maxResponseBytes = maxResponseBytes
    }

    public func send(_ request: URLRequest) async throws -> PCAHTTPResponse {
        try Task.checkCancellation()
        guard let url = request.url,
              url.scheme?.lowercased() == "https",
              url.user == nil,
              url.password == nil else {
            throw PCAHTTPTransportError.insecureURL
        }

        var boundedRequest = request
        boundedRequest.timeoutInterval = min(max(request.timeoutInterval, 1), 60)

        do {
            #if canImport(FoundationNetworking)
            let (data, response) = try await session.data(for: boundedRequest)
            try Task.checkCancellation()
            #else
            let (bytes, response) = try await session.bytes(for: boundedRequest)
            try Task.checkCancellation()
            guard response.expectedContentLength <= Int64(maxResponseBytes) else { throw PCAHTTPTransportError.responseTooLarge }
            var data = Data()
            for try await byte in bytes {
                try Task.checkCancellation()
                guard data.count < maxResponseBytes else { throw PCAHTTPTransportError.responseTooLarge }
                data.append(byte)
            }
            #endif
            guard data.count <= maxResponseBytes else { throw PCAHTTPTransportError.responseTooLarge }
            guard let httpResponse = response as? HTTPURLResponse else {
                throw PCAHTTPTransportError.invalidResponse
            }
            return PCAHTTPResponse(statusCode: httpResponse.statusCode, data: data)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch let error as PCAHTTPTransportError {
            throw error
        } catch let error as URLError where error.code == .timedOut {
            throw PCAHTTPTransportError.timeout
        } catch {
            throw PCAHTTPTransportError.network
        }
    }
}

public final class InMemoryPCAHTTPTransport: PCAHTTPTransport {
    public private(set) var requests: [URLRequest] = []
    private let responder: (URLRequest) async throws -> PCAHTTPResponse
    private let autoAcceptEnrollmentPreparation: Bool

    public init(autoAcceptEnrollmentPreparation: Bool = true, responder: @escaping (URLRequest) async throws -> PCAHTTPResponse) {
        self.autoAcceptEnrollmentPreparation = autoAcceptEnrollmentPreparation
        self.responder = responder
    }

    public func send(_ request: URLRequest) async throws -> PCAHTTPResponse {
        if autoAcceptEnrollmentPreparation, request.url?.path == "/v1/enrollment/bootstrap/prepare" {
            return PCAHTTPResponse(statusCode: 200, data: Data(#"{"status":"READY"}"#.utf8))
        }
        requests.append(request)
        return try await responder(request)
    }
}
