import XCTest
import CompanionCore
import CompanionVault
@testable import ProofPhotosCompanion

private final class BridgeReadyOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var returned = false
    func claim() -> Bool { lock.lock(); defer { lock.unlock() }; if returned { return false }; returned = true; return true }
}

final class SyntheticVaultBridge {
    let root: URL
    let vault: ProofVault
    let bridge: VaultBridge
    var port: UInt16 = 0
    init() throws {
        root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("proof-bridge-synthetic-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        vault = try ProofVault(directory: root.appendingPathComponent("vault"), collectionID: UUID().uuidString)
        bridge = VaultBridge(vault: vault)
    }
    func start() async throws {
        let ready = BridgeReadyOnce()
        let port: UInt16? = await withCheckedContinuation { continuation in
            bridge.start { value in if ready.claim() { continuation.resume(returning: value) } }
        }
        self.port = try XCTUnwrap(port)
    }
    func close() { bridge.stop(); try? FileManager.default.removeItem(at: root) }
    func grant(_ kind: VaultClientKind, scopes: [VaultClientScope]) throws -> VaultIssuedClient {
        try vault.issueClient(kind: kind, scopes: scopes, expiresAt: Date().addingTimeInterval(300))
    }
    func request(_ path: String, token: String, body: [String: Any], origin: String? = nil) async throws -> (Int, Data, HTTPURLResponse) {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)\(path)")!)
        request.httpMethod = "POST"; request.timeoutInterval = 10
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let origin { request.setValue(origin, forHTTPHeaderField: "Origin") }
        let session = URLSession(configuration: .ephemeral); defer { session.invalidateAndCancel() }
        let (bytes, response) = try await session.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        return (http.statusCode, bytes, http)
    }
    func input() -> VaultInput {
        let bytes = Data([137,80,78,71,13,10,26,10,4])
        return VaultInput(fields: VaultFields(evidenceText: "I did not promise a result. Synthetic creativity evidence.", occurredOn: "2026-08-03", source: "Literal synthetic source"),
            media: VaultMedia(filename: "synthetic.png", mimeType: "image/png", sha256: digest(bytes), bytes: bytes),
            receipt: VaultProviderReceipt(provider: .folder, sourceID: "synthetic-folder", originalFilename: "synthetic.png", originalSha256: digest(bytes), scope: "Selected synthetic folder"))
    }
    func stage() throws -> VaultRecord {
        let grant = try vault.createSourceGrant(VaultSourceConfiguration(provider: .folder, sourceID: "synthetic-folder", label: "Synthetic"))
        _ = try vault.ingest(sourceGrantID: grant.id, revision: grant.revision, inputs: [input()])
        return try XCTUnwrap(vault.list(state: .pending).first)
    }
    func json<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) }
}

