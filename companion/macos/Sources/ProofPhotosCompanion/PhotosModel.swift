import AppKit
import Photos
import ImageIO
import UniformTypeIdentifiers
import CompanionCore

struct PhotoAlbum: Identifiable { let id: String; let title: String }

// PhotoKit streams on an arbitrary queue. Bound bytes before decoding, and
// cancel even if the request identifier arrives after cancellation/overflow.
private final class ResourceRead: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()
    private var requestID: PHAssetResourceDataRequestID?
    private var failure: Error?
    func attach(_ id: PHAssetResourceDataRequestID) {
        lock.lock(); requestID = id; let cancel = failure != nil; lock.unlock()
        if cancel { PHAssetResourceManager.default().cancelDataRequest(id) }
    }
    func append(_ chunk: Data) {
        lock.lock()
        if failure == nil {
            if data.count + chunk.count > ReviewLimits.photoBytes { failure = ReviewError.photoTooLarge; data.removeAll() }
            else { data.append(chunk) }
        }
        let id = failure == nil ? nil : requestID; lock.unlock()
        if let id { PHAssetResourceManager.default().cancelDataRequest(id) }
    }
    func cancel() {
        lock.lock(); failure = CancellationError(); data.removeAll(); let id = requestID; lock.unlock()
        if let id { PHAssetResourceManager.default().cancelDataRequest(id) }
    }
    func finish(_ error: Error?) -> Result<Data, Error> {
        lock.lock(); defer { lock.unlock() }
        if let error = failure ?? error { return .failure(error) }
        return .success(data)
    }
}

@MainActor final class PhotosModel: NSObject, ObservableObject, PHPhotoLibraryChangeObserver {
    @Published var connected = false
    @Published var connecting = false
    @Published var active = false
    @Published var scanning = false
    @Published var albums: [PhotoAlbum] = []
    @Published var source = ""
    @Published var since = Calendar.current.date(byAdding: .day, value: -90, to: Date())!
    @Published var photos: [ReviewPhoto] = []
    @Published var message = "Connect only when you are ready to choose a photo source."
    @Published var skipped = 0
    @Published var exported = false
    private var generation = 0
    private var seen = Set<String>()
    private var task: Task<Void, Never>?
    private var activeRead: ResourceRead?
    private var scanAgain = false
    private var observing = false
    private var lastScopeKey: String?

    var sourceLocked: Bool { active || scanning || !photos.isEmpty }
    var preparedBytes: Int { photos.reduce(0) { $0 + $1.byteCount } }

