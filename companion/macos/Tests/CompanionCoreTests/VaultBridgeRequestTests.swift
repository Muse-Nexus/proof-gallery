import XCTest
@testable import CompanionCore

final class VaultBridgeRequestTests: XCTestCase {
    private let token = String(repeating: "a", count: 64)
    private func data(_ path: String = "/v2/gallery/list", origin: String? = VaultBridgeRequest.origin, extra: String = "", host: String = "127.0.0.1:34567") -> Data {
        Data("POST \(path) HTTP/1.1\r\nHost: \(host)\r\n\(origin.map { "Origin: \($0)\r\n" } ?? "")Authorization: Bearer \(token)\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\(extra)\r\n".utf8)
    }
    func testExactOriginsRoutesAndClientDoors() throws {
        XCTAssertTrue(try VaultBridgeRequest.parse(data(), port: 34567).gallery)
        XCTAssertFalse(try VaultBridgeRequest.parse(data("/v2/assistant/get", origin: nil), port: 34567).gallery)
        for request in [data(origin: nil), data(origin: "https://evil.example"), data("/v2/assistant/get"), data(host: "localhost:34567"), data("/v2/gallery/clear"), data("/v2/gallery/list?token=x"), data(extra: "Origin: https://evil.example\r\n"), data(extra: "Transfer-Encoding: chunked\r\n"), data(extra: "Expect: 100-continue\r\n"), data(extra: "Content-Length: 2\r\n")] {
            XCTAssertThrowsError(try VaultBridgeRequest.parse(request, port: 34567))
        }
    }
    func testPreflightCarriesNoGrantAndCannotBeAssistantDoor() throws {
        let raw = "OPTIONS /v2/gallery/list HTTP/1.1\r\nHost: 127.0.0.1:34567\r\nOrigin: \(VaultBridgeRequest.origin)\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type,authorization\r\n\r\n"
        let parsed = try VaultBridgeRequest.parse(Data(raw.utf8), port: 34567)
        XCTAssertTrue(parsed.preflight); XCTAssertEqual(parsed.token, "")
        XCTAssertThrowsError(try VaultBridgeRequest.parse(Data(raw.replacingOccurrences(of: "/gallery/list", with: "/assistant/get").utf8), port: 34567))
    }
}
