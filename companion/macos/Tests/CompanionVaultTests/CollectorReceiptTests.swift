import XCTest
import CompanionVault

final class CollectorReceiptTests: XCTestCase {
    func testFolderReceiptRoundTripDoesNotInventDatesOrPhotosIdentity() throws {
        let receipt = VaultProviderReceipt(provider: .folder, sourceID: "synthetic-folder",
            originalFilename: "2020-love.png", originalSha256: String(repeating: "a", count: 64),
            scope: "Selected folder · top-level local images")
        let decoded = try JSONDecoder().decode(VaultProviderReceipt.self, from: JSONEncoder().encode(receipt))
        XCTAssertEqual(decoded, receipt)
        XCTAssertNil(decoded.captureDate)
        XCTAssertNil(decoded.timeZone)
        XCTAssertNil(decoded.assetIdentifier)
        XCTAssertEqual(decoded.provider, .folder)
    }
}
