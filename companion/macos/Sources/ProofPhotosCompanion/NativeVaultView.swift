import SwiftUI
import AppKit

struct NativeVaultView: View {
    @ObservedObject var storage: NativeVaultController
    @State private var confirmAssistant = false
    @State private var confirmClear = false
    var body: some View {
        DisclosureGroup("Private storage, connections & reminders") {
            VStack(alignment: .leading, spacing: 10) {
                Text("On this Mac · not team-visible. Active storage is not encrypted by this app; your macOS account and disk protection matter. Limits: 48 MiB of saved media and 48 MiB pending, with no silent eviction.")
                    .font(.caption).foregroundStyle(.secondary)
                if !storage.ready {
                    Button("Set up private storage", action: storage.setUpFromOwnerAction)
                    Text("Creates a private local collection. It does not connect Photos, choose a folder, enable login/background behavior or grant an assistant access.").font(.caption)
                } else {
                    Text("Granted connections and enabled reminders keep the companion in the menu bar when you close its window. Quit stops them until next launch. This never grants a source permission to collect in the background.").font(.caption)
                    if storage.port == 0 { Button("Start private connection service", action: storage.prepareConnections) }
                    else {
                        Button("Create gallery connection · 24 hours", action: storage.issueGalleryFromOwnerAction)
                        if !storage.pairingCode.isEmpty {
                            Button("Copy private gallery code") { copy(storage.pairingCode) }
                            Text("Paste into Proof Gallery → Connect native vault. This browser tab receives private media and editing permission.").font(.caption)
                        }
                        Button("Connect an assistant · saved text only…") { confirmAssistant = true }
                        if !storage.assistantConfiguration.isEmpty {
                            Button("Copy MCP configuration") { copy(storage.assistantConfiguration) }
                            Text("The configuration contains a secret. Store it only in your chosen assistant's private configuration; never in a public repo or shared message.").font(.caption)
                        }
                        Button("Hide connection codes", action: storage.hideCodes)
                    }
                    ForEach(storage.clients, id: \.id) { grant in
                        HStack {
                            Text("\(grant.kind.rawValue.capitalized) · expires \(grant.expiresAt)").font(.caption)
                            Spacer(); Button("Revoke") { storage.revokeClient(grant.id) }
                        }
                    }
                    Divider()
                    Text(storage.remindersOn ? "Reminders enabled" : "Reminders off").font(.headline.weight(.medium))
                    HStack {
                        minutePicker("At", value: $storage.scheduledMinute)
                        minutePicker("Quiet from", value: $storage.quietStart)
                        minutePicker("Until", value: $storage.quietEnd)
                    }.disabled(storage.remindersOn || storage.busy)
                    TextField("Timezone", text: $storage.timeZone).disabled(storage.remindersOn || storage.busy)
                    Text("A generic invitation at your chosen time, at least 20 hours apart, while this companion is running. No private quote or image on your lock screen. Quiet hours apply; missed times are not replayed. Turn off before changing the schedule.").font(.caption)
                    HStack {
                        Button("Enable reminders…", action: storage.enableRemindersFromOwnerAction).disabled(storage.remindersOn || storage.busy)
                        Button("Reminders off", action: storage.turnRemindersOff)
                    }
                    Divider()
                    SecureField("Backup passphrase · at least 12 characters", text: $storage.backupPassphrase)
                    HStack {
                        Button("Save encrypted native backup…", action: storage.exportBackupFromOwnerAction)
                        Button("Restore native backup…", action: storage.restoreBackupFromOwnerAction)
                    }.disabled(storage.backupBusy)
                    Text("Saved and pending evidence only; permissions never restore. Restore needs an empty unconnected native collection. Keep the passphrase separately; there is no reset. Browser backups remain separate.").font(.caption)
                    if storage.backupBusy { ProgressView("Working on encrypted backup…") }
                    Divider()
                    Button("Clear this native collection…", role: .destructive) { confirmClear = true }
                        .disabled(storage.backupBusy)
                }
                Text(storage.message).font(.callout).textSelection(.enabled)
                Text("Never use proof to invalidate pain, create guilt, demand optimism, or argue that the user should feel better. Use it only to restore evidence that depression has hidden.").font(.caption).foregroundStyle(.secondary)
            }.padding(.top, 8)
        }
        .confirmationDialog("Allow saved Proof text in your chosen assistant?", isPresented: $confirmAssistant) {
            Button("Create a 30-day read-only permission", action: storage.issueAssistantFromOwnerAction)
        } message: { Text("Only requested saved notes, dates and provenance; no pending items, photos, source access or editing. A cloud assistant may send the requested evidence to its provider. You can revoke access here.") }
        .confirmationDialog("Clear saved and pending native Proof?", isPresented: $confirmClear) {
            Button("Clear native evidence and revoke sources", role: .destructive, action: storage.clearFromOwnerConfirmation)
        } message: { Text("This deletes native evidence and revokes native source/client permissions. Originals in Photos/folders and browser collections are untouched. Restore requires a backup. This cannot be undone in the app.") }
    }
    private func minutePicker(_ title: String, value: Binding<Int>) -> some View {
        Picker(title, selection: value) {
            ForEach(Array(stride(from: 0, to: 1440, by: 15)), id: \.self) { minute in
                Text(String(format: "%02d:%02d", minute / 60, minute % 60)).tag(minute)
            }
        }
    }
    private func copy(_ value: String) {
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(value, forType: .string)
    }
}
