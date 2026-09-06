import XCTest
@testable import CompanionCore

final class LocalPhotoContextTests: XCTestCase {
    private func context(_ text: String, status: LocalPhotoContext.TextStatus = .found) -> LocalPhotoContext {
        LocalPhotoContext(pixelWidth: 100, pixelHeight: 200, isScreenshot: true, isLivePhoto: false,
                          isFavorite: false, textStatus: status, recognizedText: text)
    }
    func testLiteralTextIsNotSentimentOrAQuote() {
        let value = context("not loved — synthetic text")
        XCTAssertEqual(value.recognizedText, "not loved — synthetic text")
        XCTAssertTrue(value.matches("NOT LOVED", filename: "IMG_1234.png", scope: "Recent photos", occurredOn: nil))
        XCTAssertFalse(value.matches("valued", filename: "IMG_1234.png", scope: "Recent photos", occurredOn: nil))
        XCTAssertTrue(value.matches("2026-08", filename: "IMG_1234.png", scope: "Recent photos", occurredOn: "2026-08-30"))
        XCTAssertTrue(value.matches("img_1234", filename: "IMG_1234.png", scope: "Recent photos", occurredOn: nil))
    }
    func testBoundedTextAndMissingAreNotNegativeEvidence() {
        XCTAssertEqual(context(" \n").textStatus, .notFound)
        XCTAssertEqual(context("ignored", status: .off).recognizedText, "")
        XCTAssertEqual(context("ignored", status: .unavailable).recognizedText, "")
        XCTAssertEqual(LocalPhotoContext.textExcerpt(["a\u{0000}b\nnext"]), "ab\nnext")
        XCTAssertEqual(LocalPhotoContext.textExcerpt([String(repeating: "x", count: 5000)]).count, 1600)
        XCTAssertEqual(LocalPhotoContext.textExcerpt(Array(repeating: "line", count: 100)).components(separatedBy: "\n").count, 30)
    }
    func testHintsCannotEnterVersionOneReviewExport() throws {
        let bytes = Data([137,80,78,71,13,10,26,10])
        let photo = try ReviewPhoto.make(original: bytes, media: bytes, filename: "synthetic.png", originalFilename: "synthetic.png",
            mimeType: "image/png", assetIdentifier: "synthetic", creationDate: nil, timeZone: .gmt, scope: "Recent photos", isPreview: false)
        let hints = [photo.id: context("LOCAL SYNTHETIC TEXT")]
        XCTAssertEqual(hints.count, 1)
        let data = try ReviewPackage(items: [photo]).encoded()
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertFalse(json.contains("LOCAL SYNTHETIC TEXT")); XCTAssertFalse(json.contains("recognizedText"))
        let package = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(package["version"] as? Int, 1)
    }
}
