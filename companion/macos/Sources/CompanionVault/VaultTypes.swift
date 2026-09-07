import Foundation

/// JSON provenance is preserved literally; it is never interpreted as authority.
public enum VaultJSON: Codable, Equatable, Sendable {
    case string(String), number(Double), bool(Bool), null, array([VaultJSON]), object([String: VaultJSON])
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode([VaultJSON].self) { self = .array(v) }
        else { self = .object(try c.decode([String: VaultJSON].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
}

public enum VaultProvider: String, Codable, Sendable { case photos, folder }
public enum VaultSourceMode: String, Codable, Sendable { case review, trusted }
public enum VaultState: String, Codable, Sendable { case pending, saved }
public enum VaultClientKind: String, Codable, Sendable { case gallery, assistant }
public enum VaultClientScope: String, Codable, Sendable { case savedText, savedMedia, galleryReview }

public struct VaultFields: Codable, Equatable, Sendable {
    public var title: String
    public var evidenceText: String
    public var occurredOn: String?
    public var category: String?
    public var sourceType: String
    public var source: String?
    public var tags: [String]
    public var person: String?
    public var project: String?
    public init(title: String = "", evidenceText: String = "", occurredOn: String? = nil,
                category: String? = nil, sourceType: String = "photo", source: String? = nil,
                tags: [String] = [], person: String? = nil, project: String? = nil) {
        self.title = title; self.evidenceText = evidenceText; self.occurredOn = occurredOn
        self.category = category; self.sourceType = sourceType; self.source = source
        self.tags = tags; self.person = person; self.project = project
    }
}

/// Independent of the existing Photos ReviewPackage v1. Unknown facts stay nil.
public struct VaultProviderReceipt: Codable, Equatable, Sendable {
    public let version: Int
    public let provider: VaultProvider
    public let sourceID: String
    public let assetIdentifier: String?
    public let originalFilename: String
    public let originalSha256: String
    public let representation: String
    public let captureDate: String?
    public let timeZone: String?
    public let scope: String
    public init(provider: VaultProvider, sourceID: String, assetIdentifier: String? = nil,
                originalFilename: String, originalSha256: String, representation: String = "original",
                captureDate: String? = nil, timeZone: String? = nil, scope: String) {
        version = 1; self.provider = provider; self.sourceID = sourceID; self.assetIdentifier = assetIdentifier
        self.originalFilename = originalFilename; self.originalSha256 = originalSha256
        self.representation = representation; self.captureDate = captureDate; self.timeZone = timeZone; self.scope = scope
    }
}

public struct VaultMedia: Codable, Equatable, Sendable {
    public let filename: String
    public let mimeType: String
    public let sha256: String
    public let bytes: Data
    public init(filename: String, mimeType: String, sha256: String, bytes: Data) {
        self.filename = filename; self.mimeType = mimeType; self.sha256 = sha256; self.bytes = bytes
    }
}
public struct VaultMediaDescriptor: Codable, Equatable, Sendable {
    public let filename: String
    public let mimeType: String
    public let sha256: String
    public let size: Int
}
public struct VaultInput: Codable, Equatable, Sendable {
    public var fields: VaultFields
    public var media: VaultMedia?
    public var receipt: VaultProviderReceipt?
    public var provenance: [String: VaultJSON]
    public init(fields: VaultFields, media: VaultMedia? = nil, receipt: VaultProviderReceipt? = nil,
                provenance: [String: VaultJSON] = [:]) {
        self.fields = fields; self.media = media; self.receipt = receipt; self.provenance = provenance
    }
}
public struct VaultApproval: Codable, Equatable, Sendable {
    public let method: String
    public let approvedAt: String
    public let sourceGrantID: String?
    public let sourceGrantRevision: String?
}
public struct VaultRecord: Codable, Equatable, Sendable {
    public let id: String
    public let collectionID: String
    public let revision: String
    public let state: VaultState
    public let fields: VaultFields
    public let media: VaultMediaDescriptor?
    public let receipt: VaultProviderReceipt?
    public let provenance: [String: VaultJSON]
    public let approval: VaultApproval?
    public let createdAt: String
    public let updatedAt: String
    public var restoreReceipt: VaultRestoreReceipt? = nil
}
public struct VaultRestoreReceipt: Codable, Equatable, Sendable {
    public let originalCollectionID: String
    public let sourceCollectionID: String
    public let restoredAt: String
}
public struct VaultRestoreResult: Codable, Equatable, Sendable {
    public let saved: Int
    public let pending: Int
}
public enum VaultBackupError: Error { case invalidArchive, passphrase, restoreRequiresEmptyVault }
public enum VaultBackupLimits {
    public static let maximumPlaintextBytes = 192 * 1024 * 1024
    public static let maximumArchiveBytes = maximumPlaintextBytes + 57
}

/// Adapter-owned bounded selection/bookmark payload. Never exported to gallery/MCP.
public struct VaultSourceConfiguration: Codable, Equatable, Sendable {
    public var provider: VaultProvider
    public var sourceID: String
    public var label: String
    public var mode: VaultSourceMode
    public var category: String?
    public var tags: [String]
    public var backgroundEnabled: Bool
    public var selection: [String: VaultJSON]
    public init(provider: VaultProvider, sourceID: String, label: String, mode: VaultSourceMode = .review,
                category: String? = nil, tags: [String] = [], backgroundEnabled: Bool = false,
                selection: [String: VaultJSON] = [:]) {
        self.provider = provider; self.sourceID = sourceID; self.label = label; self.mode = mode
        self.category = category; self.tags = tags; self.backgroundEnabled = backgroundEnabled; self.selection = selection
    }
}
public struct VaultSourceGrant: Codable, Equatable, Sendable {
    public let id: String
    public let revision: String
    public let configuration: VaultSourceConfiguration
    public let approvedAt: String
    public let paused: Bool
    public let revoked: Bool
}
public struct VaultIngestResult: Codable, Equatable, Sendable {
    public let pending: Int
    public let saved: Int
    public let duplicates: Int
}
public struct VaultClientGrant: Codable, Equatable, Sendable {
    public let id: String
    public let collectionID: String
    public let kind: VaultClientKind
    public let scopes: [VaultClientScope]
    public let expiresAt: String
    public let revoked: Bool
}
/// The raw token is returned once to owner UI, and must never be logged or persisted.
public struct VaultIssuedClient: Sendable {
    public let grant: VaultClientGrant
    public let token: String
}
public struct VaultQuery: Codable, Equatable, Sendable {
    public var text: String
    public var category: String?
    public var tag: String?
    public var limit: Int
    public init(text: String, category: String? = nil, tag: String? = nil, limit: Int = 6) {
        self.text = text; self.category = category; self.tag = tag; self.limit = limit
    }
}
public struct VaultSearchResult: Codable, Equatable, Sendable {
    public let matching: String
    public let items: [VaultRecord]
}
public enum VaultError: Error { case invalid, forbidden, staleRevision, capacity, unavailable, unsafePath, storage }

/// Owner methods are in-process ONLY. Never expose grant/configuration methods over the web or MCP.
/// Every method is synchronous and serialized. Adapter cancellation is checked inside the write transaction.
public protocol VaultAuthority: AnyObject {
    var collectionID: String { get }
    func sourceGrants() throws -> [VaultSourceGrant]
    func createSourceGrant(_ configuration: VaultSourceConfiguration) throws -> VaultSourceGrant
    func updateSourceGrant(id: String, revision: String, configuration: VaultSourceConfiguration, paused: Bool) throws -> VaultSourceGrant
    func pauseSource(id: String, revision: String) throws -> VaultSourceGrant
    func revokeSource(id: String, revision: String) throws
    func ingest(sourceGrantID: String, revision: String, inputs: [VaultInput], background: Bool,
                isCancelled: () -> Bool) throws -> VaultIngestResult
    func hasHandled(sourceGrantID: String, sha256: String) throws -> Bool
    func list(state: VaultState, limit: Int, offset: Int) throws -> [VaultRecord]
    func saveManual(_ input: VaultInput) throws -> VaultRecord
    func stageManual(_ input: VaultInput) throws -> VaultRecord
    func edit(id: String, revision: String, fields: VaultFields) throws -> VaultRecord
    func approve(id: String, revision: String, fields: VaultFields) throws -> VaultRecord
    func delete(id: String, revision: String) throws
    func clear() throws
    func issueClient(kind: VaultClientKind, scopes: [VaultClientScope], expiresAt: Date) throws -> VaultIssuedClient
    func revokeClient(id: String) throws
    func search(token: String, collectionID: String, query: VaultQuery) throws -> VaultSearchResult
    func readMedia(token: String, collectionID: String, id: String, revision: String) throws -> VaultMedia
}
