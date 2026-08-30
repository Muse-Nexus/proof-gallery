import Foundation

/// A deliberately small HTTP boundary: no URLs, cookies, chunking, or arbitrary routes.
public struct BridgeRequest {
    public let method: String
    public let path: String
    public let length: Int
    public let preflight: Bool

    public static func parse(_ data: Data, port: UInt16, token: String, origin: String) throws -> Self {
        guard data.count <= 8192, let text = String(data: data, encoding: .utf8), text.hasSuffix("\r\n\r\n") else { throw BridgeError.invalidRequest }
        let lines = text.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ", omittingEmptySubsequences: false)
        guard first.count == 3, first[2] == "HTTP/1.1" else { throw BridgeError.invalidRequest }
        let method = String(first[0]), path = String(first[1])
        let routes = ["/v1/review": "GET", "/v1/capabilities": "GET", "/v1/search": "POST", "/v1/story": "POST"]
        guard let expected = routes[path], method == expected || method == "OPTIONS" else { throw BridgeError.invalidRequest }
        var headers: [String: String] = [:]
        for line in lines.dropFirst().dropLast(2) {
            guard let separator = line.firstIndex(of: ":"), !line.hasPrefix(" "), !line.hasPrefix("\t") else { throw BridgeError.invalidRequest }
            let key = String(line[..<separator]).lowercased()
            let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty, !key.contains(where: { !$0.isASCII || $0.isWhitespace }), headers[key] == nil,
                  !value.contains(where: { $0.asciiValue.map { $0 < 32 || $0 == 127 } ?? false }) else { throw BridgeError.invalidRequest }
            headers[key] = value
        }
        guard headers["host"] == "127.0.0.1:\(port)", headers["origin"] == origin,
              headers["transfer-encoding"] == nil, headers["expect"] == nil else { throw BridgeError.invalidRequest }
        let rawLength = headers["content-length"] ?? "0"
        guard !rawLength.isEmpty, rawLength.allSatisfy({ $0 >= "0" && $0 <= "9" }), let length = Int(rawLength), length <= 262_144 else { throw BridgeError.invalidRequest }
        if method == "OPTIONS" {
            guard length == 0, headers["access-control-request-method"] == expected else { throw BridgeError.invalidRequest }
            let requested = (headers["access-control-request-headers"] ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            guard requested.allSatisfy({ ["authorization", "content-type"].contains($0) }) else { throw BridgeError.invalidRequest }
        } else {
            guard headers["authorization"] == "Bearer \(token)" else { throw BridgeError.invalidRequest }
            if method == "GET" { guard length == 0 else { throw BridgeError.invalidRequest } }
            else { guard length > 0, headers["content-type"] == "application/json" else { throw BridgeError.invalidRequest } }
        }
        return Self(method: method, path: path, length: length, preflight: method == "OPTIONS")
    }
}
public enum BridgeError: Error { case invalidRequest, unavailable, invalidEvidence, busy }
