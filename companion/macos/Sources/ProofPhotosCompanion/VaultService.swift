import Foundation
import CompanionCore
import CompanionVault
import CompanionIntelligence

/// No source/grant/reminder management routes. Native owner actions alone
/// create grants; browser and assistant permissions are different kinds.
final class VaultService: @unchecked Sendable {
    private let vault: ProofVault
    private let intelligence = EvidenceIntelligence()
    init(vault: ProofVault) { self.vault = vault }
    func authorize(_ request: VaultBridgeRequest) throws {
        _ = try vault.validateClient(token: request.token, kind: request.gallery ? .gallery : .assistant,
                                     scope: .savedText, collectionID: vault.collectionID)
    }
    private struct ListInput: Decodable {
        var state: VaultState; var limit: Int?; var offset: Int?
        var category: String?; var tag: String?; var query: String?
    }
    private struct EditInput: Decodable { var id: String; var revision: String; var fields: VaultFields }
    private struct IDInput: Decodable { var id: String; var revision: String }
    private struct CreateInput: Decodable { var input: VaultInput }
    private struct SearchInput: Decodable { var query: String; var category: String?; var tag: String?; var limit: Int? }
    private struct GetInput: Decodable { var id: String }
    private struct ItemResult: Encodable { var item: VaultRecord }
    private struct ListResult: Encodable {
        var collectionID: String; var items: [VaultRecord]; var matching: String
        var hasMore: Bool; var searchedCount: Int?; var searchScope: String?
    }
    private struct Info: Encodable {
        var version = 2; var collectionID: String; var grantID: String
        var expiresAt: String; var scopes: [VaultClientScope]
    }
    private func encode<T: Encodable>(_ value: T) throws -> Data { try JSONEncoder().encode(value) }
    private func decode<T: Decodable>(_ value: T.Type, body: Data, keys: Set<String>) throws -> T {
        guard let object = try JSONSerialization.jsonObject(with: body) as? [String: Any],
              Set(object.keys).isSubset(of: keys) else { throw VaultError.invalid }
        return try JSONDecoder().decode(value, from: body)
    }
    private func allowedEmpty(_ body: Data) throws {
        guard let object = try JSONSerialization.jsonObject(with: body) as? [String: Any], object.isEmpty else { throw VaultError.invalid }
    }
    private func authorized<T>(_ request: VaultBridgeRequest, scope: VaultClientScope, _ operation: () throws -> T) throws -> T {
        try Task.checkCancellation()
        return try vault.withClient(token: request.token, kind: request.gallery ? .gallery : .assistant,
                             scope: scope, collectionID: vault.collectionID, operation: operation)
    }
    private func filter(_ items: [VaultRecord], category: String?, tag: String?) throws -> [VaultRecord] {
        let categories = ["belonging", "competence", "creativity", "parenting", "recovery", "money", "shipped", "awards", "kindness_received"]
        guard category == nil || categories.contains(category!), tag == nil || (!tag!.isEmpty && tag!.utf8.count <= 100) else { throw VaultError.invalid }
        return items.filter { (category == nil || $0.fields.category == category) && (tag == nil || $0.fields.tags.contains(tag!)) }
    }
    private func all(_ state: VaultState) throws -> [VaultRecord] {
        var items: [VaultRecord] = []
        for offset in stride(from: 0, through: 10_000, by: 100) {
            let page = try vault.list(state: state, limit: 100, offset: offset)
            items.append(contentsOf: page)
            if page.count < 100 { break }
        }
        return items
    }
    func handle(_ request: VaultBridgeRequest, body: Data) async throws -> Data {
        try Task.checkCancellation()
        _ = try authorized(request, scope: .savedText) { true }
        switch request.path {
        case "/v2/gallery/info":
            try allowedEmpty(body)
            return try authorized(request, scope: .savedText) {
                let grant = try vault.validateClient(token: request.token, kind: .gallery, scope: .savedText, collectionID: vault.collectionID)
                return try encode(Info(collectionID: vault.collectionID, grantID: grant.id, expiresAt: grant.expiresAt, scopes: grant.scopes))
            }
        case "/v2/assistant/get":
            let input = try decode(GetInput.self, body: body, keys: ["id"])
            return try encode(ItemResult(item: vault.get(token: request.token, collectionID: vault.collectionID, id: input.id)))
        case "/v2/assistant/search":
            let input = try decode(SearchInput.self, body: body, keys: ["query", "category", "tag", "limit"])
            return try await search(request, query: input.query, category: input.category, tag: input.tag, limit: input.limit ?? 6)
        case "/v2/gallery/list":
            let input = try decode(ListInput.self, body: body, keys: ["state", "limit", "offset", "category", "tag", "query"])
            guard (1...100).contains(input.limit ?? 100), (0...10_000).contains(input.offset ?? 0) else { throw VaultError.invalid }
            if let query = input.query, !query.isEmpty {
                guard input.state == .saved else { throw VaultError.invalid }
                return try await search(request, query: query, category: input.category, tag: input.tag, limit: min(10, max(3, input.limit ?? 6)))
            }
            return try authorized(request, scope: input.state == .saved ? .savedText : .galleryReview) {
                let records = try filter(all(input.state), category: input.category, tag: input.tag)
                let offset = input.offset ?? 0, limit = input.limit ?? 100
                return try encode(ListResult(collectionID: vault.collectionID, items: Array(records.dropFirst(offset).prefix(limit)), matching: "newest", hasMore: records.count > offset + limit))
            }
        case "/v2/gallery/create":
            let input = try decode(CreateInput.self, body: body, keys: ["input"]).input
            // Only the native collector can attest provider receipts.
            guard input.receipt == nil, input.provenance.isEmpty else { throw VaultError.invalid }
            return try authorized(request, scope: .galleryReview) { try encode(ItemResult(item: vault.saveManual(input))) }
        case "/v2/gallery/edit", "/v2/gallery/approve":
            let input = try decode(EditInput.self, body: body, keys: ["id", "revision", "fields"])
            return try authorized(request, scope: .galleryReview) {
                let item = request.path.hasSuffix("/approve") ? try vault.approve(id: input.id, revision: input.revision, fields: input.fields) : try vault.edit(id: input.id, revision: input.revision, fields: input.fields)
                return try encode(ItemResult(item: item))
            }
        case "/v2/gallery/delete":
            let input = try decode(IDInput.self, body: body, keys: ["id", "revision"])
            return try authorized(request, scope: .galleryReview) {
                try vault.delete(id: input.id, revision: input.revision); return Data("{\"deleted\":true}".utf8)
            }
        case "/v2/gallery/media":
            let input = try decode(IDInput.self, body: body, keys: ["id", "revision"])
            return try authorized(request, scope: .savedMedia) {
                try authorized(request, scope: .galleryReview) { try encode(vault.media(id: input.id, revision: input.revision)) }
            }
        default: throw VaultError.forbidden
        }
    }
    private func search(_ request: VaultBridgeRequest, query: String, category: String?, tag: String?, limit: Int) async throws -> Data {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, query.utf8.count <= 500, (3...10).contains(limit) else { throw VaultError.invalid }
        let filtered = try authorized(request, scope: .savedText) { try filter(all(.saved), category: category, tag: tag) }
        let snapshot = Array(filtered.prefix(100))
        var ranked = [String](), matching = "local-literal-text"
        func indexText(_ record: VaultRecord) -> String {
            ([record.fields.title, record.fields.evidenceText, record.fields.person ?? "", record.fields.project ?? "", record.fields.source ?? "", record.receipt?.originalFilename ?? ""] + record.fields.tags).joined(separator: "\n")
        }
        if !snapshot.isEmpty {
            // Bound ranking text only; returned evidence remains complete.
            let sources = snapshot.map { ["id": $0.id, "revision": $0.revision, "text": String(indexText($0).prefix(1100))] }
            do {
                let data = try JSONSerialization.data(withJSONObject: ["query": query, "sources": sources])
                let input = try JSONDecoder().decode(EvidenceRequest.self, from: data)
                ranked = try await intelligence.search(input).ids
                matching = "local-semantic"
            } catch {
                try Task.checkCancellation()
                let stop = Set(["show", "me", "proof", "evidence", "of", "for", "the", "a", "an", "i", "am", "is", "my", "that", "to"])
                let words = Set(query.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)).subtracting(stop)
                ranked = snapshot.enumerated().compactMap { index, item -> (String, Int, Int)? in
                    let text = indexText(item).lowercased()
                    let score = words.filter { text.contains($0) }.count
                    return score > 0 ? (item.id, score, index) : nil
                }.sorted { $0.1 == $1.1 ? $0.2 < $1.2 : $0.1 > $1.1 }.prefix(limit).map { $0.0 }
            }
        }
        try Task.checkCancellation()
        // Revalidate authority and each saved revision after the embedding await.
        return try authorized(request, scope: .savedText) {
            let current = try all(.saved)
            var selected = ranked.prefix(limit).compactMap { id in
                current.first { item in item.id == id && snapshot.contains { old in old.id == id && old.revision == item.revision } }
            }
            func result() throws -> Data { try encode(ListResult(collectionID: vault.collectionID, items: selected, matching: matching, hasMore: filtered.count > snapshot.count, searchedCount: snapshot.count, searchScope: "newest-100-filtered-saved")) }
            var data = try result()
            while data.count > ProofMCPProtocol.maximumTextResponseBytes && !selected.isEmpty { selected.removeLast(); data = try result() }
            return data
        }
    }
}
