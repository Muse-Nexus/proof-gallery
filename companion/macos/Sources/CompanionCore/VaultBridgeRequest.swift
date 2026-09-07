import Foundation

/// Independent of the legacy five-minute v1 transfer. No path/URL authority.
public struct VaultBridgeRequest: Sendable {
    public let path: String
    public let token: String
    public let length: Int
    public let preflight: Bool
    public let gallery: Bool
    public static let origin = "https://proof-gallery-9jn.pages.dev"
    public static func parse(_ data: Data, port: UInt16) throws -> Self {
        guard data.count <= 8192, let text = String(data: data, encoding: .utf8), text.hasSuffix("\r\n\r\n") else { throw BridgeError.invalidRequest }
        let lines = text.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ", omittingEmptySubsequences: false)
        guard first.count == 3, first[2] == "HTTP/1.1" else { throw BridgeError.invalidRequest }
        let method = String(first[0]), path = String(first[1])
        let gallery = ["info", "list", "media", "create", "edit", "approve", "delete"].map { "/v2/gallery/" + $0 }.contains(path)
        guard gallery || ["/v2/assistant/search", "/v2/assistant/get"].contains(path),
              method == "POST" || (gallery && method == "OPTIONS") else { throw BridgeError.invalidRequest }
        var headers: [String: String] = [:]
        for line in lines.dropFirst().dropLast(2) {
            guard let separator = line.firstIndex(of: ":"), !line.hasPrefix(" "), !line.hasPrefix("\t") else { throw BridgeError.invalidRequest }
            let key = String(line[..<separator]).lowercased()
            let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty, key.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }), headers[key] == nil,
                  !value.contains(where: { $0.asciiValue.map { $0 < 32 || $0 == 127 } ?? false }) else { throw BridgeError.invalidRequest }
            headers[key] = value
        }
        guard headers["host"] == "127.0.0.1:\(port)",
              gallery ? headers["origin"] == origin : headers["origin"] == nil,
              headers["transfer-encoding"] == nil, headers["expect"] == nil else { throw BridgeError.invalidRequest }
        let raw = headers["content-length"] ?? "0"
        guard !raw.isEmpty, raw.allSatisfy({ $0 >= "0" && $0 <= "9" }), let length = Int(raw),
              length <= (path == "/v2/gallery/create" ? 14 * 1024 * 1024 : 64 * 1024) else { throw BridgeError.invalidRequest }
        if method == "OPTIONS" {
            let requested = (headers["access-control-request-headers"] ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            guard length == 0, headers["access-control-request-method"] == "POST",
                  requested.allSatisfy({ ["authorization", "content-type"].contains($0) }) else { throw BridgeError.invalidRequest }
            return Self(path: path, token: "", length: 0, preflight: true, gallery: true)
        }
        guard length > 0, headers["content-type"] == "application/json",
              let auth = headers["authorization"], auth.hasPrefix("Bearer ") else { throw BridgeError.invalidRequest }
        let token = String(auth.dropFirst(7))
        guard token.count == 64, token.allSatisfy({ "0123456789abcdef".contains($0) }) else { throw BridgeError.invalidRequest }
        return Self(path: path, token: token, length: length, preflight: false, gallery: gallery)
    }
}
