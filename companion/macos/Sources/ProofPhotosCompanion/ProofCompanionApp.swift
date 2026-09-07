import SwiftUI
import AppKit
import CompanionCore

@main enum ProofCompanionApp {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = CompanionAppDelegate()
        app.setActivationPolicy(.regular); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor final class CompanionAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let model: PhotosModel
    let storage: NativeVaultController
    override init() {
        let model = PhotosModel(); self.model = model
        storage = NativeVaultController(onReady: { [weak model] in model?.attachVault($0) ?? false },
                                        beforeClear: { [weak model] in model?.prepareForVaultClear() })
        super.init()
    }
    private var window: NSWindow?
    private var statusItem: NSStatusItem?
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu(); let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit Proof Photos Companion", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        NSApp.mainMenu = menu
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 780),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Proof Photos Companion"; window.delegate = self
        window.contentView = NSHostingView(rootView: CompanionView(model: model, storage: storage))
        window.center(); window.makeKeyAndOrderFront(nil); self.window = window
        NSApp.activate(ignoringOtherApps: true)
        let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(systemSymbolName: "photo.on.rectangle", accessibilityDescription: "Proof Photos")
        let statusMenu = NSMenu()
        for (title, action) in [("Open Proof Photos", #selector(reopenWindow)), ("Pause collection", #selector(pauseCollection)), ("Quit Proof Photos", #selector(quitCompanion))] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self; statusMenu.addItem(item)
        }
        status.menu = statusMenu; statusItem = status
        storage.restoreIfConfigured()
    }
    @objc private func reopenWindow() { window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc private func pauseCollection() { model.pause() }
    @objc private func quitCompanion() { NSApp.terminate(nil) }
    private func suspendForegroundCollection() {
        model.suspendForHiddenWindow()
    }
    func applicationWillHide(_ notification: Notification) { suspendForegroundCollection() }
    func windowDidMiniaturize(_ notification: Notification) { suspendForegroundCollection() }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        reopenWindow(); return true
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if model.backgroundEnabled || storage.keepsServicesRunningAfterWindowClose {
            // iCloud is only a visible, separately authorized one-shot batch.
            model.suspendForHiddenWindow()
            sender.orderOut(nil); return false
        }
        // Route closing through the same unsaved-export guard as Cmd-Q.
        NSApp.terminate(nil); return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if !model.photos.isEmpty && !model.exported {
            let alert = NSAlert(); alert.messageText = "Quit without exporting these photos?"
            alert.informativeText = "Prepared photos are only in memory. Originals remain in Photos, but this unexported review batch will be discarded."
            alert.addButton(withTitle: "Keep open"); alert.addButton(withTitle: "Quit and discard")
            if alert.runModal() != .alertSecondButtonReturn { return .terminateCancel }
        }
        model.stopForTermination()
        return .terminateNow
    }
    func applicationWillTerminate(_ notification: Notification) { model.stopForTermination(); storage.stopForTermination() }
}

