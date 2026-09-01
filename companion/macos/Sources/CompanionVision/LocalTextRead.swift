import Foundation
import ImageIO
import Vision
import CompanionCore

/// One cancellable on-device request. No networking, files, or Photos access.
public final class LocalTextRead: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var request: VNRecognizeTextRequest?

    public init() {}

    public func cancel() {
        lock.lock(); cancelled = true; let current = request; lock.unlock()
        current?.cancel()
    }

    private func checkCancellation() throws {
        lock.lock(); let value = cancelled; lock.unlock()
        if value { throw CancellationError() }
    }

    public func read(_ data: Data) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            // Vision perform() is synchronous; never block the main actor or Pause.
            DispatchQueue.global(qos: .utility).async {
                let result: Result<String, Error> = Result {
                    try autoreleasepool {
                        try self.checkCancellation()
                        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
                              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                                kCGImageSourceCreateThumbnailFromImageAlways: true,
                                kCGImageSourceCreateThumbnailWithTransform: true,
                                kCGImageSourceThumbnailMaxPixelSize: 2048,
                              ] as CFDictionary) else { throw ReviewError.invalidPhoto }
                        try self.checkCancellation()
                        let request = VNRecognizeTextRequest()
                        request.recognitionLevel = .accurate
                        request.usesLanguageCorrection = false
                        request.automaticallyDetectsLanguage = true
                        request.preferBackgroundProcessing = true
                        self.lock.lock(); self.request = request; let cancelled = self.cancelled; self.lock.unlock()
                        if cancelled { request.cancel(); throw CancellationError() }
                        defer { self.lock.lock(); self.request = nil; self.lock.unlock() }
                        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
                        try self.checkCancellation()
                        return LocalPhotoContext.textExcerpt((request.results ?? []).prefix(30).compactMap {
                            $0.topCandidates(1).first?.string
                        })
                    }
                }
                continuation.resume(with: result)
            }
        }
    }
}
