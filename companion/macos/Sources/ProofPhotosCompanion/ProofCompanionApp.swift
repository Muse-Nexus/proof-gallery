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
    let model = PhotosModel()
    private var window: NSWindow?
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu(); let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit Proof Photos Companion", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        NSApp.mainMenu = menu
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 780),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Proof Photos Companion"; window.delegate = self
        window.contentView = NSHostingView(rootView: CompanionView(model: model))
        window.center(); window.makeKeyAndOrderFront(nil); self.window = window
        NSApp.activate(ignoringOtherApps: true)
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        // Route closing through the same unsaved-export guard as Cmd-Q.
        NSApp.terminate(nil); return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        model.pause()
        if !model.photos.isEmpty && !model.exported {
            let alert = NSAlert(); alert.messageText = "Quit without exporting these photos?"
            alert.informativeText = "Prepared photos are only in memory. Originals remain in Photos, but this unexported review batch will be discarded."
            alert.addButton(withTitle: "Keep open"); alert.addButton(withTitle: "Quit and discard")
            if alert.runModal() != .alertSecondButtonReturn { return .terminateCancel }
        }
        return .terminateNow
    }
    func applicationWillTerminate(_ notification: Notification) { model.pause() }
}

struct CompanionView: View {
    @ObservedObject var model: PhotosModel
    @State private var confirmDisconnect = false
    @State private var confirmClear = false
    var body: some View {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    Image(systemName: "photo.on.rectangle.angled").font(.largeTitle).foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Proof Photos").font(.title.weight(.medium))
                        Text("Loved. Valued. Connected. Accomplished.").foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(model.active ? "Watching selected source" : "Private · local only").font(.caption).foregroundStyle(.secondary)
                }
                Text("Let your photos be easier to find. Choose a source; review what belongs in Proof. No image is labelled as love, identity, or accomplishment for you.")
                if !model.connected {
                    Button(model.connecting ? "Waiting for Photos permission…" : "Connect Apple Photos", action: model.connect)
                        .buttonStyle(.borderedProminent).disabled(model.connecting)
                    Text("macOS calls this a read/write Photos grant. This app only reads: it never edits or deletes Photos. You choose the narrower source below after connecting.")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    HStack {
                        Picker("Source", selection: $model.source) {
                            Text("Choose a source").tag("")
                            Text("Favorites").tag("favorites")
                            ForEach(model.albums) { Text($0.title).tag($0.id) }
                        }.disabled(model.sourceLocked)
                        DatePicker("Since", selection: $model.since, in: ...Date(), displayedComponents: .date).disabled(model.sourceLocked)
                    }
                    HStack {
                        Button(model.active ? "Pause" : "Start selected source") { model.active ? model.pause() : model.start() }
                            .buttonStyle(.borderedProminent).disabled(model.source.isEmpty)
                        Button("Check now", action: model.scan).disabled(!model.active || model.scanning)
                        Spacer()
                        Button("Disconnect") { confirmDisconnect = true }
                    }
                }
                Text(model.message).font(.callout).textSelection(.enabled)
                if model.scanning { ProgressView().controlSize(.small) }
                HStack {
                    Text("\(model.photos.count) photos · \(ByteCountFormatter.string(fromByteCount: Int64(model.preparedBytes), countStyle: .file))").font(.headline)
                    Spacer()
                    Button("Export for review…", action: model.exportReview).disabled(model.photos.isEmpty || model.scanning)
                    Button("Clear prepared photos") { confirmClear = true }.disabled(model.photos.isEmpty)
                }
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 185))], spacing: 16) {
                        ForEach(model.photos) { photo in
                            VStack(alignment: .leading, spacing: 6) {
                                if let bytes = Data(base64Encoded: photo.base64), let image = NSImage(data: bytes) {
                                    Image(nsImage: image).resizable().scaledToFit().frame(height: 150)
                                }
                                Text(photo.receipt.originalFilename).font(.caption).lineLimit(2)
                                Text(photo.occurredOn ?? "Date unknown").font(.caption).foregroundStyle(.secondary)
                                Text(photo.receipt.representation == "jpeg-preview" ? "JPEG preview · original stays in Photos" : "Original photo bytes")
                                    .font(.caption2).foregroundStyle(.secondary)
                                Button("Remove from this batch") { model.removePrepared(photo.id) }.font(.caption)
                            }.padding(10).background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }.frame(minHeight: 180)
                Text("Still photos only, including the still part of Live Photos. Most recent 50 in the selected date range; 10 MiB each / 47 MiB per batch. No iCloud downloads, face recognition, AI uploads, or background agent when this app is closed. Original media may contain private EXIF metadata.")
                    .font(.caption).foregroundStyle(.secondary)
                Text("Prepared photos are memory-only until exported. The export is not a saved-Proof backup. Import it into the private review inbox; category and saving remain your choice.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(24).frame(minWidth: 730, minHeight: 650)
            .confirmationDialog("Disconnect and discard prepared photos?", isPresented: $confirmDisconnect) {
                Button("Disconnect and clear", role: .destructive, action: model.disconnect)
            } message: { Text("Unexported photos will leave this app. Originals, exported files, and saved Proof are untouched. Revoke the OS grant separately in System Settings.") }
            .confirmationDialog("Clear prepared photos?", isPresented: $confirmClear) {
                Button("Clear prepared photos", role: .destructive, action: model.clearPrepared)
            } message: { Text("Export first if you want to keep this batch. Originals and exported review files are untouched.") }
    }
}
