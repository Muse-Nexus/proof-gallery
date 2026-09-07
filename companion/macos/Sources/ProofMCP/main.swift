import Foundation
import CompanionCore
import Darwin

/// Deliberately no Photos or database dependency. The companion authorizes
/// every read. A helper process is not itself a source or collection grant.
private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

private struct Connection: Sendable {
    let port: UInt16
    let token: String
    init(environment: [String: String]) throws {
        guard let rawPort = environment["PROOF_MCP_PORT"], rawPort.allSatisfy({ $0.isASCII && $0.isNumber }),
              let port = UInt16(rawPort), port >= 1024,
              let token = environment["PROOF_MCP_TOKEN"], token.count == 64,
              token.allSatisfy({ "0123456789abcdef".contains($0) }) else { throw ProofMCPError.unavailable }
        self.port = port; self.token = token
    }
    func read(endpoint: String, body: Data) async throws -> Data {
        guard ["/v2/assistant/search", "/v2/assistant/get"].contains(endpoint),
              body.count <= ProofMCPProtocol.maximumLineBytes,
              let url = URL(string: "http://127.0.0.1:\(port)\(endpoint)") else { throw ProofMCPError.unavailable }
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil; config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.connectionProxyDictionary = [:]
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 8; config.timeoutIntervalForResource = 10
        config.httpMaximumConnectionsPerHost = 1
        let session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.mimeType == "application/json",
              http.expectedContentLength <= ProofMCPProtocol.maximumTextResponseBytes else { throw ProofMCPError.invalidResponse }
        var result = Data()
        for try await byte in bytes {
            guard result.count < ProofMCPProtocol.maximumTextResponseBytes else { throw ProofMCPError.invalidResponse }
            result.append(byte)
        }
        return result
    }
}

@main
private enum ProofMCPMain {
    static func main() async {
        signal(SIGPIPE, SIG_IGN)
        guard let connection = try? Connection(environment: ProcessInfo.processInfo.environment) else {
            fail("Proof connection is not configured. Create an assistant permission in the companion, then supply PROOF_MCP_PORT and PROOF_MCP_TOKEN.\n")
            return
        }
        let protocolCore = ProofMCPProtocol()
        var buffer = [UInt8](repeating: 0, count: 4096)
        var line = Data()
        // Sequential, bounded requests: no unbounded queue or concurrent scans.
        // EOF/termination closes the process; a read has a 10-second deadline.
        while true {
            let count = Darwin.read(STDIN_FILENO, &buffer, buffer.count)
            if count == 0 { return }
            if count < 0 {
                if errno == EINTR { continue }
                fail("Proof input closed.\n"); return
            }
            for byte in buffer.prefix(count) {
                if byte == 10 {
                    if let response = await protocolCore.handle(line, request: { endpoint, body in
                        try await connection.read(endpoint: endpoint, body: body)
                    }) {
                        do { try FileHandle.standardOutput.write(contentsOf: response + Data([10])) }
                        catch { return }
                    }
                    line.removeAll(keepingCapacity: true)
                } else {
                    guard line.count < ProofMCPProtocol.maximumLineBytes else {
                        fail("Proof request exceeded the size limit.\n"); return
                    }
                    line.append(byte)
                }
            }
        }
    }
    static func fail(_ message: String) {
        try? FileHandle.standardError.write(contentsOf: Data(message.utf8))
    }
}
