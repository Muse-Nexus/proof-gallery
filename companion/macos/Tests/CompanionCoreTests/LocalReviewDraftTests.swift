import XCTest
@testable import CompanionCore

final class LocalReviewDraftTests: XCTestCase {
    private func context(_ text: String, status: LocalPhotoContext.TextStatus = .found) -> LocalPhotoContext {
        LocalPhotoContext(pixelWidth: 100, pixelHeight: 100, isScreenshot: true, isLivePhoto: false,
                          isFavorite: false, textStatus: status, recognizedText: text)
    }

    func testStartsEmptyAndRequiresExplicitUseBeforeCopy() {
        var draft = LocalReviewDraft()
        XCTAssertEqual(draft.text, "")
        XCTAssertNil(draft.clipboardText)
        XCTAssertFalse(draft.useMachineReadText(context("ignored", status: .off)))
        XCTAssertFalse(draft.useMachineReadText(context("ignored", status: .unavailable)))
        XCTAssertTrue(draft.useMachineReadText(context("Synthetic: not an exact verified quote.")))
        XCTAssertEqual(draft.text, "Synthetic: not an exact verified quote.")
        XCTAssertTrue(draft.clipboardText?.hasPrefix("Machine-read review-note draft (unverified; edits may be included):") == true)
    }

    func testOwnerEditsAndNegationArePreservedWithoutReplacement() {
        var draft = LocalReviewDraft()
        draft.useMachineReadText(context("Synthetic initial OCR"))
        draft.text = "Synthetic correction: this was not what I originally read.\nKeep full context."
        XCTAssertFalse(draft.useMachineReadText(context("Replacement OCR must not win")))
        XCTAssertTrue(draft.clipboardText?.hasSuffix(draft.text) == true)
        XCTAssertFalse(draft.clipboardText?.contains("Replacement OCR must not win") == true)
        draft.text = String(repeating: "x", count: LocalReviewDraft.maximumCharacters + 1)
        XCTAssertNil(draft.clipboardText)
        XCTAssertEqual(draft.text.count, LocalReviewDraft.maximumCharacters + 1)
    }

    func testDraftCannotEnterVersionOneReviewExport() throws {
        let bytes = Data([137,80,78,71,13,10,26,10])
        let photo = try ReviewPhoto.make(original: bytes, media: bytes, filename: "synthetic.png", originalFilename: "synthetic.png",
            mimeType: "image/png", assetIdentifier: "synthetic", creationDate: nil, timeZone: .gmt, scope: "Recent photos", isPreview: false)
        var draft = LocalReviewDraft()
        draft.useMachineReadText(context("SYNTHETIC OCR DRAFT MUST STAY LOCAL"))
        draft.text += " — owner edit"
        let data = try ReviewPackage(items: [photo]).encoded()
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertFalse(json.contains(draft.text))
        XCTAssertFalse(json.contains("recognizedText"))
        XCTAssertFalse(json.contains("reviewNote"))
        let package = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(package["version"] as? Int, 1)
    }
}
