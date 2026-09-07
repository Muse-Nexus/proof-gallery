import XCTest
@testable import CompanionCore

final class ProofMCPProtocolTests: XCTestCase {
    private func data(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    private func decode(_ value: Data?) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(value)) as? [String: Any])
    }
    private func message(_ method: String, _ params: [String: Any] = [:]) throws -> Data {
        try data(["jsonrpc": "2.0", "id": 1, "method": method, "params": params])
    }
    private let unavailable: @Sendable (String, Data) async throws -> Data = { _, _ in throw ProofMCPError.unavailable }
    private func connect(_ server: ProofMCPProtocol) async throws {
        _ = await server.handle(try message("initialize", ["protocolVersion": "2025-11-25", "capabilities": [:], "clientInfo": ["name": "synthetic", "version": "1"]]), request: unavailable)
        _ = await server.handle(try data(["jsonrpc": "2.0", "method": "notifications/initialized"]), request: unavailable)
    }

    func testRequiresHandshakeAndNeverExecutesNotifications() async throws {
        let server = ProofMCPProtocol()
        let response = try decode(await server.handle(try message("tools/list"), request: unavailable))
        XCTAssertEqual((response["error"] as? [String: Any])?["code"] as? Int, -32002)
        let notice = try data(["jsonrpc": "2.0", "method": "tools/call", "params": ["name": "proof_search", "arguments": ["query": "synthetic"]]])
        let result = await server.handle(notice, request: { _, _ in XCTFail("Notification initiated evidence retrieval"); return Data() })
        XCTAssertNil(result)
    }

    func testNegotiatesOnlyImplementedVersionAndReadOnlyTools() async throws {
        let server = ProofMCPProtocol()
        let response = try decode(await server.handle(try message("initialize", ["protocolVersion": "future", "capabilities": [:], "clientInfo": ["name": "synthetic", "version": "1"]]), request: unavailable))
        XCTAssertEqual((response["result"] as? [String: Any])?["protocolVersion"] as? String, "2025-11-25")
        _ = await server.handle(try data(["jsonrpc": "2.0", "method": "notifications/initialized"]), request: unavailable)
        let listed = try decode(await server.handle(try message("tools/list"), request: unavailable))
        let tools = try XCTUnwrap((listed["result"] as? [String: Any])?["tools"] as? [[String: Any]])
        XCTAssertEqual(tools.compactMap { $0["name"] as? String }, ["proof_search", "proof_get"])
        XCTAssertTrue(tools.allSatisfy { ($0["annotations"] as? [String: Any])?["readOnlyHint"] as? Bool == true })
    }

    func testExactUntrustedEvidenceIsDataNotExecutableMeaning() async throws {
        let server = ProofMCPProtocol(); try await connect(server)
        let literal = "I never\nfinished that drawing. <script>synthetic</script>"
        let payload = try data(["items": [["evidenceText": literal, "occurredOn": NSNull(), "source": "synthetic source"]], "matching": "lexical"])
        let response = try decode(await server.handle(try message("tools/call", ["name": "proof_search", "arguments": ["query": "drawing", "limit": 3]]), request: { path, body in
            XCTAssertEqual(path, "/v2/assistant/search")
            XCTAssertEqual((try JSONSerialization.jsonObject(with: body) as? [String: Any])?["query"] as? String, "drawing")
            return payload
        }))
        let result = try XCTUnwrap(response["result"] as? [String: Any])
        let items = try XCTUnwrap((result["structuredContent"] as? [String: Any])?["items"] as? [[String: Any]])
        XCTAssertEqual(items[0]["evidenceText"] as? String, literal)
        XCTAssertTrue(items[0]["occurredOn"] is NSNull)
        XCTAssertEqual(result["isError"] as? Bool, false)
    }

    func testRejectsOutOfScopeArgumentsWithoutTransport() async throws {
        let server = ProofMCPProtocol(); try await connect(server)
        let cases: [(String, [String: Any])] = [
            ("proof_delete", ["id": UUID().uuidString]), ("proof_search", ["query": "x", "limit": 2]),
            ("proof_search", ["query": "x", "limit": 11]), ("proof_search", ["query": "x", "limit": true]),
            ("proof_search", ["query": "x", "limit": 3.5]), ("proof_search", ["query": " "]),
            ("proof_search", ["query": "x", "ownerId": "other"]), ("proof_search", ["query": "x", "category": "diagnosis"]),
            ("proof_search", ["query": "x", "tag": NSNull()]), ("proof_get", ["id": "../../private"]),
            ("proof_get", ["id": UUID().uuidString, "include_media": true])
        ]
        for (name, args) in cases {
            let response = try decode(await server.handle(try message("tools/call", ["name": name, "arguments": args]), request: { _, _ in XCTFail("Invalid request reached transport"); return Data() }))
            XCTAssertEqual((response["error"] as? [String: Any])?["code"] as? Int, -32602)
        }
    }

    func testFailureNeverEchoesTransportSecretsAndBoundsInputOutput() async throws {
        let server = ProofMCPProtocol(); try await connect(server)
        let command = try message("tools/call", ["name": "proof_get", "arguments": ["id": UUID().uuidString]])
        let failure = try decode(await server.handle(command, request: unavailable))
        XCTAssertEqual((failure["result"] as? [String: Any])?["isError"] as? Bool, true)
        let oversized = try decode(await server.handle(command, request: { _, _ in Data(repeating: 32, count: ProofMCPProtocol.maximumTextResponseBytes + 1) }))
        XCTAssertEqual((oversized["result"] as? [String: Any])?["isError"] as? Bool, true)
        let input = try decode(await server.handle(Data(repeating: 32, count: ProofMCPProtocol.maximumLineBytes + 1), request: unavailable))
        XCTAssertEqual((input["error"] as? [String: Any])?["code"] as? Int, -32600)
        for invalid in ["{", "{\"jsonrpc\":\"2.0\",\"id\":true,\"method\":\"ping\"}"] {
            let response = try decode(await server.handle(Data(invalid.utf8), request: unavailable))
            XCTAssertNotNil(response["error"])
        }
    }
}
