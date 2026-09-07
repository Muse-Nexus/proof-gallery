import XCTest
import CompanionCore
@testable import ProofPhotosCompanion

final class FolderCollectorTests: XCTestCase {
    private let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=")!

    private func fixture() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("proof-synthetic-\(UUID())")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        return url
    }

    func testTopLevelOnlyRejectsLinksAndPreservesBytes() async throws {
        let root = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        try png.write(to: root.appendingPathComponent("actual.png"))
        try Data("not an image".utf8).write(to: root.appendingPathComponent("fake.png"))
        let nested = root.appendingPathComponent("nested")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: false)
        try png.write(to: nested.appendingPathComponent("hidden.png"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("link.png"), withDestinationURL: root.appendingPathComponent("actual.png"))
        var items: [FolderCandidate] = []
        try await FolderCollector.scan(directory: root) { items.append($0) }
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?.filename, "actual.png")
        XCTAssertEqual(items.first?.data, png)
        XCTAssertEqual(items.first?.sha256, digest(png))
    }

    func testEnumerationOverflowDoesNotCommitPartialBatch() async throws {
        let root = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        for index in 0...FolderCollector.enumerationLimit {
            try png.write(to: root.appendingPathComponent("\(index).png"))
        }
        var received = 0
        do {
            try await FolderCollector.scan(directory: root) { _ in received += 1 }
            XCTFail("Unbounded folder accepted")
        } catch FolderReadError.enumerationLimit { }
        XCTAssertEqual(received, 0)
    }

    func testReceiverFailureStopsWithoutReadingAnotherItem() async throws {
        let root = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        for index in 0..<3 { try png.write(to: root.appendingPathComponent("\(index).png")) }
        var received = 0
        do {
            try await FolderCollector.scan(directory: root) { _ in
                received += 1
                throw CancellationError()
            }
            XCTFail("Failed receiver was ignored")
        } catch is CancellationError { }
        XCTAssertEqual(received, 1)
    }

    func testHandledImagesDoNotStarveLaterNewFiles() async throws {
        let root = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        var handled = Set<String>()
        for index in 0..<60 {
            var bytes = png; bytes.append(UInt8(index))
            try bytes.write(to: root.appendingPathComponent(String(format: "%03d.png", index)))
            if index < 50 { handled.insert(digest(bytes)) }
        }
        var received = 0
        try await FolderCollector.scan(directory: root, isHandled: { handled.contains($0) }) { _ in received += 1 }
        XCTAssertEqual(received, 10)
    }
}
