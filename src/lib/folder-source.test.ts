import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOLDER_CHECK_INTERVAL_MS, FOLDER_ENTRY_LIMIT, FolderSourceWatch, chooseProofFolder, type FolderEntry, type ProofFolder } from "./folder-source";
import type { stageLocalProofMedia } from "./local-proof-store";

function entry(name = "synthetic.png", size = 10): FolderEntry {
  return { kind: "file", name, getFile: vi.fn().mockResolvedValue(new File([new Uint8Array(size)], name, { type: "image/png", lastModified: 1 })) };
}
function folder(entries: FolderEntry[] = [entry()]) {
  return { kind: "directory" as const, name: "Synthetic selected folder",
    queryPermission: vi.fn().mockResolvedValue("granted"), requestPermission: vi.fn().mockResolvedValue("granted"),
    values: vi.fn(async function* () { yield* entries; }),
  } satisfies ProofFolder;
}
function setup(source = folder(), stage = vi.fn<typeof stageLocalProofMedia>().mockResolvedValue({ added: 1, duplicates: 0, rejected: [] })) {
  const changed = vi.fn();
  const watch = new FolderSourceWatch(source, changed, stage);
  watches.push(watch);
  return { source, watch, stage, changed };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
const watches: FolderSourceWatch[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { watches.splice(0).forEach(watch => watch.disconnect()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("explicit, foreground folder intake", () => {
  it("only requests a read-only handle; selection never starts or persists a watch", async () => {
    const source = folder();
    const picker = vi.fn().mockResolvedValue(source);
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("showDirectoryPicker", picker);
    expect(await chooseProofFolder()).toBe(source);
    expect(picker).toHaveBeenCalledWith({ mode: "read" });
    const { watch, stage } = setup(source);
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS * 2);
    expect(watch.snapshot().status).toBe("ready");
    expect(source.queryPermission).not.toHaveBeenCalled();
    expect(source.values).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  it("denied permission never enumerates or stages media and never retries silently", async () => {
    const { source, watch, stage } = setup();
    source.queryPermission.mockResolvedValue("prompt");
    source.requestPermission.mockResolvedValue("denied");
    await watch.start();
    expect(source.requestPermission).toHaveBeenCalledWith({ mode: "read" });
    expect(watch.snapshot()).toMatchObject({ status: "error", added: 0 });
    expect(source.values).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS * 2);
    expect(source.requestPermission).toHaveBeenCalledOnce();
  });

  it("permission revocation pauses the watch instead of reopening a permission prompt", async () => {
    const { source, watch } = setup();
    await watch.start();
    source.queryPermission.mockResolvedValue("prompt");
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS);
    expect(watch.snapshot().status).toBe("error");
    expect(source.values).toHaveBeenCalledOnce();
    expect(source.requestPermission).not.toHaveBeenCalled();
  });

  it("counts directories and unsupported entries toward the bounded top-level scan", async () => {
    const inaccessible = entry("never-read.png");
    const dirs = Array.from({ length: FOLDER_ENTRY_LIMIT }, (_, i) => ({ kind: "directory" as const, name: `subfolder-${i}`, getFile: vi.fn() }));
    const { watch, stage } = setup(folder([...dirs, inaccessible]));
    await watch.start();
    expect(watch.snapshot().limited).toBe(true);
    expect(inaccessible.getFile).not.toHaveBeenCalled();
    expect(dirs.every(dir => vi.mocked(dir.getFile).mock.calls.length === 0)).toBe(true);
    expect(stage).not.toHaveBeenCalled();
  });

  it("bounds new-file count and advances without reimporting earlier candidates", async () => {
    const files = Array.from({ length: 55 }, (_, i) => entry(`synthetic-${i}.png`));
    const { watch, stage } = setup(folder(files));
    stage.mockImplementation(async files => ({ added: files.length, duplicates: 0, rejected: [] }));
    await watch.start();
    expect(stage.mock.calls[0][0]).toHaveLength(50);
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS);
    expect(stage.mock.calls[1][0]).toHaveLength(5);
    expect(watch.snapshot().added).toBe(55);
  });

  it("bounds staged bytes and remembers oversized files without reading their bytes", async () => {
    const files = Array.from({ length: 6 }, (_, i) => entry(`synthetic-${i}.png`, 10 * 1024 * 1024));
    files.push(entry("synthetic-too-big.png", 11 * 1024 * 1024));
    const { watch, stage } = setup(folder(files));
    await watch.start();
    expect(stage.mock.calls[0][0].reduce((total, file) => total + file.size, 0)).toBe(40 * 1024 * 1024);
    expect(watch.snapshot()).toMatchObject({ limited: true, rejected: 1 });
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS);
    expect(stage.mock.calls[1][0]).toHaveLength(2);
    expect(watch.snapshot().rejected).toBe(1);
  });

  it("does not resurface unchanged added, duplicate, or rejected files in this connection", async () => {
    const entries = [entry("added.png"), entry("duplicate.png"), entry("invalid.png")];
    const { watch, stage } = setup(folder(entries));
    stage.mockResolvedValue({ added: 1, duplicates: 1, rejected: [{ name: "invalid.png", reason: "Invalid PNG" }] });
    await watch.start();
    // Deleting/rejecting a candidate changes IndexedDB, not the source file.
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS * 2);
    expect(stage).toHaveBeenCalledOnce();
    expect(watch.snapshot()).toMatchObject({ added: 1, duplicates: 1, rejected: 1 });
    vi.mocked(entries[0].getFile!).mockResolvedValue(new File(["updated"], "added.png", { type: "image/png", lastModified: 2 }));
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS);
    expect(stage.mock.calls[1][0]).toHaveLength(1);
  });

  it("pauses in a hidden tab and never overrides the owner's explicit pause", async () => {
    const { source, watch } = setup();
    await watch.start();
    watch.setVisible(false);
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS * 2);
    expect(source.values).toHaveBeenCalledOnce();
    watch.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.values).toHaveBeenCalledTimes(2);
    watch.pause();
    watch.setSuspended(true);
    watch.setVisible(false);
    watch.setSuspended(false);
    watch.setVisible(true);
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS * 2);
    expect(watch.snapshot().status).toBe("paused");
    expect(source.values).toHaveBeenCalledTimes(2);
  });

  it.each(["pause", "disconnect", "hidden", "suspended"])("%s cancels an in-flight file read before staging", async action => {
    const read = deferred<File>();
    const media = entry();
    vi.mocked(media.getFile!).mockReturnValue(read.promise);
    const { watch, stage } = setup(folder([media]));
    const starting = watch.start();
    await vi.advanceTimersByTimeAsync(0);
    if (action === "hidden") watch.setVisible(false);
    else if (action === "suspended") watch.setSuspended(true);
    else if (action === "pause") watch.pause();
    else watch.disconnect();
    read.resolve(new File(["synthetic"], "synthetic.png", { type: "image/png" }));
    await starting;
    expect(stage).not.toHaveBeenCalled();
    expect(watch.snapshot().added).toBe(0);
  });

  it("passes cancellation through validation and ignores a late staging result", async () => {
    const staging = deferred<Awaited<ReturnType<typeof stageLocalProofMedia>>>();
    const { watch, stage } = setup();
    stage.mockReturnValueOnce(staging.promise);
    const starting = watch.start();
    await vi.advanceTimersByTimeAsync(0);
    const signal = stage.mock.calls[0][1];
    expect(signal?.aborted).toBe(false);
    watch.pause();
    expect(signal?.aborted).toBe(true);
    staging.resolve({ added: 1, duplicates: 0, rejected: [] });
    await starting;
    expect(watch.snapshot()).toMatchObject({ status: "paused", added: 0 });
  });

  it("waits for a cancelled nonabortable read before resuming, with no overlapping scans", async () => {
    const read = deferred<File>();
    const media = entry();
    vi.mocked(media.getFile!).mockReturnValueOnce(read.promise);
    const { source, watch, stage } = setup(folder([media]));
    const starting = watch.start();
    await vi.advanceTimersByTimeAsync(0);
    watch.setVisible(false);
    watch.setVisible(true);
    watch.setSuspended(true);
    watch.setSuspended(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.values).toHaveBeenCalledOnce();
    expect(media.getFile).toHaveBeenCalledOnce();
    read.resolve(new File(["synthetic"], "synthetic.png", { type: "image/png" }));
    await starting;
    await vi.advanceTimersByTimeAsync(0);
    expect(source.values).toHaveBeenCalledTimes(2);
    expect(stage).toHaveBeenCalledOnce();
    expect(watch.snapshot().status).toBe("watching");
  });

  it("Check now resets the timer and cannot start a paused watch", async () => {
    const { source, watch } = setup();
    await watch.checkNow();
    expect(source.values).not.toHaveBeenCalled();
    await watch.start();
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS / 2);
    await watch.checkNow();
    expect(source.values).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS / 2);
    expect(source.values).toHaveBeenCalledTimes(2);
    watch.pause();
    await watch.checkNow();
    expect(source.values).toHaveBeenCalledTimes(2);
  });

  it("a file removed during enumeration does not block remaining files", async () => {
    const vanished = entry("vanished.png");
    vi.mocked(vanished.getFile!).mockRejectedValue(new DOMException("Removed", "NotFoundError"));
    const { watch, stage } = setup(folder([vanished, entry()]));
    await watch.start();
    expect(stage.mock.calls[0][0]).toHaveLength(1);
    expect(watch.snapshot()).toMatchObject({ status: "watching", added: 1 });
  });

  it("an inbox-full failure pauses and Resume retries the uncommitted files", async () => {
    const { watch, stage } = setup();
    stage.mockRejectedValueOnce(new Error("Review inbox is full"));
    await watch.start();
    expect(watch.snapshot()).toMatchObject({ status: "error", added: 0 });
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_INTERVAL_MS * 2);
    expect(stage).toHaveBeenCalledOnce();
    await watch.start();
    expect(stage).toHaveBeenCalledTimes(2);
    expect(stage.mock.calls[1][0][0].name).toBe(stage.mock.calls[0][0][0].name);
    expect(watch.snapshot()).toMatchObject({ status: "watching", added: 1 });
  });
});
