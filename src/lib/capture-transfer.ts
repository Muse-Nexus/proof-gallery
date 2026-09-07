/** Reads only a transfer the owner explicitly pasted/dropped into capture. No clipboard or URL access. */
export function readCaptureTransfer(transfer: Pick<DataTransfer, "files" | "items" | "getData">): {
  file: File | null; text: string;
} {
  const files = Array.from(transfer.files ?? []);
  if (!files.length) {
    for (const item of Array.from(transfer.items ?? [])) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }
  if (files.length > 1) throw new Error("Add one attachment here. Use Photos & media for a batch.");
  // HTML and URI-list are deliberately ignored. A pasted URL is literal note text, never fetched.
  const text = transfer.getData("text/plain");
  if (!files.length && !text) throw new Error("Paste or drop an image or plain text here. Links are not downloaded.");
  return { file: files[0] ?? null, text };
}

/** Appends without rewriting, trimming, or silently truncating either piece of evidence. */
export function appendCapturedText(current: string, incoming: string): string {
  if (!incoming) return current;
  const combined = current ? `${current}\n\n${incoming}` : incoming;
  if (combined.length > 20_000) throw new Error("That text would exceed 20,000 characters. Your current note is unchanged.");
  return combined;
}
