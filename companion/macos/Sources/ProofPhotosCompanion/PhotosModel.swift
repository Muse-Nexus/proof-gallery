import AppKit
import Photos
import ImageIO
import UniformTypeIdentifiers
import CompanionCore
import CompanionVision
import CompanionVault

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
    func timeOut() {
        lock.lock()
        if failure == nil { failure = ReviewError.readTimedOut; data.removeAll() }
        let id = requestID; lock.unlock()
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
    // Remains false until the shared vault confirms durable explicit consent.
    @Published private(set) var backgroundEnabled = false
    @Published var scanning = false
    @Published var albums: [PhotoAlbum] = []
    @Published var source = ""
    @Published var since = Calendar.current.date(byAdding: .day, value: -90, to: Date())!
    @Published var photos: [ReviewPhoto] = []
    @Published var contexts: [String: LocalPhotoContext] = [:]
    @Published var readTextLocally = false
    @Published var allowICloudDownloads = false
    @Published var message = "Connect only when you are ready to choose a photo source."
    @Published var skipped = 0
    @Published var skipReasons: [String: Int] = [:]
    @Published var exported = false
    @Published var pairingCode = ""
    private var vault: (any VaultAuthority)?
    var localVault: (any VaultAuthority)? { vault }
    @Published private var sourceGrant: VaultSourceGrant?
    @Published private(set) var folderSelected = false
    @Published private(set) var durableCount = 0
    var hasVault: Bool { vault != nil }
    var canSetBackground: Bool { sourceGrant != nil }
    var trustedFolder: Bool { sourceGrant?.configuration.mode == .trusted }
    var canTrustPhotos: Bool { sourceGrant?.configuration.provider == .photos }
    var selectedSourceLabel: String { sourceGrant?.configuration.label ?? "" }
    private let bridge = LocalBridge()
    private var bridgeGeneration = UUID()
    private var generation = 0
    private var seen = Set<String>()
    private var task: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private var activeRead: ResourceRead?
    private var activeTextRead: LocalTextRead?
    private var scanAgain = false
    private var observing = false
    private var lastScopeKey: String?

    init(vault: (any VaultAuthority)? = nil) {
        self.vault = vault
        super.init()
    }

    @discardableResult func attachVault(_ authority: any VaultAuthority) -> Bool {
        if let vault { return vault === authority }
        // Preserve a prepared legacy batch, but stop its in-flight reads before
        // switching the collector to this explicitly selected durable authority.
        stopForTermination()
        vault = authority
        objectWillChange.send()
        restoreSource()
        return true
    }

    // Explicit startup reconciliation: no authorization prompts or fallback scope.
    func restoreSource() {
        guard let vault else { return }
        do {
            let grants = try vault.sourceGrants().filter { !$0.revoked }
            guard grants.count <= 1 else { message = "Multiple sources need review. Collection has not started."; return }
            guard let grant = grants.first else { return }
            sourceGrant = grant; backgroundEnabled = grant.configuration.backgroundEnabled
            if grant.configuration.provider == .folder {
                folderSelected = true; source = "folder"; connected = true
            } else {
                guard case .string(let selected) = grant.configuration.selection["source"],
                      case .number(let floor) = grant.configuration.selection["since"] else { throw VaultError.invalid }
                source = selected; since = Date(timeIntervalSince1970: floor)
                let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                guard status == .authorized || status == .limited else {
                    sourceGrant = try vault.pauseSource(id: grant.id, revision: grant.revision)
                    message = "Photos permission is unavailable. Collection remains paused."; return
                }
                connected = true
            }
            if backgroundEnabled && !grant.paused { start() }
            else { message = "Source restored paused. Start explicitly to collect." }
        } catch { message = "Could not restore the source safely. Collection has not started." }
    }

    func chooseFolder() {
        guard vault != nil, !active, !scanning else { return }
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.message = "Choose one folder. Only top-level local images will be collected for review after Start. No cloud downloads."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let bookmark = try FolderCollector.bookmark(for: url)
            if let grant = sourceGrant { try vault?.revokeSource(id: grant.id, revision: grant.revision) }
            sourceGrant = try vault?.createSourceGrant(VaultSourceConfiguration(provider: .folder,
                sourceID: UUID().uuidString, label: String(url.lastPathComponent.prefix(200)), selection: ["bookmark": .string(bookmark.base64EncodedString())]))
            // Selection creates a paused grant; source access still needs Start.
            if let grant = sourceGrant { sourceGrant = try vault?.pauseSource(id: grant.id, revision: grant.revision) }
            folderSelected = true; connected = true; source = "folder"; backgroundEnabled = false
            message = "Folder selected. Start when ready; new images go to private pending review."
        } catch { message = "Could not remember this folder safely. Collection has not started." }
    }

    func confirmTrustedFolder(category: String, tags: [String]) {
        pause()
        guard let vault, let grant = sourceGrant, grant.configuration.provider == .folder,
              case .string(let encoded) = grant.configuration.selection["bookmark"],
              let bookmark = Data(base64Encoded: encoded) else { return }
        do {
            var stale = false
            let url = try URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope, .withoutUI, .withoutMounting],
                              relativeTo: nil, bookmarkDataIsStale: &stale)
            guard !stale else { throw VaultError.invalid }
            let alert = NSAlert()
            alert.messageText = "Automatically save new images from this exact folder?"
            alert.informativeText = "Folder: \(url.path)\nCategory: \(category)\nTags: \(tags.joined(separator: ", "))\n\nNew validated images from this folder will be saved as Proof without individual review after you press Start. Existing pending items stay pending. This does not enable background collection or grant another source."
            alert.addButton(withTitle: "Keep individual review")
            alert.addButton(withTitle: "Confirm this exact folder")
            guard alert.runModal() == .alertSecondButtonReturn else { return }
            var config = grant.configuration; config.mode = .trusted; config.category = category; config.tags = tags
            sourceGrant = try vault.updateSourceGrant(id: grant.id, revision: grant.revision, configuration: config, paused: true)
            message = "Exact folder approval saved. Start to automatically save new images with your category and tags."
        } catch { message = "Could not confirm this folder safely. Collection remains paused." }
    }

    func requireFolderReview() {
        pause()
        guard let vault, let grant = sourceGrant else { return }
        var config = grant.configuration; config.mode = .review; config.category = nil; config.tags = []
        do {
            sourceGrant = try vault.updateSourceGrant(id: grant.id, revision: grant.revision, configuration: config, paused: true)
            message = "Individual review restored for new images. Start when ready."
        } catch { message = "Collection stopped. The changed review choice could not be saved." }
    }

    func confirmTrustedPhotos(category: String, tags: [String]) {
        pause()
        guard let vault, let grant = sourceGrant, grant.configuration.provider == .photos else { return }
        let alert = NSAlert()
        alert.messageText = "Automatically save from this selected Photos source?"
        alert.informativeText = "Source: \(grant.configuration.label)\nSelected ID: \(grant.configuration.sourceID)\nSince: \(dayLabel(since))\nCategory: \(category)\nTags: \(tags.joined(separator: ", "))\n\nNew validated images in this bounded source will be saved without individual review after Start. Existing pending items stay pending. No identity or emotional meaning is inferred. Background and iCloud access remain separate choices."
        alert.addButton(withTitle: "Keep individual review"); alert.addButton(withTitle: "Confirm this Photos source")
        guard alert.runModal() == .alertSecondButtonReturn else { return }
        var config = grant.configuration; config.mode = .trusted; config.category = category; config.tags = tags
        do {
            sourceGrant = try vault.updateSourceGrant(id: grant.id, revision: grant.revision, configuration: config, paused: true)
            message = "Selected Photos source approved. Start to save new images with your category and tags."
        } catch { message = "Could not confirm the selected source. Collection remains paused." }
    }

    func setBackgroundEnabled(_ enabled: Bool) {
        pause()
        guard let vault, var config = sourceGrant?.configuration, let grant = sourceGrant else {
            message = "Start a selected source before changing its background choice."; return
        }
        config.backgroundEnabled = enabled
        do {
            sourceGrant = try vault.updateSourceGrant(id: grant.id, revision: grant.revision, configuration: config, paused: true)
            backgroundEnabled = enabled
            message = "Background choice saved. Start this source to collect; login startup is separate."
        } catch { backgroundEnabled = false; message = "Could not save background consent. Collection remains paused." }
    }

    private func activateGrant() throws {
        guard let vault else { return }
        let config: VaultSourceConfiguration
        if folderSelected {
            guard let existing = sourceGrant else { throw VaultError.invalid }
            config = existing.configuration
        } else {
            if sourceGrant == nil { since = Calendar.current.startOfDay(for: since) }
            let selection: [String: VaultJSON] = ["source": .string(source), "since": .number(since.timeIntervalSince1970)]
            if let existing = sourceGrant {
                guard existing.configuration.provider == .photos, existing.configuration.sourceID == source,
                      existing.configuration.selection == selection else { throw VaultError.staleRevision }
                config = existing.configuration
            } else {
                config = VaultSourceConfiguration(provider: .photos, sourceID: source,
                    label: source == "recent" ? "Recent Photos" : source == "favorites" ? "Favorites" : "Selected Photos album",
                    backgroundEnabled: backgroundEnabled, selection: selection)
            }
        }
        if let grant = sourceGrant {
            guard grant.configuration.provider == config.provider, grant.configuration.sourceID == config.sourceID,
                  grant.configuration.selection == config.selection else { throw VaultError.staleRevision }
            sourceGrant = try vault.updateSourceGrant(id: grant.id, revision: grant.revision, configuration: config, paused: false)
        } else { sourceGrant = try vault.createSourceGrant(config) }
    }

    private func scanFolder() {
        guard let vault, let grant = sourceGrant,
              case .string(let encoded) = grant.configuration.selection["bookmark"],
              let bookmark = Data(base64Encoded: encoded) else { pause(); return }
        scanning = true
        let scanGeneration = generation
        task = Task { [weak self] in
            guard let self else { return }
            do {
                try await FolderCollector.scan(bookmark: bookmark, isHandled: { try vault.hasHandled(sourceGrantID: grant.id, sha256: $0) }) { item in
                    guard self.active, self.generation == scanGeneration, !Task.isCancelled else { throw CancellationError() }
                    let input = VaultInput(fields: VaultFields(source: "Selected folder"),
                        media: VaultMedia(filename: item.filename, mimeType: item.mimeType, sha256: item.sha256, bytes: item.data),
                        receipt: VaultProviderReceipt(provider: .folder, sourceID: grant.configuration.sourceID,
                            originalFilename: item.filename, originalSha256: item.sha256, scope: "Selected folder · top-level local images"))
                    let result = try vault.ingest(sourceGrantID: grant.id, revision: grant.revision, inputs: [input],
                        background: self.backgroundEnabled, isCancelled: { !self.active || self.generation != scanGeneration || Task.isCancelled })
                    self.durableCount += result.pending + result.saved
                }
                guard self.generation == scanGeneration else { return }
                self.scanning = false
                self.message = self.trustedFolder ? "Folder checked. New images were saved under your exact-folder approval." : "Folder checked. New images are in the private vault for review."
                // A bounded native poll also reconciles changes after sleep.
                try await Task.sleep(for: .seconds(60))
                guard self.active, self.generation == scanGeneration else { return }
                self.scan()
            } catch {
                guard self.generation == scanGeneration else { return }
                self.pause(); self.message = "Folder collection paused: source unavailable, capacity reached, or read/write failed. Reconnect if access changed."
            }
        }
    }

    var sourceLocked: Bool { active || scanning || !photos.isEmpty }
    var preparedBytes: Int { photos.reduce(0) { $0 + $1.byteCount } }
    var skipSummary: String {
        skipReasons.keys.sorted().map { "\(skipReasons[$0] ?? 0) \($0)" }.joined(separator: " · ")
    }

    func connect() {
        guard !connecting, !connected else { return }
        connecting = true
        let permissionGeneration = generation
        // Requesting permission is never a startup side effect.
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] status in
            Task { @MainActor in
                guard let self, self.generation == permissionGeneration else { return }
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
        do { try activateGrant() }
        catch { message = "Could not activate the exact source grant. Reconnect before collecting."; return }
        if folderSelected { active = true; scanFolder(); return }
        let scopeKey = source + "|" + dayLabel(since) + "|text:\(readTextLocally)"
        if lastScopeKey != scopeKey { seen = []; lastScopeKey = scopeKey }
        // Download consent is for one bounded scan, never a background watch.
        if !allowICloudDownloads && !observing { PHPhotoLibrary.shared().register(self); observing = true }
        active = true
        message = allowICloudDownloads ? "Preparing one selected batch. iCloud downloads allowed; processing stays on this Mac." : backgroundEnabled ? "Collecting the selected source into the private vault, including with this window closed." : "Watching only the selected source while this app is open."
        scan()
        if !allowICloudDownloads {
            pollTask?.cancel()
            pollTask = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(60)) } catch { return }
                    guard let self, self.active else { return }
                    self.scan()
                }
            }
        }
    }

    /// Process shutdown cancels current work but does not rewrite saved consent.
    /// An explicitly paused source remains paused because no grant is changed.
    func stopForTermination() {
        stopBridge()
        if observing { PHPhotoLibrary.shared().unregisterChangeObserver(self); observing = false }
        active = false; generation += 1; scanAgain = false
        pollTask?.cancel(); pollTask = nil
        activeRead?.cancel(); activeRead = nil; task?.cancel(); task = nil; scanning = false
        activeTextRead?.cancel(); activeTextRead = nil
        allowICloudDownloads = false
    }

    func pause() {
        stopForTermination()
        if let vault, let grant = sourceGrant {
            do { sourceGrant = try vault.pauseSource(id: grant.id, revision: grant.revision) }
            catch { message = "Collection stopped. Durable pause could not be confirmed; reconnect before restarting."; return }
        }
        message = "Paused. Prepared photos remain in memory until you export or clear them."
    }

    func prepareForVaultClear() {
        pause(); sourceGrant = nil; source = ""; backgroundEnabled = false; folderSelected = false
        connected = false; photos = []; contexts = [:]; seen = []; lastScopeKey = nil
        message = "Collection stopped for native storage clearing."
    }

    func stopBridge() {
        bridgeGeneration = UUID(); pairingCode = ""; bridge.stop()
    }

    func startBridge() {
        pause()
        let generation = bridgeGeneration
        let snapshot = photos
        message = "Preparing a five-minute same-Mac connection. No internet upload."
        Task {
            do {
                let data = try await Task.detached { snapshot.isEmpty ? nil : try ReviewPackage(items: snapshot).encoded() }.value
                guard bridgeGeneration == generation else { return }
                bridge.start(review: data) { [weak self] code in
                    Task { @MainActor in
                        guard let self, self.bridgeGeneration == generation else { return }
                        self.pairingCode = code ?? ""
                        self.message = code == nil ? "Connection stopped or expired. Start again to pair." : "Paste the pairing code into Proof Gallery → Connect this Mac. Only prepared photos can transfer; text tools run on this Mac. Expires in five minutes."
                    }
                }
            } catch { message = "Could not prepare this connection. The review-file export is still available." }
        }
    }

    func disconnect() {
        pause()
        if let vault, let grant = sourceGrant {
            do { try vault.revokeSource(id: grant.id, revision: grant.revision); sourceGrant = nil }
            catch { message = "Reading stopped, but durable revocation failed. Retry Disconnect before quitting."; return }
        }
        backgroundEnabled = false; folderSelected = false; connecting = false
        connected = false; source = ""; albums = []; photos = []; contexts = [:]; seen = []; lastScopeKey = nil; exported = false; skipped = 0; skipReasons = [:]
        message = "Disconnected and in-memory photos cleared. Revoke the OS grant in System Settings → Privacy & Security → Photos. Exported files and the native vault, including pending candidates, are unchanged."
    }

    func clearPrepared() {
        pause(); photos = []; contexts = [:]; exported = false; skipped = 0; skipReasons = [:]
        message = "Prepared photos cleared. This session remembers photos already gathered from the same source. The scan is the most recent 50, not a full-library import."
    }

    func removePrepared(_ id: String) {
        pause(); photos.removeAll { $0.id == id }; contexts.removeValue(forKey: id); exported = false
        message = "Removed from this batch only. Original Photos and exported files are unchanged."
    }

    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor [weak self] in
            guard let self, self.active, self.observing, !self.allowICloudDownloads else { return }
            if self.scanning { self.scanAgain = true } else { self.scan() }
        }
    }

    func scan() {
        guard active, connected, !scanning else { return }
        if folderSelected { scanFolder(); return }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            disconnect(); message = "Photos permission was revoked. Disconnected; no further reading."
            return
        }
        let selectedSource = source
        let shouldReadText = readTextLocally && !backgroundEnabled
        let mayDownload = allowICloudDownloads
        let earliest = sourceGrant == nil ? Calendar.current.startOfDay(for: since) : since
        let options = PHFetchOptions()
        options.fetchLimit = ReviewLimits.photoCount
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.includeHiddenAssets = false; options.includeAllBurstAssets = false
        options.includeAssetSourceTypes = .typeUserLibrary
        var predicates = [NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue),
                          NSPredicate(format: "creationDate >= %@", earliest as NSDate),
                          NSPredicate(format: "creationDate <= %@", Date() as NSDate)]
        let assets: PHFetchResult<PHAsset>
        let scope: String
        if selectedSource == "favorites" || selectedSource == "recent" {
            if selectedSource == "favorites" { predicates.append(NSPredicate(format: "favorite == YES")) }
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
            assets = PHAsset.fetchAssets(with: options)
            scope = "\(selectedSource == "recent" ? "Recent photos" : "Favorites") since \(dayLabel(earliest))"
        } else {
            guard let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [selectedSource], options: nil).firstObject else {
                pause(); message = "The selected album is no longer available. Clear this batch to choose another source."; return
            }
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
            assets = PHAsset.fetchAssets(in: album, options: options)
            scope = "Album \(String((album.localizedTitle ?? "Untitled").prefix(100))) since \(dayLabel(earliest))"
        }
        let batch = (0..<assets.count).map { assets.object(at: $0) }.filter { !seen.contains($0.localIdentifier) }
        scanning = true; skipped = 0; skipReasons = [:]; scanAgain = false
        let scanGeneration = generation
        task = Task { [weak self] in
            guard let self else { return }
            for (index, asset) in batch.enumerated() {
                guard !Task.isCancelled, self.active, self.generation == scanGeneration else { return }
                let readPermission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                guard readPermission == .authorized || readPermission == .limited else { self.disconnect(); return }
                if !self.backgroundEnabled && self.photos.count >= ReviewLimits.photoCount { self.pause(); self.message = "Review is full. Export and clear this batch before starting again."; return }
                do {
                    guard let resource = PHAssetResource.assetResources(for: asset).first(where: { $0.type == .photo }) else { throw ReviewError.invalidPhoto }
                    self.message = "Preparing photo \(index + 1) of \(batch.count)\(mayDownload ? " · iCloud downloads allowed" : " · local originals only")."
                    let original = try await self.read(resource, allowNetwork: mayDownload, scanGeneration: scanGeneration, position: index + 1, total: batch.count)
                    guard !Task.isCancelled, self.active, self.generation == scanGeneration else { return }
                    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                    guard status == .authorized || status == .limited else { self.disconnect(); return }
                    let rendition = try self.rendition(original, resource: resource)
                    let photo = try ReviewPhoto.make(original: original, media: rendition.data, filename: rendition.filename,
                                                     originalFilename: resource.originalFilename, mimeType: rendition.mime,
                                                     assetIdentifier: asset.localIdentifier, creationDate: asset.creationDate,
                                                     timeZone: .current, scope: scope, isPreview: rendition.preview)
                    guard self.backgroundEnabled || self.preparedBytes + photo.byteCount <= ReviewLimits.packageBytes else {
                        self.pause(); self.message = "Review reached its 47 MiB limit. Export and clear this batch first."; return
                    }
                    var recognizedText = ""
                    var textStatus: LocalPhotoContext.TextStatus = .off
                    if shouldReadText {
                        self.message = "Reading text on this Mac · \(self.photos.count + 1) of up to \(batch.count). Nothing uploaded or saved as Proof."
                        let textRead = LocalTextRead(); self.activeTextRead = textRead
                        do {
                            recognizedText = try await textRead.read(rendition.data)
                            textStatus = recognizedText.isEmpty ? .notFound : .found
                        } catch { textStatus = .unavailable }
                        // Best-effort Vision cancellation alone is not a write gate.
                        guard !Task.isCancelled, self.active, self.generation == scanGeneration else { return }
                        self.activeTextRead = nil
                        let currentStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                        guard currentStatus == .authorized || currentStatus == .limited else { self.disconnect(); return }
                    }
                    if let vault = self.vault, let grant = self.sourceGrant {
                        let input = VaultInput(fields: VaultFields(occurredOn: photo.occurredOn, source: photo.receipt.scope),
                            media: VaultMedia(filename: photo.filename, mimeType: photo.mimeType, sha256: photo.sha256, bytes: rendition.data),
                            receipt: VaultProviderReceipt(provider: .photos, sourceID: grant.configuration.sourceID,
                                assetIdentifier: photo.receipt.assetIdentifier, originalFilename: photo.receipt.originalFilename,
                                originalSha256: photo.receipt.originalSha256, representation: photo.receipt.representation,
                                captureDate: photo.receipt.captureDate, timeZone: photo.receipt.timeZone, scope: photo.receipt.scope))
                        do {
                            let result = try vault.ingest(sourceGrantID: grant.id, revision: grant.revision,
                                inputs: [input], background: self.backgroundEnabled && !mayDownload,
                                isCancelled: { !self.active || self.generation != scanGeneration || Task.isCancelled })
                            self.durableCount += result.pending + result.saved
                        } catch {
                            self.pause(); self.message = "Collection paused. The vault could not safely retain this image; check capacity and source permission."; return
                        }
                    }
                    guard self.seen.count < 10_000 else { self.pause(); self.message = "Source session history reached its bound. Reopen the companion to reconcile with the vault."; return }
                    self.seen.insert(asset.localIdentifier)
                    if !self.backgroundEnabled && !self.photos.contains(where: { $0.sha256 == photo.sha256 }) {
                        self.contexts[photo.id] = LocalPhotoContext(pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight,
                            isScreenshot: asset.mediaSubtypes.contains(.photoScreenshot),
                            isLivePhoto: asset.mediaSubtypes.contains(.photoLive), isFavorite: asset.isFavorite,
                            textStatus: textStatus, recognizedText: recognizedText)
                        self.photos.append(photo); self.exported = false
                    }
                } catch {
                    guard self.generation == scanGeneration, self.active, !Task.isCancelled else { return }
                    self.skipped += 1
                    self.skipReasons[self.skipReason(error, downloadAllowed: mayDownload), default: 0] += 1
                }
            }
            guard self.generation == scanGeneration else { return }
            self.scanning = false; self.activeRead = nil; self.activeTextRead = nil; self.task = nil
            if mayDownload { self.pause() }
            self.message = self.hasVault ? (self.trustedFolder ? "Selected source checked. New images were saved under your source approval." : "Selected source checked. New candidates are in the private vault for review.") : "\(self.photos.count) prepared for review. \(self.skipped) skipped this scan. Nothing saved as Proof."
                + (mayDownload ? " Download batch finished and paused; download permission switched off." : "")
            if !mayDownload && self.scanAgain { self.scan() }
        }
    }

    private func skipReason(_ error: Error, downloadAllowed: Bool) -> String {
        if let error = error as? ReviewError {
            switch error {
            case .photoTooLarge: return "over 10 MiB"
            case .invalidSource: return "unsupported source metadata"
            case .readTimedOut: return "resource request timed out"
            default: return "unsupported or unavailable image"
            }
        }
        let error = error as NSError
        guard error.domain == PHPhotosErrorDomain else { return "local read failed" }
        switch error.code {
        case PHPhotosError.Code.networkAccessRequired.rawValue:
            return downloadAllowed ? "iCloud download unavailable" : "require an iCloud download (not allowed)"
        case PHPhotosError.Code.accessUserDenied.rawValue, PHPhotosError.Code.accessRestricted.rawValue: return "Photos access denied or restricted"
        case PHPhotosError.Code.libraryVolumeOffline.rawValue: return "library volume offline"
        case PHPhotosError.Code.missingResource.rawValue: return "original resource missing"
        default: return "Photos read failed (code \(error.code))"
        }
        // Never display error.userInfo/description: these may contain private paths or identifiers.
    }

    private func read(_ resource: PHAssetResource, allowNetwork: Bool, scanGeneration: Int, position: Int, total: Int) async throws -> Data {
        let stream = ResourceRead(); activeRead = stream
        let options = PHAssetResourceRequestOptions(); options.isNetworkAccessAllowed = allowNetwork
        if allowNetwork {
            options.progressHandler = { [weak self] progress in
                Task { @MainActor in
                    guard let self, self.active, self.scanning, self.generation == scanGeneration, self.activeRead === stream else { return }
                    guard progress.isFinite else { return }
                    self.message = "Preparing photo \(position) of \(total) · iCloud download \(Int(min(1, max(0, progress)) * 100))%. Processing stays on this Mac."
                }
            }
        }
        return try await withCheckedThrowingContinuation { continuation in
            let deadline = DispatchWorkItem { stream.timeOut() }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 120, execute: deadline)
            let requestID = PHAssetResourceManager.default().requestData(for: resource, options: options,
                dataReceivedHandler: { stream.append($0) }, completionHandler: {
                    deadline.cancel(); continuation.resume(with: stream.finish($0))
                })
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
