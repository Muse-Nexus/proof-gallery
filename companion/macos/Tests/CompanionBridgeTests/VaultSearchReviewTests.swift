import XCTest
import CompanionCore
import CompanionVault
@testable import CompanionIntelligence
@testable import ProofPhotosCompanion

final class VaultSearchReviewTests: XCTestCase {
    func testFilenameOnlyMeaningNeverEntersSemanticOrLiteralIndex() throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }
        var input = fixture.input()
        input.fields.category = "creativity"
        input.fields.person = "Synthetic reviewer"
        input.fields.project = "Synthetic draft"
        input.fields.tags = ["owner-chosen-tag"]
        let media = try XCTUnwrap(input.media)
        let filename = "everyone-loves-me-chosen-identity.png"
        input.media = VaultMedia(filename: filename, mimeType: media.mimeType, sha256: media.sha256, bytes: media.bytes)
        input.receipt = VaultProviderReceipt(provider: .folder, sourceID: "synthetic-folder", originalFilename: filename,
            originalSha256: media.sha256, captureDate: "2026-08-03T12:00:00Z", timeZone: "UTC", scope: "Selected synthetic folder")
        let item = try fixture.vault.saveManual(input)
        let index = VaultService.indexText(item)
        XCTAssertFalse(index.contains(filename))
        XCTAssertFalse(index.contains("everyone-loves-me"))
        XCTAssertTrue(index.contains(input.fields.evidenceText))
        XCTAssertTrue(index.contains("Synthetic reviewer"))
        XCTAssertTrue(index.contains("Synthetic draft"))
        XCTAssertTrue(index.contains("owner-chosen-tag"))
        XCTAssertEqual(item.receipt?.originalFilename, filename)
        XCTAssertEqual(item.media?.filename, filename)
        XCTAssertEqual(item.receipt, input.receipt)
    }

    private func request(count: Int = 12) -> EvidenceRequest {
        EvidenceRequest(query: "Someone appreciated my thoughtful work", sources: (1...count).map { index in
            EvidenceSource(id: String(format: "11111111-1111-4111-8111-%012d", index), revision: "synthetic-revision",
                text: "The reviewer thanked me for my thoughtful contribution and useful work on this synthetic report.")
        })
    }

    func testInvalidInternalLimitsFailBeforeEmbeddingAvailability() async throws {
        let engine = EvidenceIntelligence()
        for limit in [-1, 0, 11, Int.max] {
            do {
                _ = try await engine.search(request(), limit: limit)
                XCTFail("Invalid result limit must fail")
            } catch let error as BridgeError {
                guard case .invalidEvidence = error else { return XCTFail("Expected deterministic limit validation") }
            }
        }
    }

    func testRequestedTenAndSevenVersusLegacySixWhenEmbeddingAvailable() async throws {
        let engine = EvidenceIntelligence()
        guard await engine.capabilities()["semantic"] == true else { throw XCTSkip("On-device English embedding unavailable") }
        let input = request()
        let legacy = try await engine.search(input)
        XCTAssertEqual(legacy.ids.count, 6)
        for limit in [7, 10] {
            let result = try await engine.search(input, limit: limit)
            XCTAssertEqual(result.ids.count, limit)
            XCTAssertEqual(Set(result.ids).count, limit)
            XCTAssertTrue(result.ids.allSatisfy { id in input.sources.contains { $0.id == id } })
            XCTAssertTrue(result.excerpts.isEmpty)
        }
        // Internal limit remains a call argument, not a new v1 wire field.
        let wire = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        XCTAssertEqual(Set(wire.keys), ["query", "sources"])
    }
    func testNativeServicePassesRequestedLimitToSemanticRankerWhenAvailable() async throws {
        let engine = EvidenceIntelligence()
        guard await engine.capabilities()["semantic"] == true else { throw XCTSkip("On-device English embedding unavailable") }
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }
        let literalNote = "The reviewer thanked me for my thoughtful contribution and useful work on this synthetic report."
        for _ in 0..<12 {
            _ = try fixture.vault.saveManual(VaultInput(fields: VaultFields(evidenceText: literalNote, category: "creativity")))
        }
        let grant = try fixture.grant(.assistant, scopes: [.savedText])
        let service = VaultService(vault: fixture.vault)
        for limit in [7, 10] {
            let body = try JSONSerialization.data(withJSONObject: ["query": "Someone appreciated my thoughtful work", "limit": limit])
            let header = Data("POST /v2/assistant/search HTTP/1.1\r\nHost: 127.0.0.1:45678\r\nAuthorization: Bearer \(grant.token)\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\n\r\n".utf8)
            let response = try await service.handle(VaultBridgeRequest.parse(header, port: 45678), body: body)
            try service.withAuthorizedResponse(response) {}
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: response.data) as? [String: Any])
            XCTAssertEqual(object["matching"] as? String, "local-semantic")
            let items = try XCTUnwrap(object["items"] as? [[String: Any]])
            XCTAssertEqual(items.count, limit)
            XCTAssertTrue(items.allSatisfy { ($0["fields"] as? [String: Any])?["evidenceText"] as? String == literalNote })
        }
    }

}