final class VaultBridgeTests: XCTestCase {
    func testSameStorePendingApprovalSavedGetSearchAndExactMedia() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }; try await fixture.start()
        let gallery = try fixture.grant(.gallery, scopes: [.savedText, .savedMedia, .galleryReview])
        let assistant = try fixture.grant(.assistant, scopes: [.savedText])
        let pending = try fixture.stage()
        let hidden = try await fixture.request("/v2/assistant/get", token: assistant.token, body: ["id": pending.id])
        XCTAssertNotEqual(hidden.0, 200); XCTAssertTrue(hidden.1.isEmpty)
        let review = try await fixture.request("/v2/gallery/list", token: gallery.token, body: ["state": "pending"], origin: VaultBridgeRequest.origin)
        XCTAssertEqual(review.0, 200)
        let reviewJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: review.1) as? [String: Any])
        XCTAssertEqual((reviewJSON["items"] as? [[String: Any]])?.count, 1)
        var fields = pending.fields; fields.category = "creativity"
        let approval = try await fixture.request("/v2/gallery/approve", token: gallery.token,
            body: ["id": pending.id, "revision": pending.revision, "fields": try fixture.json(fields)], origin: VaultBridgeRequest.origin)
        XCTAssertEqual(approval.0, 200)
        let saved = try XCTUnwrap(fixture.vault.list(state: .saved).first)
        XCTAssertEqual(saved.fields.evidenceText, pending.fields.evidenceText)
        XCTAssertEqual(saved.receipt, pending.receipt)
        let get = try await fixture.request("/v2/assistant/get", token: assistant.token, body: ["id": saved.id])
        XCTAssertEqual(get.0, 200)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: get.1) as? [String: Any])
        let exact = try JSONDecoder().decode(VaultRecord.self, from: JSONSerialization.data(withJSONObject: try XCTUnwrap(object["item"])))
        XCTAssertEqual(exact, saved)
        let search = try await fixture.request("/v2/assistant/search", token: assistant.token, body: ["query": "synthetic creativity", "limit": 3])
        XCTAssertEqual(search.0, 200)
        let searchJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: search.1) as? [String: Any])
        XCTAssertEqual((searchJSON["items"] as? [[String: Any]])?.first?["id"] as? String, saved.id)
        XCTAssertTrue(["local-semantic", "local-literal-text"].contains(searchJSON["matching"] as? String ?? ""))
        let media = try await fixture.request("/v2/gallery/media", token: gallery.token, body: ["id": saved.id, "revision": saved.revision], origin: VaultBridgeRequest.origin)
        XCTAssertEqual(media.0, 200)
        XCTAssertEqual(try JSONDecoder().decode(VaultMedia.self, from: media.1), fixture.input().media)
        XCTAssertEqual(media.2.value(forHTTPHeaderField: "Cache-Control"), "no-store")
        XCTAssertNil(get.2.value(forHTTPHeaderField: "Access-Control-Allow-Origin"))
    }

    func testKindOriginScopeRevocationAndNoAssistantMutationRoutes() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }; try await fixture.start()
        let gallery = try fixture.grant(.gallery, scopes: [.savedText, .galleryReview])
        let assistant = try fixture.grant(.assistant, scopes: [.savedText])
        let pending = try fixture.stage()
        let attacks: [(String, String, String?)] = [
            ("/v2/gallery/list", assistant.token, VaultBridgeRequest.origin),
            ("/v2/assistant/get", gallery.token, nil),
            ("/v2/gallery/list", gallery.token, "https://evil.example"),
            ("/v2/assistant/get", assistant.token, VaultBridgeRequest.origin),
            ("/v2/assistant/delete", assistant.token, nil),
            ("/v2/assistant/approve", assistant.token, nil),
        ]
        for (path, token, origin) in attacks {
            let result = try await fixture.request(path, token: token, body: ["id": pending.id, "state": "pending"], origin: origin)
            XCTAssertEqual(result.0, 403, path)
            XCTAssertTrue(result.1.isEmpty)
        }
        let noMedia = try await fixture.request("/v2/gallery/media", token: gallery.token, body: ["id": pending.id, "revision": pending.revision], origin: VaultBridgeRequest.origin)
        XCTAssertEqual(noMedia.0, 403)
        try fixture.vault.revokeClient(id: gallery.grant.id)
        let revoked = try await fixture.request("/v2/gallery/list", token: gallery.token, body: ["state": "pending"], origin: VaultBridgeRequest.origin)
        XCTAssertEqual(revoked.0, 403)
        XCTAssertEqual(try fixture.vault.list(state: .pending).count, 1)
        XCTAssertTrue(try fixture.vault.list(state: .saved).isEmpty)
    }

    func testStaleEditDeleteAndMediaAreFenced() async throws {
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }; try await fixture.start()
        let gallery = try fixture.grant(.gallery, scopes: [.savedText, .savedMedia, .galleryReview])
        let pending = try fixture.stage()
        var fields = pending.fields; fields.category = "creativity"
        let saved = try fixture.vault.approve(id: pending.id, revision: pending.revision, fields: fields)
        fields.evidenceText = "Literal owner edit."
        _ = try fixture.vault.edit(id: saved.id, revision: saved.revision, fields: fields)
        for path in ["edit", "delete", "media"] {
            var body: [String: Any] = ["id": saved.id, "revision": saved.revision]
            if path == "edit" { body["fields"] = try fixture.json(fields) }
            let result = try await fixture.request("/v2/gallery/" + path, token: gallery.token, body: body, origin: VaultBridgeRequest.origin)
            XCTAssertEqual(result.0, 409, path)
            XCTAssertTrue(result.1.isEmpty)
        }
        XCTAssertEqual(try fixture.vault.list(state: .saved).first?.fields.evidenceText, "Literal owner edit.")
    }
}
