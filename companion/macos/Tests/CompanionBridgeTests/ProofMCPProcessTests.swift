import XCTest
import CompanionCore
import CompanionVault

final class ProofMCPProcessTests: XCTestCase {
    private struct RunResult { let stdout: Data; let stderr: Data; let status: Int32 }
    private var executable: URL {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return root.appendingPathComponent(ProcessInfo.processInfo.environment["PROOF_TEST_PACKAGED_HELPER"] == "1"
            ? ".build/Proof Photos Companion.app/Contents/Helpers/ProofMCP" : ".build/debug/ProofMCP")
    }
    private func run(_ messages: [[String: Any]], port: UInt16, token: String) async throws -> RunResult {
        let bytes = try messages.reduce(into: Data()) { result, message in
            result.append(try JSONSerialization.data(withJSONObject: message)); result.append(10)
        }
        let executable = executable
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            if ProcessInfo.processInfo.environment["PROOF_TEST_PACKAGED_HELPER"] == "1" { throw CocoaError(.fileNoSuchFile) }
            throw XCTSkip("Build the real ProofMCP product before process tests")
        }
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
                process.executableURL = executable
                process.environment = ["PROOF_MCP_PORT": String(port), "PROOF_MCP_TOKEN": token, "PATH": "/usr/bin:/bin"]
                process.standardInput = input; process.standardOutput = output; process.standardError = errors
                let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
                do {
                    try process.run()
                    DispatchQueue.global().asyncAfter(deadline: .now() + 20, execute: timeout)
                    try input.fileHandleForWriting.write(contentsOf: bytes)
                    try input.fileHandleForWriting.close()
                    let stdout = output.fileHandleForReading.readDataToEndOfFile()
                    let stderr = errors.fileHandleForReading.readDataToEndOfFile()
                    process.waitUntilExit(); timeout.cancel()
                    continuation.resume(returning: RunResult(stdout: stdout, stderr: stderr, status: process.terminationStatus))
                } catch {
                    timeout.cancel(); if process.isRunning { process.terminate() }
                    continuation.resume(throwing: error)
                }
            }
        }
    }
    private func initialization() -> [[String: Any]] { [
        ["jsonrpc": "2.0", "id": 1, "method": "initialize", "params": ["protocolVersion": "2025-11-25", "capabilities": [:], "clientInfo": ["name": "synthetic-test", "version": "1"]]],
        ["jsonrpc": "2.0", "method": "notifications/initialized"],
    ] }
    private func responses(_ result: RunResult) throws -> [[String: Any]] {
        try result.stdout.split(separator: 10).map { try XCTUnwrap(JSONSerialization.jsonObject(with: Data($0)) as? [String: Any]) }
    }
    private func call(_ id: Int, _ name: String, _ arguments: [String: Any]) -> [String: Any] {
        ["jsonrpc": "2.0", "id": id, "method": "tools/call", "params": ["name": name, "arguments": arguments]]
    }

    func testActualExecutableHandshakeReadOnlyToolsAndSameVaultExactEvidence() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }; try await fixture.start()
        let pending = try fixture.stage()
        var fields = pending.fields; fields.category = "creativity"
        let saved = try fixture.vault.approve(id: pending.id, revision: pending.revision, fields: fields)
        let grant = try fixture.grant(.assistant, scopes: [.savedText])
        let messages = initialization() + [
            ["jsonrpc": "2.0", "id": 2, "method": "tools/list"],
            call(3, "proof_get", ["id": saved.id]),
            call(4, "proof_search", ["query": "synthetic creativity", "limit": 3]),
            call(5, "proof_delete", ["id": saved.id]),
        ]
        let result = try await run(messages, port: fixture.port, token: grant.token)
        XCTAssertEqual(result.status, 0); XCTAssertTrue(result.stderr.isEmpty)
        let rows = try responses(result)
        XCTAssertEqual(rows.count, 5)
        guard rows.count == 5 else {
            let detail = String(decoding: result.stderr.prefix(4000), as: UTF8.self)
                .replacingOccurrences(of: grant.token, with: "REDACTED")
                .replacingOccurrences(of: fixture.root.path, with: "SYNTHETIC-VAULT")
            XCTFail("Helper exited \(result.status) with \(rows.count) responses. \(detail)")
            throw CocoaError(.executableRuntimeMismatch)
        }
        let initialize = try XCTUnwrap(rows[0]["result"] as? [String: Any])
        XCTAssertEqual(initialize["protocolVersion"] as? String, "2025-11-25")
        let listed = try XCTUnwrap(rows[1]["result"] as? [String: Any])
        let names = (listed["tools"] as? [[String: Any]])?.compactMap { $0["name"] as? String }
        XCTAssertEqual(Set(names ?? []), Set(["proof_get", "proof_search"]))
        let get = try XCTUnwrap(rows[2]["result"] as? [String: Any])
        let structured = try XCTUnwrap(get["structuredContent"] as? [String: Any])
        let decoded = try JSONDecoder().decode(VaultRecord.self, from: JSONSerialization.data(withJSONObject: try XCTUnwrap(structured["item"])))
        XCTAssertEqual(decoded, saved)
        let search = try XCTUnwrap(rows[3]["result"] as? [String: Any])
        let searchResult = try XCTUnwrap(search["structuredContent"] as? [String: Any])
        let searched = try JSONDecoder().decode([VaultRecord].self,
            from: JSONSerialization.data(withJSONObject: try XCTUnwrap(searchResult["items"])))
        XCTAssertEqual(searched, [saved])
        XCTAssertEqual((rows[4]["error"] as? [String: Any])?["code"] as? Int, -32602)
        XCTAssertEqual(try fixture.vault.list(state: .saved).count, 1)
        let allOutput = String(decoding: result.stdout + result.stderr, as: UTF8.self)
        XCTAssertFalse(allOutput.contains(grant.token)); XCTAssertFalse(allOutput.contains(fixture.root.path))
    }

    func testActualExecutablePendingAndRevokedReadsReturnGenericErrors() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }; try await fixture.start()
        let pending = try fixture.stage()
        let grant = try fixture.grant(.assistant, scopes: [.savedText])
        let messages = initialization() + [call(2, "proof_get", ["id": pending.id])]
        let pendingResult = try await run(messages, port: fixture.port, token: grant.token)
        let pendingRows = try responses(pendingResult)
        XCTAssertEqual((pendingRows.last?["result"] as? [String: Any])?["isError"] as? Bool, true)
        try fixture.vault.revokeClient(id: grant.grant.id)
        let revokedResult = try await run(messages, port: fixture.port, token: grant.token)
        let revokedRows = try responses(revokedResult)
        XCTAssertEqual((revokedRows.last?["result"] as? [String: Any])?["isError"] as? Bool, true)
        for result in [pendingResult, revokedResult] {
            XCTAssertEqual(result.status, 0); XCTAssertTrue(result.stderr.isEmpty)
            let output = String(decoding: result.stdout + result.stderr, as: UTF8.self)
            XCTAssertFalse(output.contains(pending.fields.evidenceText))
            XCTAssertFalse(output.contains(grant.token)); XCTAssertFalse(output.contains(fixture.root.path))
            XCTAssertTrue(output.contains("No evidence changed."))
        }
    }
}
