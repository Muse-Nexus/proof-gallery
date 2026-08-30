import Foundation
import CryptoKit

public enum ReviewLimits {
    public static let photoBytes = 10 * 1024 * 1024
    // Reserve room for base64 expansion and receipt metadata under the web
    // importer's 64 MiB encoded-file ceiling.
    public static let packageBytes = 47 * 1024 * 1024
    public static let photoCount = 50
}

public enum ReviewError: Error, LocalizedError {
    case invalidPhoto, photoTooLarge, packageTooLarge, empty, invalidSource
    public var errorDescription: String? {
        switch self {
        case .invalidPhoto: return "This photo could not be prepared locally."
        case .photoTooLarge: return "Photo exceeds the 10 MiB limit."
        case .packageTooLarge: return "Review is limited to 50 photos and 47 MiB. Export or clear this batch first."
        case .empty: return "There are no photos to export."
        case .invalidSource: return "Photos source metadata is missing or unsupported."
        }
    }
}

public struct SourceReceipt: Codable, Equatable {
    public let assetIdentifier: String
    public let originalFilename: String
    public let originalSha256: String
    public let representation: String
    public let captureDate: String?
    public let timeZone: String
    public let scope: String

    enum CodingKeys: String, CodingKey { case assetIdentifier, originalFilename, originalSha256, representation, captureDate, timeZone, scope }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(assetIdentifier, forKey: .assetIdentifier)
        try c.encode(originalFilename, forKey: .originalFilename)
        try c.encode(originalSha256, forKey: .originalSha256)
        try c.encode(representation, forKey: .representation)
        try c.encode(captureDate, forKey: .captureDate)
        try c.encode(timeZone, forKey: .timeZone)
        try c.encode(scope, forKey: .scope)
    }
}

public struct ReviewPhoto: Codable, Identifiable, Equatable {
    public var id: String { receipt.assetIdentifier }
    public let filename: String
    public let mimeType: String
    public let base64: String
    public let sha256: String
    public let occurredOn: String?
    public let receipt: SourceReceipt
    public var byteCount: Int { Data(base64Encoded: base64)?.count ?? 0 }

    enum CodingKeys: String, CodingKey { case filename, mimeType, base64, sha256, occurredOn, receipt }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(filename, forKey: .filename); try c.encode(mimeType, forKey: .mimeType)
        try c.encode(base64, forKey: .base64); try c.encode(sha256, forKey: .sha256)
        try c.encode(occurredOn, forKey: .occurredOn); try c.encode(receipt, forKey: .receipt)
    }

    public static func make(original: Data, media: Data, filename: String, originalFilename: String,
                            mimeType: String, assetIdentifier: String, creationDate: Date?,
                            timeZone: TimeZone, scope: String, isPreview: Bool) throws -> ReviewPhoto {
        guard !media.isEmpty, !original.isEmpty else { throw ReviewError.invalidPhoto }
        guard media.count <= ReviewLimits.photoBytes, original.count <= ReviewLimits.photoBytes else { throw ReviewError.photoTooLarge }
        guard ["image/jpeg", "image/png", "image/gif", "image/webp"].contains(mimeType),
              (!isPreview || mimeType == "image/jpeg"), (isPreview || original == media) else { throw ReviewError.invalidPhoto }
        let fields = [(filename, 1024), (originalFilename, 1024), (assetIdentifier, 256), (scope, 160)]
        guard fields.allSatisfy({ !$0.0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.0.count <= $0.1 && $0.0.rangeOfCharacter(from: .controlCharacters) == nil }) else { throw ReviewError.invalidSource }
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = timeZone; formatter.dateFormat = "yyyy-MM-dd"
        let receipt = SourceReceipt(assetIdentifier: assetIdentifier, originalFilename: originalFilename,
                                    originalSha256: digest(original), representation: isPreview ? "jpeg-preview" : "original",
                                    captureDate: creationDate.map(isoTimestamp), timeZone: timeZone.identifier, scope: scope)
        return ReviewPhoto(filename: filename, mimeType: mimeType, base64: media.base64EncodedString(),
                           sha256: digest(media), occurredOn: creationDate.map(formatter.string(from:)), receipt: receipt)
    }
}

public struct ReviewPackage: Encodable {
    public let format = "muse-nexus-proof-media-candidates"
    public let version = 1
    public let visibility = "personal"
    public let encryption = "none"
    public let exportedAt: String
    public let items: [ReviewPhoto]

    public init(items: [ReviewPhoto], now: Date = Date()) throws {
        guard !items.isEmpty else { throw ReviewError.empty }
        guard items.count <= ReviewLimits.photoCount,
              items.reduce(0, { $0 + $1.byteCount }) <= ReviewLimits.packageBytes,
              Set(items.map(\.id)).count == items.count else { throw ReviewError.packageTooLarge }
        self.items = items; self.exportedAt = isoTimestamp(now)
    }
    public func encoded() throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(self)
        guard data.count <= 64 * 1024 * 1024 else { throw ReviewError.packageTooLarge }
        return data
    }
}

public func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
public func isoTimestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}
