import Foundation

/// Transient editing aid only. Intentionally not Codable or part of ReviewPhoto.
public struct LocalReviewDraft: Equatable {
    public static let maximumCharacters = 2_000
    public var text = ""

    public init() {}

    /// A UI action calls this; recognized text never populates a draft at capture.
    /// Existing owner edits are not overwritten by repeating the action.
    @discardableResult public mutating func useMachineReadText(_ context: LocalPhotoContext) -> Bool {
        guard text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              context.textStatus == .found, !context.recognizedText.isEmpty else { return false }
        text = context.recognizedText
        return true
    }

    /// Preserve the complete edited draft, including negation; never silently clip.
    /// Copy is a separate explicit action and does not make this verified evidence.
    public var clipboardText: String? {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              text.count <= Self.maximumCharacters else { return nil }
        return "Machine-read review-note draft (unverified; edits may be included):\n\n" + text
    }
}
