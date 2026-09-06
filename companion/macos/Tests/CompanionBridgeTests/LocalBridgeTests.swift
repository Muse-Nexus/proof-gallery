import XCTest
@testable import ProofPhotosCompanion

private final class FirstResult: @unchecked Sendable {
    private let lock = NSLock(); private var resumed = false
    func claim() -> Bool { lock.lock(); defer { lock.unlock() }; if resumed { return false }; resumed = true; return true }
}

final class LocalBridgeTests: XCTestCase {
    func testSyntheticLoopbackTransferIsOneUseAndRevocable() async throws {
        let bridge = LocalBridge(); defer { bridge.stop() }
        let code: String = await withCheckedContinuation { continuation in
            // The first callback is readiness. Expiry is far beyond this bounded test.
            let first = FirstResult()
            bridge.start(review: Data("{\"synthetic\":true}".utf8)) { code in
                if first.claim() { continuation.resume(returning: code ?? "") }
            }
        }
        let parts = code.split(separator: "."); XCTAssertEqual(parts.count, 2)
        guard parts.count == 2 else { return }
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:\(parts[0])/v1/review"))
        var request = URLRequest(url: url); request.timeoutInterval = 5
        request.setValue("https://proof-gallery-9jn.pages.dev", forHTTPHeaderField: "Origin")
        request.setValue("Bearer \(parts[1])", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "{\"synthetic\":true}")
        let (_, repeated) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((repeated as? HTTPURLResponse)?.statusCode, 409)
        request.setValue("https://evil.example", forHTTPHeaderField: "Origin")
        let (_, rejected) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((rejected as? HTTPURLResponse)?.statusCode, 403)
        bridge.stop()
        do { _ = try await URLSession.shared.data(for: request); XCTFail("Stopped listener accepted a request") } catch { }
    }
}
