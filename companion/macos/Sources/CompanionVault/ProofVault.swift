import Foundation
import Security
import CompanionCore

/// One account-local authority. Permissions protect against other OS accounts,
/// not software running as this same user. Active storage is not encrypted.
public final class ProofVault: VaultAuthority, @unchecked Sendable {
    public let collectionID: String
    private let db: VaultDatabase
    private let lock = NSRecursiveLock()
    private let clock: () -> Date
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(directory: URL, collectionID: String, now: @escaping () -> Date = Date.init) throws {
        guard UUID(uuidString: collectionID) != nil else { throw VaultError.invalid }
        self.collectionID = collectionID; self.clock = now
        self.db = try VaultDatabase(directory: directory)
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try transaction {
            let rows = try db.rows("SELECT value FROM metadata WHERE key='collection'")
            if let data = rows.first?.first ?? nil {
                guard String(data: data, encoding: .utf8) == collectionID else { throw VaultError.forbidden }
            } else { try db.run("INSERT INTO metadata VALUES ('collection', ?)", [.text(collectionID)]) }
            let version = try db.rows("SELECT value FROM metadata WHERE key='version'").first?.first ?? nil
            if let version { guard String(data: version, encoding: .utf8) == "1" else { throw VaultError.unavailable } }
            else { try db.run("INSERT INTO metadata VALUES ('version','1')") }
        }
    }
    private func serialized<T>(_ operation: () throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }; return try operation()
    }
    private func transaction<T>(_ operation: () throws -> T) throws -> T {
        try serialized {
            try db.run("BEGIN IMMEDIATE")
            do { let result = try operation(); try db.run("COMMIT"); return result }
            catch { try? db.run("ROLLBACK"); throw error }
        }
    }
    private func decode<T: Decodable>(_ type: T.Type, _ rows: [[Data?]]) throws -> [T] {
        try rows.map { row in guard let bytes = row.first ?? nil else { throw VaultError.storage }; return try decoder.decode(type, from: bytes) }
    }
    private func source(_ id: String, revision: String? = nil) throws -> VaultSourceGrant {
        guard let grant = try decode(VaultSourceGrant.self, db.rows("SELECT body FROM sources WHERE id=?", [.text(id)])).first else { throw VaultError.forbidden }
        if let revision, revision != grant.revision { throw VaultError.staleRevision }
        return grant
    }
    private func putSource(_ grant: VaultSourceGrant) throws {
        try db.run("INSERT OR REPLACE INTO sources VALUES (?,?)", [.text(grant.id), .blob(try encoder.encode(grant))])
    }
    public func sourceGrants() throws -> [VaultSourceGrant] {
        try serialized { try decode(VaultSourceGrant.self, db.rows("SELECT body FROM sources ORDER BY id")) }
    }
    public func createSourceGrant(_ configuration: VaultSourceConfiguration) throws -> VaultSourceGrant {
        try VaultValidation.configuration(configuration)
        return try transaction {
            guard try sourceGrants().count < 100 else { throw VaultError.capacity }
            let grant = VaultSourceGrant(id: UUID().uuidString, revision: UUID().uuidString,
                configuration: configuration, approvedAt: isoTimestamp(clock()), paused: false, revoked: false)
            try putSource(grant); return grant
        }
    }
    public func updateSourceGrant(id: String, revision: String, configuration: VaultSourceConfiguration, paused: Bool) throws -> VaultSourceGrant {
        try VaultValidation.configuration(configuration)
        return try transaction {
            let current = try source(id, revision: revision)
            guard !current.revoked, current.configuration.provider == configuration.provider,
                  current.configuration.sourceID == configuration.sourceID else { throw VaultError.forbidden }
            let next = VaultSourceGrant(id: id, revision: UUID().uuidString, configuration: configuration,
                approvedAt: isoTimestamp(clock()), paused: paused, revoked: false)
            try putSource(next); return next
        }
    }
    public func pauseSource(id: String, revision: String) throws -> VaultSourceGrant {
        try transaction {
            let current = try source(id, revision: revision)
            guard !current.revoked else { throw VaultError.forbidden }
            let next = VaultSourceGrant(id: id, revision: UUID().uuidString, configuration: current.configuration,
                approvedAt: current.approvedAt, paused: true, revoked: false)
            try putSource(next); return next
        }
    }
    public func revokeSource(id: String, revision: String) throws {
        try transaction {
            let current = try source(id, revision: revision)
            // Forget the adapter bookmark/selection immediately, retain only identity/dedupe.
            var config = current.configuration; config.selection = [:]; config.backgroundEnabled = false
            try putSource(VaultSourceGrant(id: id, revision: UUID().uuidString, configuration: config,
                approvedAt: current.approvedAt, paused: true, revoked: true))
        }
    }
    public func hasHandled(sourceGrantID: String, sha256: String) throws -> Bool {
        try VaultValidation.hash(sha256)
        return try serialized {
            _ = try source(sourceGrantID)
            return try !db.rows("SELECT digest FROM handled WHERE source_id=? AND digest=? UNION SELECT digest FROM tombstones WHERE digest=?", [.text(sourceGrantID), .text(sha256), .text(sha256)]).isEmpty
        }
    }
    private func record(_ id: String, revision: String? = nil) throws -> VaultRecord {
        guard let record = try decode(VaultRecord.self, db.rows("SELECT record FROM records WHERE id=?", [.text(id)])).first,
              record.collectionID == collectionID else { throw VaultError.forbidden }
        if let revision, revision != record.revision { throw VaultError.staleRevision }
        return record
    }
    private func put(_ item: VaultRecord, bytes: Data? = nil, insert: Bool = false) throws {
        if insert {
            try db.run("INSERT INTO records VALUES (?,?,?,?)", [.text(item.id), .text(item.state.rawValue), .blob(try encoder.encode(item)), bytes.map(SQLValue.blob) ?? .null])
        } else { try db.run("UPDATE records SET state=?, record=? WHERE id=?", [.text(item.state.rawValue), .blob(try encoder.encode(item)), .text(item.id)]) }
    }
    private func capacity() throws {
        for state in [VaultState.saved, .pending] {
            let rows = try db.rows("SELECT COUNT(*), COALESCE(SUM(length(media)),0), COALESCE(SUM(length(record)),0) FROM records WHERE state=?", [.text(state.rawValue)])
            let values = rows[0].map { Int(String(data: $0 ?? Data(), encoding: .utf8) ?? "") ?? Int.max }
            guard values[0] <= (state == .saved ? 10_000 : 100), values[1] <= 48 * 1024 * 1024,
                  values[2] <= 16 * 1024 * 1024 else { throw VaultError.capacity }
        }
        let count = try db.rows("SELECT COUNT(*) FROM handled")[0][0]!
        guard (Int(String(data: count, encoding: .utf8) ?? "") ?? Int.max) <= 100_000 else { throw VaultError.capacity }
    }
    private func make(_ input: VaultInput, state: VaultState, approval: VaultApproval?) -> VaultRecord {
        let date = isoTimestamp(clock())
        let media = input.media.map { VaultMediaDescriptor(filename: $0.filename, mimeType: $0.mimeType, sha256: $0.sha256, size: $0.bytes.count) }
        return VaultRecord(id: UUID().uuidString, collectionID: collectionID, revision: UUID().uuidString, state: state,
            fields: input.fields, media: media, receipt: input.receipt, provenance: input.provenance,
            approval: approval, createdAt: date, updatedAt: date)
    }
    public func ingest(sourceGrantID: String, revision: String, inputs: [VaultInput], background: Bool = false,
                       isCancelled: () -> Bool = { false }) throws -> VaultIngestResult {
        guard !inputs.isEmpty, inputs.count <= 50, inputs.reduce(0, { $0 + ($1.media?.bytes.count ?? 0) }) <= 47 * 1024 * 1024 else { throw VaultError.capacity }
        for input in inputs { try VaultValidation.input(input, saved: false) }
        return try transaction {
            let grant = try source(sourceGrantID, revision: revision)
            guard !grant.paused, !grant.revoked, !background || grant.configuration.backgroundEnabled else { throw VaultError.forbidden }
            var pending = 0, saved = 0, duplicates = 0
            for var input in inputs {
                guard !isCancelled() else { throw VaultError.unavailable }
                guard let media = input.media, let receipt = input.receipt,
                      receipt.provider == grant.configuration.provider, receipt.sourceID == grant.configuration.sourceID else { throw VaultError.forbidden }
                let hashes = Set([media.sha256, receipt.originalSha256])
                var handled = false
                for hash in hashes { if try hasHandled(sourceGrantID: sourceGrantID, sha256: hash) { handled = true } }
                // Same content cannot occupy pending and saved simultaneously, even across sources.
                let existing = try decode(VaultRecord.self, db.rows("SELECT record FROM records"))
                if existing.contains(where: { hashes.contains($0.media?.sha256 ?? "") || hashes.contains($0.receipt?.originalSha256 ?? "") }) { handled = true }
                for hash in hashes { try db.run("INSERT OR IGNORE INTO handled VALUES (?,?)", [.text(sourceGrantID), .text(hash)]) }
                if handled { duplicates += 1; continue }
                let trusted = grant.configuration.mode == .trusted
                if trusted {
                    // Automation cannot add model/generated words or organization.
                    input.fields = VaultFields(occurredOn: input.fields.occurredOn, category: grant.configuration.category,
                        sourceType: "photo", source: grant.configuration.label, tags: grant.configuration.tags)
                }
                try VaultValidation.input(input, saved: trusted)
                let approval = trusted ? VaultApproval(method: "trusted-source", approvedAt: grant.approvedAt,
                    sourceGrantID: grant.id, sourceGrantRevision: grant.revision) : nil
                let item = make(input, state: trusted ? .saved : .pending, approval: approval)
                try put(item, bytes: media.bytes, insert: true)
                if trusted { saved += 1 } else { pending += 1 }
            }
            try capacity()
            guard !isCancelled() else { throw VaultError.unavailable }
            return VaultIngestResult(pending: pending, saved: saved, duplicates: duplicates)
        }
    }
    public func list(state: VaultState, limit: Int = 100, offset: Int = 0) throws -> [VaultRecord] {
        guard (1...100).contains(limit), offset >= 0, offset <= 10_000 else { throw VaultError.invalid }
        return try serialized { try decode(VaultRecord.self, db.rows("SELECT record FROM records WHERE state=? ORDER BY rowid DESC LIMIT ? OFFSET ?", [.text(state.rawValue), .integer(Int64(limit)), .integer(Int64(offset))])) }
    }
    public func saveManual(_ input: VaultInput) throws -> VaultRecord { try addManual(input, saved: true) }
    public func stageManual(_ input: VaultInput) throws -> VaultRecord { try addManual(input, saved: false) }
    private func addManual(_ input: VaultInput, saved: Bool) throws -> VaultRecord {
        try VaultValidation.input(input, saved: saved)
        return try transaction {
            let approval = saved ? VaultApproval(method: "manual", approvedAt: isoTimestamp(clock()), sourceGrantID: nil, sourceGrantRevision: nil) : nil
            let item = make(input, state: saved ? .saved : .pending, approval: approval)
            try put(item, bytes: input.media?.bytes, insert: true); try capacity(); return item
        }
    }
    private func changed(_ current: VaultRecord, fields: VaultFields, state: VaultState, approval: VaultApproval?) -> VaultRecord {
        VaultRecord(id: current.id, collectionID: collectionID, revision: UUID().uuidString, state: state, fields: fields,
            media: current.media, receipt: current.receipt, provenance: current.provenance, approval: approval,
            createdAt: current.createdAt, updatedAt: isoTimestamp(clock()))
    }
    public func edit(id: String, revision: String, fields: VaultFields) throws -> VaultRecord {
        try transaction {
            let current = try record(id, revision: revision); try VaultValidation.fields(fields, saved: current.state == .saved)
            guard current.media != nil || !fields.evidenceText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw VaultError.invalid }
            let next = changed(current, fields: fields, state: current.state, approval: current.approval)
            try put(next); try capacity(); return next
        }
    }
    public func approve(id: String, revision: String, fields: VaultFields) throws -> VaultRecord {
        try transaction {
            let current = try record(id, revision: revision)
            guard current.state == .pending else { throw VaultError.staleRevision }
            try VaultValidation.fields(fields, saved: true)
            guard current.media != nil || !fields.evidenceText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw VaultError.invalid }
            let next = changed(current, fields: fields, state: .saved,
                approval: VaultApproval(method: "manual-review", approvedAt: isoTimestamp(clock()), sourceGrantID: nil, sourceGrantRevision: nil))
            try put(next); try capacity(); return next
        }
    }
    public func delete(id: String, revision: String) throws {
        try transaction {
            let current = try record(id, revision: revision)
            for hash in Set([current.media?.sha256, current.receipt?.originalSha256].compactMap({ $0 })) {
                try db.run("INSERT OR IGNORE INTO tombstones VALUES (?)", [.text(hash)])
            }
            try db.run("DELETE FROM records WHERE id=?", [.text(id)])
        }
    }
    public func clear() throws {
        try transaction {
            for item in try decode(VaultRecord.self, db.rows("SELECT record FROM records")) {
                for hash in Set([item.media?.sha256, item.receipt?.originalSha256].compactMap({ $0 })) {
                    try db.run("INSERT OR IGNORE INTO tombstones VALUES (?)", [.text(hash)])
                }
            }
            try db.run("DELETE FROM records"); try db.run("DELETE FROM sources"); try db.run("DELETE FROM clients")
            try db.run("DELETE FROM reminder")
            // Retain digests and consumed claims: Clear cannot reconnect or resurrect.
        }
    }

    public func clientGrants() throws -> [VaultClientGrant] {
        try serialized { try decode(VaultClientGrant.self, db.rows("SELECT body FROM clients ORDER BY id")) }
    }
    public func issueClient(kind: VaultClientKind, scopes: [VaultClientScope], expiresAt: Date) throws -> VaultIssuedClient {
        guard !scopes.isEmpty, Set(scopes).count == scopes.count,
              kind != .assistant || !scopes.contains(.galleryReview), scopes.contains(.savedText),
              expiresAt > clock(), expiresAt.timeIntervalSince(clock()) <= 30 * 24 * 3600 else { throw VaultError.invalid }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw VaultError.unavailable }
        let token = bytes.map { String(format: "%02x", $0) }.joined()
        return try transaction {
            guard try clientGrants().count < 100 else { throw VaultError.capacity }
            let grant = VaultClientGrant(id: UUID().uuidString, collectionID: collectionID, kind: kind, scopes: scopes,
                expiresAt: isoTimestamp(expiresAt), revoked: false)
            try db.run("INSERT INTO clients VALUES (?,?,?)", [.text(grant.id), .text(digest(Data(token.utf8))), .blob(try encoder.encode(grant))])
            return VaultIssuedClient(grant: grant, token: token)
        }
    }
    public func revokeClient(id: String) throws {
        try transaction { try db.run("DELETE FROM clients WHERE id=?", [.text(id)]) }
    }
    public func validateClient(token: String, kind: VaultClientKind, scope: VaultClientScope, collectionID: String) throws -> VaultClientGrant {
        try serialized {
            guard token.count == 64, token.allSatisfy({ "0123456789abcdef".contains($0) }), collectionID == self.collectionID else { throw VaultError.forbidden }
            guard let grant = try decode(VaultClientGrant.self, db.rows("SELECT body FROM clients WHERE hash=?", [.text(digest(Data(token.utf8)))])).first,
                  grant.kind == kind, !grant.revoked, grant.collectionID == collectionID, grant.scopes.contains(scope) else { throw VaultError.forbidden }
            let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let expiry = f.date(from: grant.expiresAt), clock() < expiry else { throw VaultError.forbidden }
            return grant
        }
    }
    public func withClient<T>(token: String, kind: VaultClientKind, scope: VaultClientScope, collectionID: String,
                              operation: () throws -> T) throws -> T {
        try serialized {
            _ = try validateClient(token: token, kind: kind, scope: scope, collectionID: collectionID)
            return try operation()
        }
    }
    public func search(token: String, collectionID: String, query: VaultQuery) throws -> VaultSearchResult {
        try VaultValidation.text(query.text, max: 500, empty: false)
        guard (3...10).contains(query.limit), query.category == nil || VaultValidation.categories.contains(query.category!) else { throw VaultError.invalid }
        if let tag = query.tag { try VaultValidation.text(tag, max: 100, empty: false) }
        return try withClient(token: token, kind: .assistant, scope: .savedText, collectionID: collectionID) {
            let terms = query.text.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
            guard !terms.isEmpty else { throw VaultError.invalid }
            let records = try decode(VaultRecord.self, db.rows("SELECT record FROM records WHERE state='saved' ORDER BY rowid DESC"))
            let matched = records.filter { item in
                guard item.approval != nil, item.collectionID == collectionID,
                      query.category == nil || item.fields.category == query.category,
                      query.tag == nil || item.fields.tags.contains(query.tag!) else { return false }
                let text = ([item.fields.title, item.fields.evidenceText, item.fields.source ?? "", item.fields.person ?? "", item.fields.project ?? ""] + item.fields.tags).joined(separator: "\n").lowercased()
                return terms.allSatisfy { text.contains($0) }
            }
            return VaultSearchResult(matching: "local-literal-text", items: Array(matched.prefix(query.limit)))
        }
    }
    public func get(token: String, collectionID: String, id: String) throws -> VaultRecord {
        try withClient(token: token, kind: .assistant, scope: .savedText, collectionID: collectionID) {
            let item = try record(id); guard item.state == .saved, item.approval != nil else { throw VaultError.forbidden }; return item
        }
    }
    /// In-process owner/gallery access, never an unauthenticated network route.
    public func media(id: String, revision: String) throws -> VaultMedia {
        try serialized {
            let item = try record(id, revision: revision)
            guard let descriptor = item.media,
                  let bytes = try db.rows("SELECT media FROM records WHERE id=?", [.text(id)]).first?.first ?? nil,
                  bytes.count == descriptor.size, digest(bytes) == descriptor.sha256 else { throw VaultError.invalid }
            return VaultMedia(filename: descriptor.filename, mimeType: descriptor.mimeType, sha256: descriptor.sha256, bytes: bytes)
        }
    }
    public func readMedia(token: String, collectionID: String, id: String, revision: String) throws -> VaultMedia {
        try withClient(token: token, kind: .assistant, scope: .savedMedia, collectionID: collectionID) {
            _ = try get(token: token, collectionID: collectionID, id: id)
            return try media(id: id, revision: revision)
        }
    }
}
