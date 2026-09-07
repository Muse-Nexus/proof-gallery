import AppKit
import CompanionCore
import CompanionVault

/// Native owner-only composition. Initializing this object does not create
/// storage, listen, prompt, scan, register a service or send a notification.
@MainActor final class NativeVaultController: ObservableObject {
    @Published var reconnectConfirmation = false
    @Published private(set) var ready = false
    @Published private(set) var message = "Set up private storage to keep evidence after closing the app."
    @Published private(set) var clients: [VaultClientGrant] = []
    @Published private(set) var pairingCode = ""
    @Published private(set) var assistantConfiguration = ""
    @Published private(set) var port: UInt16 = 0
    @Published private(set) var busy = false
    @Published private(set) var remindersOn = false
    @Published var backupPassphrase = ""
    @Published private(set) var backupBusy = false
    @Published var scheduledMinute = 18 * 60
    @Published var quietStart = 22 * 60
    @Published var quietEnd = 8 * 60
    @Published var timeZone = TimeZone.current.identifier
    private(set) var vault: ProofVault?
    private var reconnectRequested = false
    private var bridge: VaultBridge?
    private var reminders: NativeReminderAdapter?
    private let preferences: UserDefaults
    private let explicitDirectory: URL?
    private let onReady: (ProofVault) -> Bool
    private let beforeClear: () -> Void
    private let notificationClient: any NativeNotificationClient
    private var generation = UUID()
    private var reminderGeneration = UUID()
    init(preferences: UserDefaults = .standard, directory: URL? = nil, notificationClient: (any NativeNotificationClient)? = nil,
         onReady: @escaping (ProofVault) -> Bool, beforeClear: @escaping () -> Void) {
        self.preferences = preferences; explicitDirectory = directory
        self.onReady = onReady; self.beforeClear = beforeClear
        self.notificationClient = notificationClient ?? SystemNativeNotificationClient()
    }
    private func directory(createParent: Bool) throws -> URL {
        if let explicitDirectory { return explicitDirectory }
        return try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: createParent).appendingPathComponent("ProofGalleryVault", isDirectory: true)
    }
    func restoreIfConfigured() {
        guard vault == nil, let id = preferences.string(forKey: "proof.native.collection.v1") else { return }
        do {
            let directory = try directory(createParent: false)
            guard FileManager.default.fileExists(atPath: directory.appendingPathComponent("vault.sqlite").path) else { throw VaultError.unavailable }
            try attach(ProofVault(directory: directory, collectionID: id))
        } catch { message = "Private storage could not open safely. Nothing was recreated or collected. Check the storage location or another running companion." }
    }
    func setUpFromOwnerAction() {
        guard vault == nil else { return }
        do {
            let id = UUID().uuidString, directory = try directory(createParent: true)
            let authority = try ProofVault(directory: directory, collectionID: id)
            preferences.set(id, forKey: "proof.native.collection.v1")
            try attach(authority)
        } catch { message = "Could not create private storage safely. No sources or connections were granted." }
    }
    func requestReconnectFromOwnerAction() {
        guard vault == nil else { return }
        reconnectRequested = true
        reconnectConfirmation = true
    }
    func cancelReconnect() {
        reconnectRequested = false; reconnectConfirmation = false
    }
    func reconnectFromOwnerConfirmation() {
        guard vault == nil, reconnectRequested else { return }
        cancelReconnect()
        do {
            let authority = try ProofVault.reconnectExisting(directory: directory(createParent: false))
            try attach(authority)
            preferences.set(authority.collectionID, forKey: "proof.native.collection.v1")
        } catch { message = "Existing private storage could not reconnect safely. Nothing was created, replaced or connected." }
    }
    private func attach(_ authority: ProofVault) throws {
        let consent = try authority.reminderConsent()
        guard onReady(authority) else { throw VaultError.unavailable }
        vault = authority; ready = true
        reminders = NativeReminderAdapter(vault: authority, client: notificationClient)
        if let consent {
            scheduledMinute = consent.scheduledMinute; timeZone = consent.timeZone
            quietStart = consent.quietHours?.startMinute ?? 22 * 60; quietEnd = consent.quietHours?.endMinute ?? 8 * 60
            remindersOn = consent.enabled && !consent.paused
            if remindersOn { reminders?.startPolling() }
        }
        refreshClients()
        message = "Private storage is ready. Sources, background collection, assistant access and reminders each need their own choice."
        if clients.contains(where: { !$0.revoked && ($0.expiresAt > isoTimestamp(Date())) }) { startBridge() }
    }
    private func refreshClients() {
        do { clients = try vault?.clientGrants() ?? [] }
        catch { clients = []; message = "Could not read connection status safely." }
    }
    var keepsServicesRunningAfterWindowClose: Bool {
        remindersOn || (port >= 1024 && clients.contains { !$0.revoked && $0.expiresAt > isoTimestamp(Date()) })
    }
    private func startBridge() {
        guard let vault, bridge == nil else { return }
        let bridge = VaultBridge(vault: vault); self.bridge = bridge
        let preferred = preferences.integer(forKey: "proof.native.port.v1")
        let current = generation
        bridge.start(preferredPort: UInt16(exactly: preferred) ?? 0) { [weak self] port in
            Task { @MainActor in
                guard let self, self.generation == current else { return }
                self.port = port ?? 0
                if let port { self.preferences.set(Int(port), forKey: "proof.native.port.v1") }
                else { self.bridge = nil; self.message = "The private connection could not start. Check for another running companion; no alternate network address was used." }
            }
        }
    }
    func prepareConnections() { startBridge() }
    func issueGalleryFromOwnerAction() {
        guard let vault, port >= 1024 else { return }
        do {
            let issued = try vault.issueClient(kind: .gallery, scopes: [.savedText, .savedMedia, .galleryReview], expiresAt: Date().addingTimeInterval(24 * 3600))
            pairingCode = "\(port).\(issued.token).\(vault.collectionID)"
            message = "Gallery permission lasts 24 hours. Paste the code only into the gallery on this Mac. It allows viewing, reviewing, adding, editing and deleting in this collection."
            refreshClients()
        } catch { message = "Could not grant this gallery connection." }
    }
    func issueAssistantFromOwnerAction() {
        guard let vault, port >= 1024 else { return }
        let helper = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/ProofMCP").path
        guard FileManager.default.isExecutableFile(atPath: helper) else {
            message = "The MCP helper is not packaged in this build. Build the complete app before creating assistant permission."; return
        }
        do {
            let issued = try vault.issueClient(kind: .assistant, scopes: [.savedText], expiresAt: Date().addingTimeInterval(30 * 24 * 3600 - 1))
            let config: [String: Any] = ["mcpServers": ["proof-gallery": ["command": helper,
                "env": ["PROOF_MCP_PORT": String(port), "PROOF_MCP_TOKEN": issued.token]]]]
            assistantConfiguration = String(decoding: try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self)
            message = "This 30-day permission reads saved text only. Connecting a cloud assistant can send requested evidence to its provider. No automatic configuration was changed."
            refreshClients()
        } catch { message = "Could not grant assistant access." }
    }
    func hideCodes() { pairingCode = ""; assistantConfiguration = "" }
    func revokeClient(_ id: String) {
        do { try vault?.revokeClient(id: id); hideCodes(); refreshClients(); message = "Connection revoked. Already received bytes cannot be retracted." }
        catch {
            generation = UUID(); bridge?.stop(); bridge = nil; port = 0; hideCodes()
            message = "All live connections stopped, but saved revocation failed. Retry Revoke before restarting; the old permission may otherwise resume."
        }
    }
    func enableRemindersFromOwnerAction() {
        guard let vault, let reminders, !busy else { return }
        busy = true; let current = reminderGeneration
        Task {
            let permission = await reminders.requestPermissionFromOwnerAction()
            guard reminderGeneration == current else { busy = false; return }
            defer { busy = false }
            guard permission == .granted else { message = "Notifications were not enabled. No reminder has been scheduled."; return }
            do {
                let previous = try vault.reminderConsent()
                _ = try vault.setReminderConsent(ReminderConsent(ownerID: vault.ownerID, collectionID: vault.collectionID,
                    revision: previous?.revision ?? 1, enabled: true, paused: false, timeZone: timeZone,
                    scheduledMinute: scheduledMinute, quietHours: ReminderQuietHours(startMinute: quietStart, endMinute: quietEnd), cooldownMinutes: 20 * 60),
                    expectedRevision: previous?.revision)
                remindersOn = true; reminders.startPolling()
                message = "Generic reminders enabled at your chosen time. No evidence appears on the lock screen; missed times are skipped."
            } catch { message = "Reminder settings were not saved. Check the timezone and times." }
        }
    }
    func turnRemindersOff() {
        reminderGeneration = UUID(); busy = false; reminders?.stop()
        do {
            if let vault, var consent = try vault.reminderConsent() {
                let revision = consent.revision; consent.enabled = false; consent.paused = true
                _ = try vault.setReminderConsent(consent, expectedRevision: revision)
            }
            remindersOn = false; message = "Reminders off. Collection and assistant permissions are unchanged."
        } catch { message = "Reminders stopped for this run, but the saved Off setting could not be confirmed. Retry before restarting." }
    }
    func clearFromOwnerConfirmation() {
        beforeClear(); reminders?.stop(); bridge?.stop(); bridge = nil; port = 0
        generation = UUID(); reminderGeneration = UUID(); hideCodes()
        do {
            try vault?.clear(); clients = []; remindersOn = false
            message = "Native saved and pending evidence cleared; sources and connections revoked. Original files and browser collections are untouched. Content is recoverable only from your backup."
        } catch { message = "Reading stopped, but clearing could not be confirmed. No successful deletion is claimed." }
    }
    func exportBackupFromOwnerAction() {
        guard let vault, !backupBusy, backupPassphrase.count >= 12 else {
            message = "Use a backup passphrase of at least 12 characters. Keep it somewhere safe; it cannot be recovered."; return
        }
        let panel = NSSavePanel(); panel.nameFieldStringValue = "proof-native-backup.proofenc"
        panel.message = "Encrypted native saved and pending evidence. Source and assistant permissions are not included."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let passphrase = backupPassphrase; backupPassphrase = ""; backupBusy = true
        Task {
            defer { backupBusy = false }
            do {
                try await Task.detached {
                    let archive = try vault.exportEncryptedBackup(passphrase: passphrase)
                    try archive.write(to: url, options: .atomic)
                    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
                }.value
                message = "Encrypted native backup saved. It includes literal saved/pending evidence, not active permissions. Keep the passphrase separately."
            } catch { message = "Backup could not be confirmed. Keep the native collection; do not clear it based on this attempt." }
        }
    }
    func restoreBackupFromOwnerAction() {
        guard let vault, !backupBusy, backupPassphrase.count >= 12 else {
            message = "Enter the native backup passphrase first."; return
        }
        let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.message = "Restore into an empty native collection with no source, assistant or reminder permissions. Browser backups are a separate format."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let passphrase = backupPassphrase; backupPassphrase = ""; backupBusy = true
        Task {
            defer { backupBusy = false }
            do {
                let result = try await Task.detached {
                    let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }
                    let maximum = VaultBackupLimits.maximumArchiveBytes
                    var bytes = Data()
                    while let chunk = try file.read(upToCount: min(64 * 1024, maximum + 1 - bytes.count)), !chunk.isEmpty {
                        bytes.append(chunk)
                        guard bytes.count <= maximum else { throw VaultError.capacity }
                    }
                    return try vault.restoreEncryptedBackup(bytes, passphrase: passphrase)
                }.value
                message = "Restored \(result.saved) saved and \(result.pending) pending items. No source, assistant or reminder permission was restored."
            } catch { message = "Restore failed safely. Check the passphrase, native backup format, and that this collection is empty with no active or paused grants. Nothing was partially imported." }
        }
    }
    func stopForTermination() { generation = UUID(); reminderGeneration = UUID(); reminders?.stop(); bridge?.stop(); bridge = nil; hideCodes() }
}
