import XCTest
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers
@testable import CompanionVision

final class LocalTextReadTests: XCTestCase {
    private func syntheticImage(orientation: Int = 1) throws -> Data {
        let context = try XCTUnwrap(CGContext(data: nil, width: 1400, height: 400, bitsPerComponent: 8,
            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 1400, height: 400))
        let text = NSAttributedString(string: "SYNTHETIC TEST WORDS", attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica" as CFString, 72, nil),
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1),
        ])
        // Orientation 3 stores upside-down pixels, corrected by image metadata.
        if orientation == 3 { context.translateBy(x: 1400, y: 400); context.rotate(by: .pi) }
        context.textPosition = CGPoint(x: 50, y: 180); CTLineDraw(CTLineCreateWithAttributedString(text), context)
        let image = try XCTUnwrap(context.makeImage()); let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, [kCGImagePropertyOrientation: orientation] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination)); return data as Data
    }
    func testReadsSyntheticTextOnDeviceWithOrientation() async throws {
        for orientation in [1, 3] {
            let text = try await LocalTextRead().read(syntheticImage(orientation: orientation))
            XCTAssertTrue(text.contains("SYNTHETIC TEST WORDS"), "Synthetic text was not recognized")
        }
    }
    func testCancelledBeforeAttachNeverReturnsText() async throws {
        let reader = LocalTextRead(); reader.cancel()
        do { _ = try await reader.read(syntheticImage()); XCTFail("Cancelled OCR returned text") }
        catch { XCTAssertTrue(error is CancellationError) }
    }
    func testInvalidImageFailsWithoutInventedText() async {
        do { _ = try await LocalTextRead().read(Data([0, 1, 2])); XCTFail("Invalid image succeeded") }
        catch { /* UI retains the photo and labels OCR unavailable. */ }
    }
}
