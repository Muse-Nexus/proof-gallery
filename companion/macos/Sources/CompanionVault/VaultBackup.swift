import Foundation
import CryptoKit
import CommonCrypto
import Security

struct VaultBackupEntry: Codable {
    let record: VaultRecord
    let media: VaultMedia?
}
struct VaultContentBackup: Codable {
    let format: String
    let version: Int
    let exportedAt: String
    let sourceCollectionID: String
    let entries: [VaultBackupEntry]
}

/// Byte-compatible with src/lib/encrypted-backup.ts encryption, but containing
/// a distinct native content schema. Browser import is not implied.
enum VaultBackup {
    // Native limits allow 96 MiB raw media plus 32 MiB metadata. Base64 expands
    // media to 128 MiB; leave bounded headroom so every valid vault can export.
    static let maximumBytes = VaultBackupLimits.maximumPlaintextBytes
    static let format = "proof-gallery-native-content"
    private static let magic = Data("PROOFENC".utf8)
    private static let headerBytes = 41
    private static let rounds = 600_000

    private static func random(_ count: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else { throw VaultBackupError.invalidArchive }
        return Data(bytes)
    }
    private static func key(_ passphrase: String, salt: Data) throws -> SymmetricKey {
        guard passphrase.utf16.count >= 12, passphrase.utf8.count <= 1024 else { throw VaultBackupError.passphrase }
        var password = Array(passphrase.utf8), derived = [UInt8](repeating: 0, count: 32)
        defer {
            _ = password.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) }
            _ = derived.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) }
        }
        let status = password.withUnsafeBytes { p in salt.withUnsafeBytes { s in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), p.baseAddress!.assumingMemoryBound(to: Int8.self), p.count,
                s.baseAddress!.assumingMemoryBound(to: UInt8.self), s.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                UInt32(rounds), &derived, 32)
        } }
        guard status == kCCSuccess else { throw VaultBackupError.invalidArchive }
        return SymmetricKey(data: derived)
    }
    static func encrypt(_ plaintext: Data, passphrase: String) throws -> Data {
        guard !plaintext.isEmpty, plaintext.count <= maximumBytes else { throw VaultBackupError.invalidArchive }
        var header = magic; header.append(1)
        header.append(contentsOf: [UInt8((rounds >> 24) & 255), UInt8((rounds >> 16) & 255), UInt8((rounds >> 8) & 255), UInt8(rounds & 255)])
        let salt = try random(16), iv = try random(12); header.append(salt); header.append(iv)
        let sealed = try AES.GCM.seal(plaintext, using: key(passphrase, salt: salt), nonce: AES.GCM.Nonce(data: iv), authenticating: header)
        return header + sealed.ciphertext + sealed.tag
    }
    static func decrypt(_ archive: Data, passphrase: String) throws -> Data {
        let archive = Data(archive)
        guard archive.count > headerBytes + 16, archive.count <= maximumBytes + headerBytes + 16 else { throw VaultBackupError.invalidArchive }
        let header = Data(archive.prefix(headerBytes))
        let r = header[9..<13].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard header.prefix(8) == magic, header[8] == 1, r == rounds else { throw VaultBackupError.invalidArchive }
        let key = try key(passphrase, salt: Data(header[13..<29]))
        do {
            let sealed = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: header[29..<41]),
                ciphertext: archive[headerBytes..<(archive.count - 16)], tag: archive.suffix(16))
            return try AES.GCM.open(sealed, using: key, authenticating: header)
        } catch { throw VaultBackupError.invalidArchive }
    }

    private static func exact(_ value: Any?, required: Set<String>, optional: Set<String> = []) throws -> [String: Any] {
        guard let object = value as? [String: Any], required.isSubset(of: Set(object.keys)),
              Set(object.keys).isSubset(of: required.union(optional)) else { throw VaultBackupError.invalidArchive }
        return object
    }
    private static func boundedJSON(_ value: Any, depth: Int = 0) throws {
        guard depth <= 16 else { throw VaultBackupError.invalidArchive }
        if let object = value as? [String: Any] {
            guard object.count <= 1000 else { throw VaultBackupError.invalidArchive }
            for (key, v) in object { guard key.utf8.count <= 1024 else { throw VaultBackupError.invalidArchive }; try boundedJSON(v, depth: depth + 1) }
        } else if let array = value as? [Any] {
            guard array.count <= 1000 else { throw VaultBackupError.invalidArchive }
            for v in array { try boundedJSON(v, depth: depth + 1) }
        } else if let s = value as? String { guard s.utf8.count <= 32 * 1024 else { throw VaultBackupError.invalidArchive } }
    }
    private static func date(_ text: String) throws -> Date {
        guard text.utf8.count <= 40 else { throw VaultBackupError.invalidArchive }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = f.date(from: text) ?? ISO8601DateFormatter().date(from: text),
              date.timeIntervalSince1970.isFinite else { throw VaultBackupError.invalidArchive }
        return date
    }
    static func decode(_ bytes: Data) throws -> VaultContentBackup {
        guard !bytes.isEmpty, bytes.count <= maximumBytes else { throw VaultBackupError.invalidArchive }
        do {
            let root = try exact(JSONSerialization.jsonObject(with: bytes), required: ["format", "version", "exportedAt", "sourceCollectionID", "entries"])
            guard let entries = root["entries"] as? [[String: Any]], entries.count <= 10_100 else { throw VaultBackupError.invalidArchive }
            for value in entries {
                let entry = try exact(value, required: ["record"], optional: ["media"])
                let r = try exact(entry["record"], required: ["id", "collectionID", "revision", "state", "fields", "provenance", "createdAt", "updatedAt"], optional: ["media", "receipt", "approval", "restoreReceipt"])
                _ = try exact(r["fields"], required: ["title", "evidenceText", "sourceType", "tags"], optional: ["occurredOn", "category", "source", "person", "project"])
                try boundedJSON(r["provenance"]!)
                if let receipt = r["receipt"], !(receipt is NSNull) {
                    _ = try exact(receipt, required: ["version", "provider", "sourceID", "originalFilename", "originalSha256", "representation", "scope"], optional: ["assetIdentifier", "captureDate", "timeZone"])
                }
                if let approval = r["approval"], !(approval is NSNull) {
                    _ = try exact(approval, required: ["method", "approvedAt"], optional: ["sourceGrantID", "sourceGrantRevision"])
                }
                if let receipt = r["restoreReceipt"], !(receipt is NSNull) {
                    _ = try exact(receipt, required: ["originalCollectionID", "sourceCollectionID", "restoredAt"])
                }
                if let descriptor = r["media"], !(descriptor is NSNull) {
                    _ = try exact(descriptor, required: ["filename", "mimeType", "sha256", "size"])
                }
                if let media = entry["media"], !(media is NSNull) {
                    let m = try exact(media, required: ["filename", "mimeType", "sha256", "bytes"])
                    guard let base64 = m["bytes"] as? String, base64.utf8.count <= 4 * ((10 * 1024 * 1024 + 2) / 3),
                          let data = Data(base64Encoded: base64), data.base64EncodedString() == base64 else { throw VaultBackupError.invalidArchive }
                }
            }
            let content = try JSONDecoder().decode(VaultContentBackup.self, from: bytes)
            try validate(content); return content
        } catch { throw VaultBackupError.invalidArchive }
    }
    static func validate(_ content: VaultContentBackup) throws {
        guard content.format == format, content.version == 1, UUID(uuidString: content.sourceCollectionID) != nil,
              content.entries.count <= 10_100, Set(content.entries.map { $0.record.id }).count == content.entries.count else { throw VaultBackupError.invalidArchive }
        _ = try date(content.exportedAt)
        var counts: [VaultState: Int] = [:], sizes: [VaultState: Int] = [:], metadata: [VaultState: Int] = [:]
        for entry in content.entries {
            let r = entry.record
            guard UUID(uuidString: r.id) != nil, UUID(uuidString: r.revision) != nil,
                  r.collectionID == content.sourceCollectionID else { throw VaultBackupError.invalidArchive }
            guard try date(r.createdAt) <= date(r.updatedAt) else { throw VaultBackupError.invalidArchive }
            try VaultValidation.input(VaultInput(fields: r.fields, media: entry.media, receipt: r.receipt, provenance: r.provenance), saved: r.state == .saved)
            try boundedJSON(JSONSerialization.jsonObject(with: JSONEncoder().encode(r.provenance)))
            if let m = entry.media {
                guard let descriptor = r.media, descriptor.filename == m.filename, descriptor.mimeType == m.mimeType,
                      descriptor.sha256 == m.sha256, descriptor.size == m.bytes.count else { throw VaultBackupError.invalidArchive }
            } else { guard r.media == nil else { throw VaultBackupError.invalidArchive } }
            if r.state == .saved {
                guard let a = r.approval, ["manual", "manual-review", "trusted-source"].contains(a.method) else { throw VaultBackupError.invalidArchive }
                _ = try date(a.approvedAt)
                if a.method == "trusted-source" {
                    guard let id = a.sourceGrantID, UUID(uuidString: id) != nil, let revision = a.sourceGrantRevision,
                          UUID(uuidString: revision) != nil, r.receipt != nil else { throw VaultBackupError.invalidArchive }
                } else { guard a.sourceGrantID == nil, a.sourceGrantRevision == nil else { throw VaultBackupError.invalidArchive } }
            } else { guard r.approval == nil else { throw VaultBackupError.invalidArchive } }
            if let restoration = r.restoreReceipt {
                guard UUID(uuidString: restoration.originalCollectionID) != nil, UUID(uuidString: restoration.sourceCollectionID) != nil else { throw VaultBackupError.invalidArchive }
                _ = try date(restoration.restoredAt)
            }
            counts[r.state, default: 0] += 1; sizes[r.state, default: 0] += entry.media?.bytes.count ?? 0
            metadata[r.state, default: 0] += try JSONEncoder().encode(r).count
        }
        for state in [VaultState.saved, .pending] {
            guard counts[state, default: 0] <= (state == .saved ? 10_000 : 100), sizes[state, default: 0] <= 48 * 1024 * 1024,
                  metadata[state, default: 0] <= 16 * 1024 * 1024 else { throw VaultBackupError.invalidArchive }
        }
    }
}
