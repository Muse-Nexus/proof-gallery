import XCTest
@testable import CompanionCore

final class BridgeRequestTests: XCTestCase {
    let token = String(repeating: "a", count: 64)
    let origin = "https://proof-gallery-9jn.pages.dev"
    func request(_ extra: String = "", method: String = "GET", path: String = "/v1/review") -> Data {
        Data("\(method) \(path) HTTP/1.1\r\nHost: 127.0.0.1:12345\r\nOrigin: \(origin)\r\nAuthorization: Bearer \(token)\r\n\(extra)\r\n".utf8)
    }
    func testExactBoundary() throws {
        let parsed = try BridgeRequest.parse(request(), port: 12345, token: token, origin: origin)
        XCTAssertEqual(parsed.path, "/v1/review"); XCTAssertFalse(parsed.preflight)
        for extra in ["Origin: https://evil.example\r\n", "Host: evil.example\r\n", "Transfer-Encoding: chunked\r\n", "Content-Length: 1\r\n", "Authorization: Bearer other\r\n", " folded: header\r\n"] {
            XCTAssertThrowsError(try BridgeRequest.parse(request(extra), port: 12345, token: token, origin: origin))
        }
        XCTAssertThrowsError(try BridgeRequest.parse(request(), port: 12346, token: token, origin: origin))
        XCTAssertThrowsError(try BridgeRequest.parse(request(), port: 12345, token: "wrong", origin: origin))
        XCTAssertThrowsError(try BridgeRequest.parse(request(path: "/v1/review?token=x"), port: 12345, token: token, origin: origin))
        XCTAssertThrowsError(try BridgeRequest.parse(Data(repeating: 65, count: 8193), port: 12345, token: token, origin: origin))
    }
    func testPreflightAndBoundedPost() throws {
        let preflight = request("Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: authorization\r\n", method: "OPTIONS")
        XCTAssertTrue(try BridgeRequest.parse(preflight, port: 12345, token: "not needed", origin: origin).preflight)
        let post = request("Content-Type: application/json\r\nContent-Length: 200\r\n", method: "POST", path: "/v1/search")
        XCTAssertEqual(try BridgeRequest.parse(post, port: 12345, token: token, origin: origin).length, 200)
        XCTAssertThrowsError(try BridgeRequest.parse(request("Content-Type: application/json\r\nContent-Length: 262145\r\n", method: "POST", path: "/v1/story"), port: 12345, token: token, origin: origin))
    }
}
