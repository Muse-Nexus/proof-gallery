import XCTest
import Foundation
import CompanionCore
import CompanionVault
@testable import ProofPhotosCompanion

private final class FenceMutationResult: @unchecked Sendable {
    private let lock = NSLock()
    private var error: Error?
    func capture(_ operation: () throws -> Void) { do { try operation() } catch { lock.lock(); self.error = error; lock.unlock() } }
    func check() throws { lock.lock(); defer { lock.unlock() }; if let error { throw error } }
}

/// Deterministic prepared-response/chunk checks use the exact production send
/// authorization function. No socket timing, test-only production hook or real evidence.
final class VaultResponseFenceTests: XCTestCase {
    private func saved(_ fixture: SyntheticVaultBridge) throws -> VaultRecord {
        var bytes = Data([137,80,78,71,13,10,26,10]); bytes.append(Data(repeating: 7, count: 256 * 1024))
        return try fixture.vault.saveManual(VaultInput(fields: VaultFields(title: "Synthetic creativity", evidenceText: "I did not promise a result. Exact synthetic creativity note.", category: "creativity"),
            media: VaultMedia(filename: "synthetic.png", mimeType: "image/png", sha256: digest(bytes), bytes: bytes)))
    }
    private func prepare(_ service: VaultService, path: String, token: String, body: [String: Any]) async throws -> VaultPreparedResponse {
        let bytes = try JSONSerialization.data(withJSONObject: body)
        let origin = path.hasPrefix("/v2/gallery/") ? "Origin: \(VaultBridgeRequest.origin)\r\n" : ""
        let header = Data("POST \(path) HTTP/1.1\r\nHost: 127.0.0.1:45678\r\n\(origin)Authorization: Bearer \(token)\r\nContent-Type: application/json\r\nContent-Length: \(bytes.count)\r\n\r\n".utf8)
        return try await service.handle(VaultBridgeRequest.parse(header, port: 45678), body: bytes)
    }
    private func gallery(_ fixture: SyntheticVaultBridge) throws -> VaultIssuedClient {
        try fixture.grant(.gallery, scopes: [.savedText, .savedMedia, .galleryReview])
    }

