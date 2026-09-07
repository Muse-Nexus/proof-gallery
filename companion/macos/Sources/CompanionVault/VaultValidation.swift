import Foundation
import CompanionCore

enum VaultValidation {
    static let categories = Set(["belonging", "competence", "creativity", "parenting", "recovery", "money", "shipped", "awards", "kindness_received"])
    static let sourceTypes = Set(["email", "message", "photo", "receipt", "award", "work", "memory", "conversation", "document", "web", "other"])
    static func text(_ text: String, max: Int, empty: Bool = true) throws {
        guard text.utf8.count <= max, empty || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !text.unicodeScalars.contains(where: { $0.value == 0 }) else { throw VaultError.invalid }
    }
    static func hash(_ value: String) throws {
        guard value.count == 64, value.allSatisfy({ "0123456789abcdef".contains($0) }) else { throw VaultError.invalid }
    }
    static func fields(_ fields: VaultFields, saved: Bool) throws {
        try text(fields.title, max: 300); try text(fields.evidenceText, max: 16_000)
        guard sourceTypes.contains(fields.sourceType), fields.tags.count <= 30 else { throw VaultError.invalid }
        if saved || fields.category != nil { guard let category = fields.category, categories.contains(category) else { throw VaultError.invalid } }
        for tag in fields.tags { try text(tag, max: 100, empty: false) }
        for v in [fields.source, fields.person, fields.project].compactMap({ $0 }) { try text(v, max: 2000) }
        if let date = fields.occurredOn {
            guard date.count == 10 else { throw VaultError.invalid }
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.calendar = Calendar(identifier: .gregorian)
            f.timeZone = .gmt; f.dateFormat = "yyyy-MM-dd"; f.isLenient = false
            guard let d = f.date(from: date), f.string(from: d) == date else { throw VaultError.invalid }
        }
    }
    static func configuration(_ c: VaultSourceConfiguration) throws {
        try text(c.sourceID, max: 1024, empty: false); try text(c.label, max: 300, empty: false)
        try fields(VaultFields(category: c.category, tags: c.tags), saved: c.mode == .trusted)
        guard try JSONEncoder().encode(c.selection).count <= 64 * 1024 else { throw VaultError.invalid }
    }
    static func input(_ input: VaultInput, saved: Bool) throws {
        try fields(input.fields, saved: saved)
        try json(.object(input.provenance))
        guard try JSONEncoder().encode(input.provenance).count <= 32 * 1024 else { throw VaultError.invalid }
        guard input.media != nil || !input.fields.evidenceText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw VaultError.invalid }
        if let media = input.media {
            try text(media.filename, max: 1024, empty: false); try hash(media.sha256)
            guard !media.bytes.isEmpty, media.bytes.count <= 10 * 1024 * 1024,
                  digest(media.bytes) == media.sha256, signature(media.bytes, mime: media.mimeType) else { throw VaultError.invalid }
        }
        if let receipt = input.receipt {
            guard receipt.version == 1, let media = input.media else { throw VaultError.invalid }
            try text(receipt.sourceID, max: 1024, empty: false); try text(receipt.scope, max: 1024, empty: false)
            try text(receipt.originalFilename, max: 1024, empty: false); try hash(receipt.originalSha256)
            if let id = receipt.assetIdentifier { try text(id, max: 1024, empty: false) }
            guard ["original", "jpeg-preview"].contains(receipt.representation),
                  receipt.representation == "original" ? receipt.originalSha256 == media.sha256 : media.mimeType == "image/jpeg" else { throw VaultError.invalid }
            if let date = receipt.captureDate {
                let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                guard f.date(from: date) != nil || ISO8601DateFormatter().date(from: date) != nil else { throw VaultError.invalid }
            }
            if let zone = receipt.timeZone { guard TimeZone(identifier: zone) != nil else { throw VaultError.invalid } }
        }
    }
    private static func json(_ value: VaultJSON, depth: Int = 0) throws {
        guard depth <= 16 else { throw VaultError.invalid }
        switch value {
        case .object(let object):
            guard object.count <= 1000 else { throw VaultError.invalid }
            for (key, v) in object { try text(key, max: 1024); try json(v, depth: depth + 1) }
        case .array(let array):
            guard array.count <= 1000 else { throw VaultError.invalid }
            for v in array { try json(v, depth: depth + 1) }
        case .string(let string): try text(string, max: 32 * 1024)
        case .number(let number): guard number.isFinite else { throw VaultError.invalid }
        case .null, .bool: break
        }
    }
    static func signature(_ data: Data, mime: String) -> Bool {
        let b = [UInt8](data.prefix(4096)); let ascii = String(bytes: b, encoding: .isoLatin1) ?? ""
        switch mime {
        case "image/jpeg": return b.starts(with: [255, 216, 255])
        case "image/png": return b.starts(with: [137, 80, 78, 71, 13, 10, 26, 10])
        case "image/gif": return ascii.hasPrefix("GIF87a") || ascii.hasPrefix("GIF89a")
        case "image/webp": return b.count >= 12 && String(bytes: b[0..<4], encoding: .ascii) == "RIFF" && String(bytes: b[8..<12], encoding: .ascii) == "WEBP"
        case "video/webm": return b.starts(with: [0x1a, 0x45, 0xdf, 0xa3]) && ascii.contains("webm")
        case "video/mp4":
            guard b.count >= 16 else { return false }
            let n = b.prefix(4).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
            let brand = String(bytes: b[8..<12], encoding: .ascii) ?? ""
            return n >= 16 && n <= data.count && String(bytes: b[4..<8], encoding: .ascii) == "ftyp" &&
                ["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "avc1", "M4V ", "MSNV", "dash"].contains(brand)
        default: return false
        }
    }
}
