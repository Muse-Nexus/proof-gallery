import XCTest
@testable import CompanionIntelligence

final class EvidenceTests: XCTestCase {
    func source(_ id: String, _ text: String) -> EvidenceSource { EvidenceSource(id: id, revision: "synthetic", text: text) }
    func testExtractiveValidationRejectsInventedMeaningAndIDs() throws {
        let source = source("11111111-1111-4111-8111-111111111111", "Thank you for the clear synthetic report.")
        XCTAssertNoThrow(try EvidenceIntelligence.validateExcerpts([EvidenceExcerpt(sourceID: source.id, exactExcerpt: "Thank you for the clear synthetic report.")], sources: [source]))
        XCTAssertThrowsError(try EvidenceIntelligence.validateExcerpts([EvidenceExcerpt(sourceID: source.id, exactExcerpt: "Everyone loves you.")], sources: [source]))
        XCTAssertThrowsError(try EvidenceIntelligence.validateExcerpts([EvidenceExcerpt(sourceID: "unknown", exactExcerpt: source.text)], sources: [source]))
        XCTAssertThrowsError(try EvidenceIntelligence.validateExcerpts([EvidenceExcerpt(sourceID: source.id, exactExcerpt: "")], sources: [source]))
        let negative = self.source(source.id, "Nobody said I did a great job.")
        XCTAssertThrowsError(try EvidenceIntelligence.validateExcerpts([EvidenceExcerpt(sourceID: source.id, exactExcerpt: "I did a great job.")], sources: [negative]))
    }
    func testSemanticMatchingOnSyntheticEvidenceWhenAvailable() async throws {
        let engine = EvidenceIntelligence()
        guard await engine.capabilities()["semantic"] == true else { throw XCTSkip("On-device English embedding unavailable") }
        let relevant = source("11111111-1111-4111-8111-111111111111", "The reviewer thanked me for my useful contribution and thoughtful work.")
        let other = source("22222222-2222-4222-8222-222222222222", "The truck was parked behind a warehouse.")
        let result = try await engine.search(EvidenceRequest(query: "Someone appreciated my work", sources: [other, relevant]))
        XCTAssertEqual(result.ids.first, relevant.id)
    }
    func testRealOnDeviceSourceSelectionWhenExplicitlyEnabled() async throws {
        guard ProcessInfo.processInfo.environment["PROOF_TEST_LOCAL_MODEL"] == "1" else { throw XCTSkip("Explicit synthetic local model probe only") }
        let engine = EvidenceIntelligence()
        guard await engine.capabilities()["story"] == true else { throw XCTSkip("Apple on-device model unavailable") }
        let note = source("11111111-1111-4111-8111-111111111111", "Synthetic reviewer: Thank you for the clear contribution.")
        let result = try await engine.story(EvidenceRequest(query: "Select a source for a short reading.", sources: [note]))
        XCTAssertEqual(result.ids, [note.id]); XCTAssertEqual(result.excerpts.first?.exactExcerpt, note.text)
    }
}