    func testRevocationBetweenChunksStopsPreparedMediaWithoutFallback() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }
        let item = try saved(fixture), client = try gallery(fixture), service = VaultService(vault: fixture.vault)
        let response = try await prepare(service, path: "/v2/gallery/media", token: client.token, body: ["id": item.id, "revision": item.revision])
        XCTAssertGreaterThan(response.data.count, 3 * 64 * 1024)
        var enqueued = Data()
        try service.withAuthorizedResponse(response) { enqueued.append(response.data.prefix(64 * 1024)) }
        try fixture.vault.revokeClient(id: client.grant.id)
        // A fresh narrower grant must not become authority for the old response.
        _ = try fixture.grant(.gallery, scopes: [.savedText])
        XCTAssertThrowsError(try service.withAuthorizedResponse(response) { enqueued.append(response.data.dropFirst(64 * 1024)) })
        XCTAssertEqual(enqueued.count, 64 * 1024)
        XCTAssertThrowsError(try service.withAuthorizedResponse(response) { XCTFail("No cached response fallback") })
    }

    func testDeletionBlocksBothFirstReleaseAndSubsequentMediaChunks() async throws {
        for afterFirstChunk in [false, true] {
            let fixture = try SyntheticVaultBridge(); defer { fixture.close() }
            let item = try saved(fixture), client = try gallery(fixture), service = VaultService(vault: fixture.vault)
            let response = try await prepare(service, path: "/v2/gallery/media", token: client.token, body: ["id": item.id, "revision": item.revision])
            var enqueued = 0
            if afterFirstChunk { try service.withAuthorizedResponse(response) { enqueued += 64 * 1024 } }
            try fixture.vault.delete(id: item.id, revision: item.revision)
            XCTAssertThrowsError(try service.withAuthorizedResponse(response) { enqueued += response.data.count })
            XCTAssertEqual(enqueued, afterFirstChunk ? 64 * 1024 : 0)
            // Permission remains valid: the failure must come from the evidence fence.
            _ = try fixture.vault.validateClient(token: client.token, kind: .gallery, scope: .savedMedia, collectionID: fixture.vault.collectionID)
        }
    }

    func testEditInvalidatesPreparedMediaButFreshResponseKeepsExactBytes() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }
        let item = try saved(fixture), client = try gallery(fixture), service = VaultService(vault: fixture.vault)
        let old = try await prepare(service, path: "/v2/gallery/media", token: client.token, body: ["id": item.id, "revision": item.revision])
        try service.withAuthorizedResponse(old) {}
        var fields = item.fields; fields.evidenceText = "Original statement was not a promise. Owner's exact replacement."
        let edited = try fixture.vault.edit(id: item.id, revision: item.revision, fields: fields)
        XCTAssertThrowsError(try service.withAuthorizedResponse(old) { XCTFail("Stale media response released") })
        let fresh = try await prepare(service, path: "/v2/gallery/media", token: client.token, body: ["id": edited.id, "revision": edited.revision])
        try service.withAuthorizedResponse(fresh) {
            XCTAssertEqual(try JSONDecoder().decode(VaultMedia.self, from: fresh.data).bytes,
                try fixture.vault.media(id: edited.id, revision: edited.revision).bytes)
        }
    }

    func testPendingApprovalInvalidatesPreparedReviewState() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }
        let pending = try fixture.stage(), client = try gallery(fixture), service = VaultService(vault: fixture.vault)
        let response = try await prepare(service, path: "/v2/gallery/list", token: client.token, body: ["state": "pending"])
        XCTAssertThrowsError(try fixture.vault.metadata(id: pending.id, revision: pending.revision, state: .saved))
        try service.withAuthorizedResponse(response) {}
        var fields = pending.fields; fields.category = "creativity"
        _ = try fixture.vault.approve(id: pending.id, revision: pending.revision, fields: fields)
        XCTAssertThrowsError(try service.withAuthorizedResponse(response) { XCTFail("Former pending-state snapshot released") })
    }

    func testAssistantGetAndSearchRemainBoundToSavedRevisions() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }
        let item = try saved(fixture), client = try fixture.grant(.assistant, scopes: [.savedText]), service = VaultService(vault: fixture.vault)
        let get = try await prepare(service, path: "/v2/assistant/get", token: client.token, body: ["id": item.id])
        let search = try await prepare(service, path: "/v2/assistant/search", token: client.token, body: ["query": "creativity", "limit": 3])
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: search.data) as? [String: Any])
        XCTAssertEqual((result["items"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual(Set(result.keys), ["collectionID", "items", "matching", "hasMore", "searchedCount", "searchScope"])
        try fixture.vault.delete(id: item.id, revision: item.revision)
        XCTAssertThrowsError(try service.withAuthorizedResponse(get) { XCTFail("Deleted note released") })
        XCTAssertThrowsError(try service.withAuthorizedResponse(search) { XCTFail("Deleted search snapshot released") })
    }

    func testResponseChecksAndSendEnqueueSerializeAgainstRevocation() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }
        let item = try saved(fixture), client = try gallery(fixture), service = VaultService(vault: fixture.vault)
        let response = try await prepare(service, path: "/v2/gallery/media", token: client.token, body: ["id": item.id, "revision": item.revision])
        let attempting = DispatchSemaphore(value: 0), finished = DispatchSemaphore(value: 0)
        let result = FenceMutationResult(), vault = fixture.vault
        try service.withAuthorizedResponse(response) {
            DispatchQueue.global().async {
                attempting.signal()
                result.capture { try vault.revokeClient(id: client.grant.id) }
                finished.signal()
            }
            XCTAssertEqual(attempting.wait(timeout: .now() + 3), .success)
            XCTAssertEqual(finished.wait(timeout: .now()), .timedOut, "Revocation must serialize after this already-authorized enqueue")
        }
        XCTAssertEqual(finished.wait(timeout: .now() + 3), .success)
        try result.check()
        XCTAssertThrowsError(try service.withAuthorizedResponse(response) { XCTFail("New chunk after completed revocation") })
    }

    func testMissingMediaOrReviewScopeCannotPrepareAttachmentBytes() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }
        let item = try saved(fixture), service = VaultService(vault: fixture.vault)
        for scopes: [VaultClientScope] in [[.savedText, .galleryReview], [.savedText, .savedMedia]] {
            let client = try fixture.grant(.gallery, scopes: scopes)
            do {
                _ = try await prepare(service, path: "/v2/gallery/media", token: client.token, body: ["id": item.id, "revision": item.revision])
                XCTFail("Missing route scope prepared media")
            } catch { XCTAssertTrue(error is VaultError) }
        }
    }
}