struct CompanionView: View {
    @ObservedObject var model: PhotosModel
    @ObservedObject var storage: NativeVaultController
    @StateObject private var login = LoginItemController(service: SystemLoginItemService())
    @State private var confirmDisconnect = false
    @State private var confirmClear = false
    @State private var query = ""
    @State private var onlyText = false
    @State private var folderCategory = "creativity"
    @State private var folderTags = ""
    private var visiblePhotos: [ReviewPhoto] {
        model.photos.filter { photo in
            guard let context = model.contexts[photo.id] else { return query.isEmpty && !onlyText }
            return (!onlyText || context.textStatus == .found) && context.matches(query,
                filename: photo.receipt.originalFilename, scope: photo.receipt.scope, occurredOn: photo.occurredOn)
        }
    }
    var body: some View {
            ScrollView { VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    Image(systemName: "photo.on.rectangle.angled").font(.largeTitle).foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Proof Photos").font(.title.weight(.medium))
                        Text("Loved. Valued. Connected. Accomplished.").foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(model.active ? (model.allowICloudDownloads ? "Private · iCloud download batch" : "Watching selected source") : "Private · on-device review").font(.caption).foregroundStyle(.secondary)
                }
                Text("Let your photos be easier to find. Choose a source; review what belongs in Proof. No image is labelled as love, identity, or accomplishment for you.")
                NativeVaultView(storage: storage)
                Toggle("Start this companion when I log in", isOn: Binding(
                    get: { login.state == .enabled || login.state == .requiresApproval },
                    set: { login.setEnabled($0) }))
                Text(login.state == .requiresApproval ? "Allow the login item in System Settings. This does not grant source access." : "Separate from source and background permission. Quit stops collection until the companion runs again.")
                    .font(.caption).foregroundStyle(.secondary)
                if login.actionFailed { Text("macOS could not change the login item. Its current status is shown; check System Settings.").font(.caption) }
                if model.hasVault {
                    Toggle("Keep this selected source collecting when the window is closed", isOn: Binding(
                        get: { model.backgroundEnabled }, set: { model.setBackgroundEnabled($0) }))
                        .disabled(!model.canSetBackground)
                    Text("Saved separately for this source. Start after changing it. Local files only in background; text recognition stays off.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("Choose a local folder…", action: model.chooseFolder).disabled(model.sourceLocked)
                    if model.folderSelected {
                        Text("Selected folder: \(model.selectedSourceLabel)").font(.caption)
                        if model.trustedFolder {
                            Button("Require individual review again", action: model.requireFolderReview)
                        } else {
                            HStack {
                                Picker("Your category", selection: $folderCategory) {
                                    ForEach(["belonging", "competence", "creativity", "parenting", "recovery", "money", "shipped", "awards", "kindness_received"], id: \.self) { Text($0).tag($0) }
                                }
                                TextField("Your tags, separated by commas", text: $folderTags)
                            }
                            Button("Automatically save from this exact folder…") {
                                model.confirmTrustedFolder(category: folderCategory,
                                    tags: folderTags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
                            }
                        }
                    }
                    if model.canTrustPhotos {
                        if model.trustedFolder {
                            Button("Require individual Photos review again", action: model.requireFolderReview)
                        } else {
                            HStack {
                                Picker("Your category", selection: $folderCategory) {
                                    ForEach(["belonging", "competence", "creativity", "parenting", "recovery", "money", "shipped", "awards", "kindness_received"], id: \.self) { Text($0).tag($0) }
                                }
                                TextField("Your tags, separated by commas", text: $folderTags)
                            }
                            Button("Automatically save from this Photos source…") {
                                model.confirmTrustedPhotos(category: folderCategory, tags: folderTags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
                            }
                        }
                    }
                }
                if !model.connected {
                    Button(model.connecting ? "Waiting for Photos permission…" : "Connect Apple Photos", action: model.connect)
                        .buttonStyle(.borderedProminent).disabled(model.connecting)
                    Text("macOS calls this a read/write Photos grant. This app only reads: it never edits or deletes Photos. You choose the narrower source below after connecting.")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    if !model.folderSelected { HStack {
                        Picker("Source", selection: $model.source) {
                            Text("Choose a source").tag("")
                            Text("Recent Photos (no Favorites needed)").tag("recent")
                            Text("Favorites").tag("favorites")
                            ForEach(model.albums) { Text($0.title).tag($0.id) }
                        }.disabled(model.sourceLocked)
                        DatePicker("Since", selection: $model.since, in: ...Date(), displayedComponents: .date).disabled(model.sourceLocked)
                    }
                    }
                    Toggle("Read text in these images on this Mac", isOn: $model.readTextLocally).disabled(model.sourceLocked || model.folderSelected || model.backgroundEnabled)
                    Text("Optional on-device text recognition. May misread or miss words; it does not decide what is meaningful. Text stays in this companion, not the exported file. No images or text are uploaded.")
                        .font(.caption).foregroundStyle(.secondary)
                    Toggle("Download missing originals from iCloud for this batch", isOn: $model.allowICloudDownloads)
                        .disabled(model.active || model.scanning || model.folderSelected)
                    Text("Off by default. Uses your Apple Photos account, data, and disk space for up to 50 selected photos. Photos may cache larger originals before our size check. Switches off after this batch or Pause. No uploads or cloud AI.")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button(model.active ? "Pause" : "Start selected source") { model.active ? model.pause() : model.start() }
                            .buttonStyle(.borderedProminent).disabled(model.source.isEmpty)
                        Button("Check now", action: model.scan).disabled(!model.active || model.scanning)
                        Spacer()
                        Button("Disconnect") { confirmDisconnect = true }
                    }
                }
                Text(model.message).font(.callout).textSelection(.enabled)
                if model.hasVault {
                    Text("Native vault: \(model.durableCount) new images retained during this run. Prepared-photo controls below affect only the export batch, not the vault.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                HStack {
                    Button("Connect to Gallery on this Mac", action: model.startBridge).disabled(model.scanning)
                    if !model.pairingCode.isEmpty {
                        Button("Copy pairing code") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(model.pairingCode, forType: .string) }
                        Button("Stop connection", action: model.stopBridge)
                    }
                }
                Text("Optional same-Mac transfer and on-device text tools. The code grants access for five minutes; do not share it. Stop revokes the session, but cannot retract bytes already received. No internet AI or automatic Proof approval.")
                    .font(.caption).foregroundStyle(.secondary)
                if !model.skipSummary.isEmpty {
                    Text("Skipped: \(model.skipSummary)").font(.caption).foregroundStyle(.secondary)
                }
                if model.scanning { ProgressView().controlSize(.small) }
                HStack {
                    Text("\(model.photos.count) photos · \(ByteCountFormatter.string(fromByteCount: Int64(model.preparedBytes), countStyle: .file))").font(.headline)
                    Spacer()
                    Button("Export for review…", action: model.exportReview).disabled(model.photos.isEmpty || model.scanning)
                    Button("Clear prepared photos") { confirmClear = true }.disabled(model.photos.isEmpty)
                }
                HStack {
                    TextField("Find filename, date, source, or machine-read words", text: $query).textFieldStyle(.roundedBorder)
                    Toggle("With detected text", isOn: $onlyText)
                }
                if !model.photos.isEmpty {
                    Text("Showing \(visiblePhotos.count) of \(model.photos.count). Export includes the whole batch, not just these matches.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 185))], spacing: 16) {
                        ForEach(visiblePhotos) { photo in
                            VStack(alignment: .leading, spacing: 6) {
                                if let bytes = Data(base64Encoded: photo.base64), let image = NSImage(data: bytes) {
                                    Image(nsImage: image).resizable().scaledToFit().frame(height: 150)
                                }
                                Text(photo.receipt.originalFilename).font(.caption).lineLimit(2)
                                Text("Date from Photos: \(photo.occurredOn ?? "unknown")").font(.caption).foregroundStyle(.secondary)
                                Text(photo.receipt.scope).font(.caption2).foregroundStyle(.secondary)
                                if let context = model.contexts[photo.id] { PhotoContextView(context: context) }
                                Text(photo.receipt.representation == "jpeg-preview" ? "JPEG preview · original stays in Photos" : "Original photo bytes")
                                    .font(.caption2).foregroundStyle(.secondary)
                                Button("Remove from this batch") { model.removePrepared(photo.id) }.font(.caption)
                            }.padding(10).background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    if !model.photos.isEmpty && visiblePhotos.isEmpty {
                        Text("No matches in this batch. Missing text is not missing evidence. Try clearing the filter.")
                            .foregroundStyle(.secondary).padding()
                    }
                }.frame(minHeight: 180)
                Text("Still photos only, including the still part of Live Photos. Most recent 50 in the selected date range; retained media: 10 MiB each / 47 MiB per batch. iCloud downloads require the separate option above. Background collection requires its separate source choice and the companion process running. Quit stops collection. No face recognition or AI uploads. Original media may contain private EXIF metadata.")
                    .font(.caption).foregroundStyle(.secondary)
                Text("Prepared photos are memory-only until exported. The export is not a saved-Proof backup. Import it into the private review inbox; category and saving remain your choice.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(24) }.frame(minWidth: 730, minHeight: 650)
            .confirmationDialog("Disconnect and discard prepared photos?", isPresented: $confirmDisconnect) {
                Button("Disconnect and clear", role: .destructive, action: model.disconnect)
            } message: { Text("Unexported photos will leave this app. Originals, exported files, and saved Proof are untouched. Revoke the OS grant separately in System Settings.") }
            .confirmationDialog("Clear prepared photos?", isPresented: $confirmClear) {
                Button("Clear prepared photos", role: .destructive, action: model.clearPrepared)
            } message: { Text("Export first if you want to keep this batch. Originals and exported review files are untouched.") }
    }
}

private struct PhotoContextView: View {
    let context: LocalPhotoContext
    @State private var draft = LocalReviewDraft()
    @State private var editingDraft = false
    @State private var draftCopied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(context.pixelWidth) × \(context.pixelHeight) pixels").font(.caption2).foregroundStyle(.secondary)
            if context.isScreenshot { Text("Screenshot · Photos metadata").font(.caption2) }
            if context.isLivePhoto { Text("Live Photo · still image only").font(.caption2) }
            if context.isFavorite { Text("Marked Favorite in Photos").font(.caption2) }
            switch context.textStatus {
            case .found:
                DisclosureGroup("Machine-read text · unverified excerpt") {
                    Text("May be wrong or incomplete. Check the image before using any words as a quote. This text is not exported.")
                        .font(.caption2).foregroundStyle(.secondary)
                    Text(context.recognizedText).font(.caption).textSelection(.enabled)
                    if !editingDraft {
                        Button("Use text in a review note") {
                            if draft.useMachineReadText(context) { editingDraft = true; draftCopied = false }
                        }
                    } else {
                        Text("Review-note draft · unverified").font(.caption).bold()
                        Text("Edit while checking the image. Nothing here is saved or included in the review-file export. Copy, then paste into the photo’s short note in Proof Gallery.")
                            .font(.caption2).foregroundStyle(.secondary)
                        TextEditor(text: $draft.text)
                            .font(.caption).frame(minHeight: 90)
                            .accessibilityLabel("Unverified review-note draft")
                            .onChange(of: draft.text) { _, _ in draftCopied = false }
                        Text("\(draft.text.count) / \(LocalReviewDraft.maximumCharacters) characters")
                            .font(.caption2).foregroundColor(draft.text.count > LocalReviewDraft.maximumCharacters ? .red : .secondary)
                        Button(draftCopied ? "Draft copied" : "Copy review note") {
                            guard let text = draft.clipboardText else { return }
                            NSPasteboard.general.clearContents()
                            draftCopied = NSPasteboard.general.setString(text, forType: .string)
                        }.disabled(draft.clipboardText == nil)
                        Text("Copy includes an unverified-draft label. Your system clipboard may sync to other devices; copy only if that is okay. This draft disappears when its photo leaves this view or the app closes.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }.font(.caption)
            case .notFound: Text("No text detected; the photo may still matter.").font(.caption2).foregroundStyle(.secondary)
            case .unavailable: Text("Text recognition unavailable; image retained.").font(.caption2).foregroundStyle(.secondary)
            case .off: EmptyView()
            }
        }
    }
}
