import { stageLocalProofMedia } from "./local-proof-store";

export const FOLDER_CHECK_INTERVAL_MS = 60_000;
export const FOLDER_ENTRY_LIMIT = 250;
export const FOLDER_FILE_LIMIT = 50;
export const FOLDER_BYTE_LIMIT = 48 * 1024 * 1024;
const SESSION_FILE_LIMIT = 2_000;
const MEDIA_EXTENSION = /\.(jpe?g|png|webp|gif|mp4|webm)$/i;

/** Only the read-only subset is exposed. Handles live in memory for this connection. */
export type FolderEntry = {
  kind: "file" | "directory";
  name: string;
  getFile?: () => Promise<File>;
};
export type ProofFolder = {
  name: string;
  kind: "directory";
  values: () => AsyncIterableIterator<FolderEntry>;
  queryPermission: (descriptor: { mode: "read" }) => Promise<PermissionState>;
  requestPermission: (descriptor: { mode: "read" }) => Promise<PermissionState>;
};
type FolderPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: "read" }) => Promise<ProofFolder>;
};

export function supportsFolderWatching(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true &&
    typeof (window as FolderPickerWindow).showDirectoryPicker === "function";
}

/** Call directly from a user gesture. Selection alone does not start any reads. */
export async function chooseProofFolder(): Promise<ProofFolder> {
  if (!supportsFolderWatching()) throw new Error("Automatic folder checks are unavailable in this browser. Use Choose photos or clips instead.");
  return (window as FolderPickerWindow).showDirectoryPicker!({ mode: "read" });
}

export type FolderSourceState = {
  status: "ready" | "checking" | "watching" | "paused" | "suspended" | "hidden" | "error" | "disconnected";
  folderName: string;
  added: number;
  duplicates: number;
  rejected: number;
  lastChecked: number | null;
  limited: boolean;
  message: string;
};
type StageMedia = typeof stageLocalProofMedia;

/**
 * A foreground-only watch, never an approval path. Explicit pause remains a pause
 * across editor/visibility changes. Each asynchronous step uses one cancellation
 * signal, including the eventual IndexedDB commit.
 */
export class FolderSourceWatch {
  private folder: ProofFolder | null;
  private wanted = false;
  private suspended = false;
  private visible = true;
  private request: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private queued = false;
  private queuedPermission = false;
  private readonly seen = new Set<string>();
  private state: FolderSourceState;

  constructor(folder: ProofFolder, private readonly onChange: (state: FolderSourceState) => void,
    private readonly stage: StageMedia = stageLocalProofMedia) {
    this.folder = folder;
    this.state = { status: "ready", folderName: folder.name, added: 0, duplicates: 0,
      rejected: 0, lastChecked: null, limited: false, message: "Folder selected. Start when you’re ready." };
  }

  snapshot(): FolderSourceState { return { ...this.state }; }

  /** Only an owner-triggered start/resume is allowed to request permission. */
  async start(): Promise<void> {
    if (!this.folder || this.wanted) return;
    this.wanted = true;
    await this.check(true);
  }

  pause(): void {
    this.wanted = false;
    this.cancel();
    this.update({ status: "paused", message: "Paused by you. Resume to check this folder again." });
  }

