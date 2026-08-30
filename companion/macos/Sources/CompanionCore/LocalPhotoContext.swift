import Foundation

/// Review aids only. Deliberately not Codable and never part of a Proof receipt.
public struct LocalPhotoContext: Equatable {
    public enum TextStatus: Equatable { case off, found, notFound, unavailable }
    public let pixelWidth: Int
    public let pixelHeight: Int
    public let isScreenshot: Bool
    public let isLivePhoto: Bool
    public let isFavorite: Bool
    public let textStatus: TextStatus
    public let recognizedText: String

    public init(pixelWidth: Int, pixelHeight: Int, isScreenshot: Bool, isLivePhoto: Bool,
                isFavorite: Bool, textStatus: TextStatus, recognizedText: String = "") {
        self.pixelWidth = pixelWidth; self.pixelHeight = pixelHeight
        self.isScreenshot = isScreenshot; self.isLivePhoto = isLivePhoto; self.isFavorite = isFavorite
        let excerpt = Self.textExcerpt([recognizedText])
        self.recognizedText = textStatus == .found ? excerpt : ""
        self.textStatus = textStatus == .found && excerpt.isEmpty ? .notFound : textStatus
    }

    /// Bound output and remove controls without rewriting or interpreting words.
    public static func textExcerpt(_ lines: [String]) -> String {
        let joined = lines.prefix(30).map { line in
            String(String.UnicodeScalarView(line.unicodeScalars.filter {
                !CharacterSet.controlCharacters.contains($0) || $0 == "\n" || $0 == "\t"
            }))
        }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return String(joined.prefix(1600))
    }

    public func matches(_ query: String, filename: String, scope: String, occurredOn: String?) -> Bool {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return true }
        // A literal search, not semantic relevance or a measure of personal value.
        return [filename, scope, occurredOn ?? "", recognizedText].contains {
            $0.localizedCaseInsensitiveContains(query)
        }
    }
}
