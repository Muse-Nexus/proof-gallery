import XCTest
@testable import CompanionCore

final class ReviewPackageTests: XCTestCase {
    private let png = Data([137, 80, 78, 71, 13, 10, 26, 10])
    private func photo(date: Date? = nil, preview: Bool = false, id: String = "synthetic-asset") throws -> ReviewPhoto {
        try ReviewPhoto.make(original: png, media: preview ? Data([255,216,255,0]) : png,
                             filename: preview ? "synthetic.jpg" : "synthetic.png", originalFilename: "synthetic.png",
                             mimeType: preview ? "image/jpeg" : "image/png", assetIdentifier: id, creationDate: date,
                             timeZone: TimeZone(identifier: "Pacific/Honolulu")!, scope: "Synthetic album", isPreview: preview)
    }
    func testUnknownDateIsExplicitNullAndNoSavedProofFields() throws {
        let data = try ReviewPackage(items: [photo()]).encoded()
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(value["format"] as? String, "muse-nexus-proof-media-candidates")
        XCTAssertEqual(value["visibility"] as? String, "personal")
        let item = try XCTUnwrap((value["items"] as? [[String: Any]])?.first)
        XCTAssertTrue(item["occurredOn"] is NSNull)
        XCTAssertNil(item["category"]); XCTAssertNil(item["evidenceText"])
    }
    func testPhotosTimestampUsesRecordedTimezoneNotImportDate() throws {
        let date = ISO8601DateFormatter().date(from: "2026-08-30T01:00:00Z")!
        let item = try photo(date: date)
        XCTAssertEqual(item.occurredOn, "2026-08-29")
        XCTAssertEqual(item.receipt.captureDate, "2026-08-30T01:00:00.000Z")
    }
    func testPreviewIsLabelledAndRetainsOriginalDigest() throws {
        let item = try photo(preview: true)
        XCTAssertEqual(item.receipt.representation, "jpeg-preview")
        XCTAssertEqual(item.receipt.originalSha256, digest(png))
        XCTAssertNotEqual(item.sha256, item.receipt.originalSha256)
    }
    func testDuplicateAndOversizedBatchesFail() throws {
        XCTAssertThrowsError(try ReviewPackage(items: []))
        XCTAssertThrowsError(try ReviewPackage(items: [photo(), photo()]))
        XCTAssertThrowsError(try ReviewPackage(items: (0...50).map { try photo(id: "synthetic-\($0)") }))
    }
    func testByteCapAndUnmarkedDerivativeFail() throws {
        XCTAssertThrowsError(try ReviewPhoto.make(original: Data(repeating: 0, count: ReviewLimits.photoBytes + 1), media: png, filename: "synthetic.png", originalFilename: "synthetic.png", mimeType: "image/png", assetIdentifier: "synthetic", creationDate: nil, timeZone: .gmt, scope: "Synthetic", isPreview: false))
        XCTAssertThrowsError(try ReviewPhoto.make(original: png, media: Data([1]), filename: "synthetic.png", originalFilename: "synthetic.png", mimeType: "image/png", assetIdentifier: "synthetic", creationDate: nil, timeZone: .gmt, scope: "Synthetic", isPreview: false))
    }
}