  /** A manual check shares the same permission, scope, and cancellation guards. */
  async checkNow(): Promise<void> {
    if (this.state.status !== "watching") return;
    this.cancel();
    await this.check(false);
  }

  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    this.reconcile();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.reconcile();
  }

  disconnect(): void {
    this.wanted = false;
    this.cancel();
    this.folder = null;
    this.seen.clear();
    this.update({ status: "disconnected", folderName: "", message: "Folder disconnected. Items already in review remain there." });
  }

  private update(patch: Partial<FolderSourceState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.snapshot());
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queued = false;
    this.queuedPermission = false;
    this.request?.abort();
  }

  private reconcile(): void {
    if (!this.wanted) return;
    this.cancel();
    if (this.suspended || !this.visible) this.update(this.blockedState());
    void this.check(false);
  }

  private blockedState(): Pick<FolderSourceState, "status" | "message"> {
    return this.suspended
      ? { status: "suspended", message: "Waiting while you review or edit. Checks resume when you finish." }
      : { status: "hidden", message: "Waiting while this tab is hidden. Checks resume when you return." };
  }

  private check(canRequestPermission: boolean): Promise<void> {
    // getFile() itself is not abortable. Wait for it to settle before a resumed
    // pass starts, even though its cancelled result can no longer be staged.
    if (this.running) {
      this.queued = true;
      this.queuedPermission ||= canRequestPermission;
      return this.running;
    }
    this.running = this.performCheck(canRequestPermission).finally(() => {
      this.running = null;
      if (this.queued && this.wanted) {
        const permission = this.queuedPermission;
        this.queued = false;
        this.queuedPermission = false;
        void this.check(permission);
      }
    });
    return this.running;
  }

  private async performCheck(canRequestPermission: boolean): Promise<void> {
    if (!this.folder || !this.wanted) return;
    if (this.suspended || !this.visible) {
      this.update(this.blockedState());
      return;
    }
    const folder = this.folder;
    const controller = new AbortController();
    const signal = controller.signal;
    this.request = controller;
    this.update({ status: "checking", message: "Checking the selected folder…" });
    try {
      let permission = await folder.queryPermission({ mode: "read" });
      signal.throwIfAborted();
      if (permission !== "granted" && canRequestPermission) {
        permission = await folder.requestPermission({ mode: "read" });
        signal.throwIfAborted();
      }
      if (permission !== "granted") throw new Error("Read permission was not granted. Resume to allow this folder, or disconnect and choose another.");
      const files: File[] = [];
      const fingerprints: string[] = [];
      let entries = 0;
      let bytes = 0;
      let oversized = 0;
      let limited = false;
      // This cap includes directories and unsupported files. Never recurse.
      for await (const entry of folder.values()) {
        signal.throwIfAborted();
        entries++;
        if (entry.kind === "file" && MEDIA_EXTENSION.test(entry.name) && entry.getFile) {
          let file: File | null = null;
          try { file = await entry.getFile(); }
          catch (error) {
            signal.throwIfAborted();
            // A file may disappear between enumeration and reading. Other
            // access errors still stop the pass instead of hiding permission loss.
            if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
          }
          signal.throwIfAborted();
          if (file) {
            const fingerprint = JSON.stringify([entry.name, file.size, file.lastModified, file.type]);
            if (!this.seen.has(fingerprint)) {
              if (this.seen.size + fingerprints.length >= SESSION_FILE_LIMIT) {
                throw new Error("This connection has checked 2,000 file versions. Disconnect, review your inbox, and select a fresh folder to continue.");
              }
              if (file.size === 0 || file.size > 10 * 1024 * 1024) {
                fingerprints.push(fingerprint);
                oversized++;
              } else if (files.length >= FOLDER_FILE_LIMIT || bytes + file.size > FOLDER_BYTE_LIMIT) {
                limited = true;
              } else {
                files.push(file);
                fingerprints.push(fingerprint);
                bytes += file.size;
              }
            }
          }
        }
        if (entries >= FOLDER_ENTRY_LIMIT) { limited = true; break; }
      }
      signal.throwIfAborted();
      const result = files.length ? await this.stage(files, signal) : { added: 0, duplicates: 0, rejected: [] };
      signal.throwIfAborted();
      // Includes invalid media and existing duplicates, so rejecting/deleting an
      // unchanged item cannot bring it back on the next interval in this session.
      fingerprints.forEach(fingerprint => this.seen.add(fingerprint));
      this.update({ status: "watching", added: this.state.added + result.added,
        duplicates: this.state.duplicates + result.duplicates,
        rejected: this.state.rejected + result.rejected.length + oversized,
        lastChecked: Date.now(), limited,
        message: result.added ? `${result.added} new ${result.added === 1 ? "item is" : "items are"} ready for your review.` : "Up to date. Checking again in about a minute." });
      this.timer = setTimeout(() => { this.timer = null; void this.check(false); }, FOLDER_CHECK_INTERVAL_MS);
    } catch (error) {
      if (signal.aborted) return;
      this.wanted = false;
      this.update({ status: "error", message: error instanceof Error ? error.message : "The folder could not be read. Resume to try again." });
    } finally {
      if (this.request === controller) this.request = null;
    }
  }
}