    func connect() {
        guard !connecting, !connected else { return }
        connecting = true
        // Requesting permission is never a startup side effect.
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] status in
            Task { @MainActor in
                guard let self else { return }
                self.connecting = false
                guard status == .authorized || status == .limited else {
                    self.message = "Photos access was not granted. You can change it in System Settings → Privacy & Security → Photos."
                    return
                }
                self.connected = true
                self.loadAlbums()
                self.message = "Connected. Choose a source and earliest date, then start. No photos have been read yet."
            }
        }
    }

    private func loadAlbums() {
        let result = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: nil)
        var rows: [PhotoAlbum] = []
        result.enumerateObjects { album, _, _ in
            rows.append(PhotoAlbum(id: album.localIdentifier, title: album.localizedTitle ?? "Untitled album"))
        }
        albums = rows.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    func start() {
        guard connected, !source.isEmpty, !active, !scanning else { return }
        let scopeKey = source + "|" + dayLabel(since)
        if lastScopeKey != scopeKey { seen = []; lastScopeKey = scopeKey }
        if !observing { PHPhotoLibrary.shared().register(self); observing = true }
        active = true; message = "Watching only the selected source while this app is open."
        scan()
    }

    func pause() {
        if observing { PHPhotoLibrary.shared().unregisterChangeObserver(self); observing = false }
        active = false; generation += 1; scanAgain = false
        activeRead?.cancel(); activeRead = nil; task?.cancel(); task = nil; scanning = false
        message = "Paused. Prepared photos remain in memory until you export or clear them."
    }

    func disconnect() {
        pause()
        connected = false; source = ""; albums = []; photos = []; seen = []; lastScopeKey = nil; exported = false; skipped = 0
        message = "Disconnected and in-memory photos cleared. Revoke the OS grant in System Settings → Privacy & Security → Photos. Exported files and saved Proof are unchanged."
    }

    func clearPrepared() {
        pause(); photos = []; exported = false; skipped = 0
        message = "Prepared photos cleared. This session remembers photos already gathered from the same source. The scan is the most recent 50, not a full-library import."
    }

    func removePrepared(_ id: String) {
        pause(); photos.removeAll { $0.id == id }; exported = false
        message = "Removed from this batch only. Original Photos and exported files are unchanged."
    }

    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor [weak self] in
            guard let self, self.active else { return }
            if self.scanning { self.scanAgain = true } else { self.scan() }
        }
    }

    func scan() {
        guard active, connected, !scanning else { return }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            disconnect(); message = "Photos permission was revoked. Disconnected; no further reading."
            return
        }
        let selectedSource = source
        let earliest = Calendar.current.startOfDay(for: since)
        let options = PHFetchOptions()
        options.fetchLimit = ReviewLimits.photoCount
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.includeHiddenAssets = false; options.includeAllBurstAssets = false
        options.includeAssetSourceTypes = .typeUserLibrary
        var predicates = [NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue), NSPredicate(format: "creationDate >= %@", earliest as NSDate)]
        let assets: PHFetchResult<PHAsset>
        let scope: String
        if selectedSource == "favorites" {
            predicates.append(NSPredicate(format: "favorite == YES"))
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
            assets = PHAsset.fetchAssets(with: options)
            scope = "Favorites since \(dayLabel(earliest))"
        } else {
            guard let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [selectedSource], options: nil).firstObject else {
                pause(); message = "The selected album is no longer available. Clear this batch to choose another source."; return
            }
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
            assets = PHAsset.fetchAssets(in: album, options: options)
            scope = "Album \(String((album.localizedTitle ?? "Untitled").prefix(100))) since \(dayLabel(earliest))"
        }
        let batch = (0..<assets.count).map { assets.object(at: $0) }.filter { !seen.contains($0.localIdentifier) }
        scanning = true; skipped = 0; scanAgain = false
        let scanGeneration = generation
        task = Task { [weak self] in
            guard let self else { return }
            for asset in batch {
                guard !Task.isCancelled, self.active, self.generation == scanGeneration else { return }
                if self.photos.count >= ReviewLimits.photoCount { self.pause(); self.message = "Review is full. Export and clear this batch before starting again."; return }
                do {
                    guard let resource = PHAssetResource.assetResources(for: asset).first(where: { $0.type == .photo }) else { throw ReviewError.invalidPhoto }
                    let original = try await self.read(resource)
                    guard !Task.isCancelled, self.active, self.generation == scanGeneration else { return }
                    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                    guard status == .authorized || status == .limited else { self.disconnect(); return }
                    let rendition = try self.rendition(original, resource: resource)
                    let photo = try ReviewPhoto.make(original: original, media: rendition.data, filename: rendition.filename,
                                                     originalFilename: resource.originalFilename, mimeType: rendition.mime,
                                                     assetIdentifier: asset.localIdentifier, creationDate: asset.creationDate,
                                                     timeZone: .current, scope: scope, isPreview: rendition.preview)
                    guard self.preparedBytes + photo.byteCount <= ReviewLimits.packageBytes else {
                        self.pause(); self.message = "Review reached its 47 MiB limit. Export and clear this batch first."; return
                    }
                    self.seen.insert(asset.localIdentifier)
                    if !self.photos.contains(where: { $0.sha256 == photo.sha256 }) { self.photos.append(photo); self.exported = false }
                } catch {
                    guard self.generation == scanGeneration, self.active, !Task.isCancelled else { return }
                    self.skipped += 1
                }
            }
            guard self.generation == scanGeneration else { return }
            self.scanning = false; self.activeRead = nil; self.task = nil
            self.message = "\(self.photos.count) prepared for review. \(self.skipped) skipped this scan (cloud-only, unsupported, or too large). Nothing saved as Proof."
            if self.scanAgain { self.scan() }
        }
    }

    private func read(_ resource: PHAssetResource) async throws -> Data {
        let stream = ResourceRead(); activeRead = stream
        let options = PHAssetResourceRequestOptions(); options.isNetworkAccessAllowed = false
        return try await withCheckedThrowingContinuation { continuation in
            let requestID = PHAssetResourceManager.default().requestData(for: resource, options: options,
                dataReceivedHandler: { stream.append($0) }, completionHandler: { continuation.resume(with: stream.finish($0)) })
            stream.attach(requestID)
        }
    }

    private func rendition(_ original: Data, resource: PHAssetResource) throws -> (data: Data, filename: String, mime: String, preview: Bool) {
        let type = UTType(resource.uniformTypeIdentifier)
        if let mime = type?.preferredMIMEType, ["image/jpeg", "image/png", "image/gif", "image/webp"].contains(mime) {
            return (original, resource.originalFilename, mime, false)
        }
        // HEIC/HEIF only: orientation-correct, uncropped JPEG preview. Keep the
        // original resource digest and label the derivative; never modify Photos.
        guard ["heic", "heif"].contains(type?.preferredFilenameExtension?.lowercased() ?? ""),
              let source = CGImageSourceCreateWithData(original as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 4096,
              ] as CFDictionary) else { throw ReviewError.invalidPhoto }
        let result = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(result, UTType.jpeg.identifier as CFString, 1, nil) else { throw ReviewError.invalidPhoto }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw ReviewError.invalidPhoto }
        return (result as Data, (resource.originalFilename as NSString).deletingPathExtension + "-proof-preview.jpg", "image/jpeg", true)
    }

    func exportReview() {
        pause()
        do {
            let data = try ReviewPackage(items: photos).encoded()
            let panel = NSSavePanel(); panel.allowedContentTypes = [.json]
            panel.nameFieldStringValue = "proof-photos-\(dayLabel(Date())).proof-inbox.json"
            panel.message = "Private, unencrypted photo review file. Keep it out of public folders and source repositories. Import it using Photos & media → Import companion review, not Restore."
            guard panel.runModal() == .OK, let url = panel.url else { return }
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            exported = true
            message = "Review file exported. In Proof Gallery, choose Photos & media → Import companion review. This did not save or upload any Proof."
        } catch { message = "Export failed: \(error.localizedDescription)" }
    }

    private func dayLabel(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
