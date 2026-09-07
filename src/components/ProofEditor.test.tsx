import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProofItem } from "../lib/proof";
import { ProofEditor } from "./ProofEditor";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);

function proofItem(overrides: Partial<ProofItem> = {}): ProofItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    title: "Synthetic evidence",
    evidenceText: "A synthetic source confirmed the example shipped.",
    occurredOn: "2026-01-02",
    category: "shipped",
    sourceType: "work",
    source: "Synthetic test fixture",
    tags: ["synthetic"],
    person: null,
    project: "Proof Gallery test",
    imagePath: "22222222-2222-4222-8222-222222222222/example.png",
    imageUrl: "https://example.supabase.co/storage/v1/object/sign/proof-images/example.png",
    provenance: { kind: "manual", source_type: "work" },
    visibility: "personal",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    relevance: null,
    ...overrides,
  };
}

function validPng(name = "synthetic.png"): File {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    name,
    { type: "image/png" },
  );
}

function deferredPng(name = "synthetic-slow.png") {
  let resolve!: (bytes: ArrayBuffer) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ArrayBuffer>((done, fail) => { resolve = done; reject = fail; });
  const file = validPng(name);
  vi.spyOn(file, "slice").mockReturnValueOnce({ arrayBuffer: () => promise } as Blob);
  return { file, reject, finish: () => resolve(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer) };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: "Synthetic title" } });
  fireEvent.change(screen.getByLabelText(/Exact quote or evidence/i), { target: { value: "Synthetic evidence text" } });
  fireEvent.change(screen.getByLabelText(/^Category$/), { target: { value: "belonging" } });
}

function renderEditor({
  item = null,
  onSave = async () => undefined,
}: {
  item?: ProofItem | null;
  onSave?: React.ComponentProps<typeof ProofEditor>["onSave"];
} = {}) {
  render(
    <ProofEditor
      item={item}
      busy={false}
      onClose={() => undefined}
      onSave={onSave}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
});

describe("Proof image selection", () => {
  it("blocks save until the current attachment finishes validation", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const selected = deferredPng();
    renderEditor({ onSave });
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Image or screenshot/i), { target: { files: [selected.file] } });
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Checking attachment…" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("button", { name: "Checking attachment…" }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => selected.finish());
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].image).toBe(selected.file);
  });

  it("keeps the newest validated file when an earlier choice finishes last", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const earlier = deferredPng();
    const latest = validPng("synthetic-latest.png");
    renderEditor({ onSave });
    fillRequiredFields();
    const picker = screen.getByLabelText(/Image or screenshot/i);
    fireEvent.change(picker, { target: { files: [earlier.file] } });
    fireEvent.change(picker, { target: { files: [latest] } });
    await screen.findByText(latest.name);
    await act(async () => earlier.finish());
    expect(screen.queryByText(earlier.file.name)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].image).toBe(latest);
  });

  it("does not clear a newer file or its picker when an obsolete check rejects", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const earlier = deferredPng();
    const latest = validPng("synthetic-latest.png");
    renderEditor({ onSave });
    fillRequiredFields();
    const picker = screen.getByLabelText(/Image or screenshot/i);
    fireEvent.change(picker, { target: { files: [earlier.file] } });
    fireEvent.change(picker, { target: { files: [latest] } });
    await screen.findByText(latest.name);
    const reset = vi.fn();
    Object.defineProperty(picker, "value", { configurable: true, get: () => "synthetic-latest.png", set: reset });
    await act(async () => earlier.reject(new Error("Obsolete validation error")));
    expect(reset).not.toHaveBeenCalled();
    expect(screen.queryByText("Obsolete validation error")).not.toBeInTheDocument();
    expect(screen.getByText(latest.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].image).toBe(latest);
  });

  it.each(["close", "unmount"])("ignores attachment validation after %s", async route => {
    const selected = deferredPng();
    const onClose = vi.fn();
    const onSave = vi.fn();
    const { unmount } = render(<ProofEditor item={null} busy={false} onClose={onClose} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/Image or screenshot/i), { target: { files: [selected.file] } });
    if (route === "close") {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
    } else unmount();
    await act(async () => selected.finish());
    expect(screen.queryByText(/validated and ready to save/)).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("locks editable fields and rejects duplicate submission while saving", async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    renderEditor({ onSave });
    fillRequiredFields();
    const form = screen.getByRole("button", { name: "Save Proof" }).closest("form")!;
    fireEvent.submit(form);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByLabelText(/^Title$/)).toBeDisabled();
    expect(screen.getByLabelText(/Image or screenshot/i)).toBeDisabled();
    expect(screen.getByLabelText(/Exact quote or evidence/i)).toBeDisabled();
    fireEvent.submit(form);
    expect(onSave).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(screen.getByLabelText(/^Title$/)).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save Proof" })).toBeEnabled();
  });

  it.each(["Escape", "backdrop", "close button", "Cancel"])(
    "prevents dismissal through %s while saving and restores it afterward",
    (route) => {
      const onClose = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { rerender } = render(
        <ProofEditor item={null} busy onClose={onClose} onSave={onSave} />,
      );
      const dismiss = () => {
        const dialog = screen.getByRole("dialog");
        if (route === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
        else if (route === "backdrop") fireEvent.mouseDown(dialog.parentElement!);
        else fireEvent.click(screen.getByRole("button", {
          name: route === "Cancel" ? "Cancel" : "Close editor",
        }));
      };
      expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
      dismiss();
      expect(onClose).not.toHaveBeenCalled();

      rerender(<ProofEditor item={null} busy={false} onClose={onClose} onSave={onSave} />);
      expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "false");
      dismiss();
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it("keeps keyboard focus inside the dialog and restores it on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Synthetic trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { unmount } = render(
      <ProofEditor
        item={null}
        busy={false}
        onClose={onClose}
        onSave={async () => undefined}
      />,
    );

    expect(screen.getByLabelText(/Exact quote or evidence/i)).toHaveFocus();

    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close editor" });
    const save = screen.getByRole("button", { name: "Save Proof" });
    save.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("can show the local storage boundary without an owner-only claim", () => {
    render(
      <ProofEditor
        item={null}
        busy={false}
        privacyLabel="Local · not synced · not encrypted"
        onClose={() => undefined}
        onSave={async () => undefined}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Local · not synced · not encrypted",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "Private · only you",
    );
  });

  it("saves a date received through the native input event", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });
    fireEvent.change(screen.getByLabelText(/^Title$/), {
      target: { value: "Synthetic dated Proof" },
    });
    fireEvent.change(screen.getByLabelText(/Exact quote or evidence/i), {
      target: { value: "Synthetic evidence text" },
    });
    fireEvent.change(screen.getByLabelText(/^Category$/), { target: { value: "belonging" } });
    fireEvent.input(screen.getByLabelText("Occurred date"), {
      target: { value: "2026-08-29" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0].input.occurredOn).toBe("2026-08-29");
  });

  it("validates a raster image without assigning a local file URL to the DOM", async () => {
    const createObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    const png = validPng();

    renderEditor();
    fireEvent.change(screen.getByLabelText(/Image or screenshot/i), {
      target: { files: [png] },
    });

    expect(
      await screen.findByText(/Image validated and ready to save:/),
    ).toBeInTheDocument();
    expect(screen.getByText("synthetic.png")).toBeInTheDocument();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("passes the exact validated file through the save boundary", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const png = validPng();
    renderEditor({ onSave });

    fireEvent.change(screen.getByLabelText(/Image or screenshot/i), {
      target: { files: [png] },
    });
    await screen.findByText(/Image validated and ready to save:/);
    fireEvent.change(screen.getByLabelText(/^Title$/), {
      target: { value: "Synthetic title" },
    });
    fireEvent.change(screen.getByLabelText(/Exact quote or evidence/i), {
      target: { value: "Synthetic evidence text" },
    });
    fireEvent.change(screen.getByLabelText(/^Category$/), { target: { value: "belonging" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0].image).toBe(png);
  });

  it("shows a saved private image but hides it when a replacement is selected", async () => {
    renderEditor({ item: proofItem() });

    expect(screen.getByRole("img", { name: "Current evidence image for Synthetic evidence" }))
      .toHaveAttribute("src", proofItem().imageUrl);
    expect(
      screen.getByRole("checkbox", { name: "Remove this evidence image" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Image or screenshot/i), {
      target: { files: [validPng()] },
    });
    await screen.findByText(/Image validated and ready to save:/);

    expect(
      screen.queryByRole("img", { name: "Current evidence image for Synthetic evidence" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a saved attachment truthful and removable when its preview is unavailable", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ item: proofItem({ imageUrl: null }), onSave });

    expect(
      screen.getByText("Evidence attachment saved · preview unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Remove this evidence image" }),
    );
    expect(
      screen.getByText("Evidence attachment marked for removal"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0].removeExistingImage).toBe(true);
  });

  it("rejects a non-image before accepting it for upload", async () => {
    const textFile = new File(["not an image"], "synthetic.txt", {
      type: "text/plain",
    });

    renderEditor();
    fireEvent.change(screen.getByLabelText(/Image or screenshot/i), {
      target: { files: [textFile] },
    });

    expect(
      await screen.findByText(
        "Proof attachments must be JPEG, PNG, WebP, or GIF images",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Image validated and ready to save:/),
    ).not.toBeInTheDocument();
  });
});

function captured(text = "", files: File[] = []) {
  return { files, items: [], getData: (type: string) => type === "text/plain" ? text : "", dropEffect: "none" };
}

describe("note-first capture", () => {
  it("starts on the note and keeps optional metadata collapsed for a new item", () => {
    renderEditor();
    expect(screen.getByLabelText(/Exact quote or evidence/i)).toHaveFocus();
    expect(screen.getByText("Date, source & other details").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText(/^Category$/)).toHaveValue("");
    expect(screen.getByLabelText(/^Source type$/)).toHaveValue("other");
  });

  it("keeps opened metadata visible across field changes, and supports closing it", () => {
    renderEditor();
    const summary = screen.getByText("Date, source & other details");
    const details = summary.closest("details")!;
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    fireEvent.input(screen.getByLabelText("Occurred date"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText(/^Category$/), { target: { value: "creativity" } });
    fireEvent.change(screen.getByLabelText(/^Source type$/), { target: { value: "message" } });
    expect(details).toHaveAttribute("open");
    expect(screen.getByLabelText(/^Source type$/)).toHaveValue("message");
    fireEvent.click(summary);
    expect(details).not.toHaveAttribute("open");
  });

  it("suggests visible organization from a note without changing its literal words or unknown source", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });
    const quote = "  Hiking with my sister.\nCried.  ";
    fireEvent.change(screen.getByLabelText(/Exact quote or evidence/i), { target: { value: quote } });
    expect(screen.getByLabelText(/^Title$/)).toHaveValue("Hiking with my sister. Cried.");
    expect(screen.getByLabelText(/^Category$/)).toHaveValue("belonging");
    expect(screen.getByText(/Category cue: “sister”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].input).toMatchObject({ evidenceText: quote, occurredOn: null, source: null, sourceType: "other", person: null, project: null });
  });

  it("never overwrites manually edited fields or re-adds removed tags as a note changes", () => {
    renderEditor();
    const note = screen.getByLabelText(/Exact quote or evidence/i);
    fireEvent.change(note, { target: { value: "Hiking with my sister." } });
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: "My own title" } });
    fireEvent.change(screen.getByLabelText(/^Category$/), { target: { value: "recovery" } });
    fireEvent.change(screen.getByLabelText(/^Tags$/), { target: { value: "" } });
    fireEvent.change(note, { target: { value: "My sister invited me to the family dinner." } });
    expect(screen.getByLabelText(/^Title$/)).toHaveValue("My own title");
    expect(screen.getByLabelText(/^Category$/)).toHaveValue("recovery");
    expect(screen.getByLabelText(/^Tags$/)).toHaveValue("");
    fireEvent.click(screen.getByRole("checkbox", { name: "Use word-based organization suggestions" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Use word-based organization suggestions" }));
    expect(screen.getByLabelText(/^Tags$/)).toHaveValue("");
  });

  it("does not supply a category for conflicting or negated word cues", () => {
    renderEditor();
    const note = screen.getByLabelText(/Exact quote or evidence/i);
    fireEvent.change(note, { target: { value: "I never finished that drawing." } });
    expect(screen.getByLabelText(/^Category$/)).toHaveValue("");
    fireEvent.change(note, { target: { value: "I finished a drawing with my sister." } });
    expect(screen.getByLabelText(/^Category$/)).toHaveValue("");
  });

  it("does not save automatic tags stripped of their negation", async () => {
    const quote = "I never finished that drawing.";
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });
    fireEvent.change(screen.getByLabelText(/Exact quote or evidence/i), { target: { value: quote } });
    expect(screen.getByLabelText(/^Tags$/)).toHaveValue("");
    expect(screen.queryByText(/^Suggested tags:/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Category$/), { target: { value: "creativity" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].input).toMatchObject({ evidenceText: quote, tags: [] });
  });

  it("preserves explicit manual tags and the full quote when a note becomes negated", async () => {
    const quote = "I didn’t finish that drawing.\nThose are my exact words.";
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });
    const note = screen.getByLabelText(/Exact quote or evidence/i);
    fireEvent.change(note, { target: { value: "Finished the drawing." } });
    fireEvent.change(screen.getByLabelText(/^Tags$/), { target: { value: "drawing, finished, my-choice" } });
    fireEvent.change(note, { target: { value: quote } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Use word-based organization suggestions" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Use word-based organization suggestions" }));
    expect(screen.getByLabelText(/^Tags$/)).toHaveValue("drawing, finished, my-choice");
    fireEvent.change(screen.getByLabelText(/^Category$/), { target: { value: "creativity" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].input).toMatchObject({
      evidenceText: quote, tags: ["drawing", "finished", "my-choice"],
    });
  });

  it("opens all existing edit metadata and preserves it even when suggestions are enabled", async () => {
    const item = proofItem();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ item, onSave });
    expect(screen.getByText("Date, source & other details").closest("details")).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("checkbox", { name: "Use word-based organization suggestions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].input).toEqual({ title: item.title, evidenceText: item.evidenceText, category: item.category, tags: item.tags, occurredOn: item.occurredOn, source: item.source, sourceType: item.sourceType, person: item.person, project: item.project });
  });

  it("appends pasted plain text only in the capture area and never fetches pasted URLs", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });
    fillRequiredFields();
    const note = screen.getByLabelText(/Exact quote or evidence/i);
    fireEvent.paste(note, { clipboardData: captured("Not intercepted") });
    expect(note).toHaveValue("Synthetic evidence text"); // Native text-field paste is left to the browser.
    fireEvent.paste(screen.getByRole("group", { name: "Paste or drop evidence" }), { clipboardData: captured("  Exact quote\nhttps://example.test/private.png  ") });
    expect(note).toHaveValue("Synthetic evidence text\n\n  Exact quote\nhttps://example.test/private.png  ");
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(fetch).not.toHaveBeenCalled();
    expect(onSave.mock.calls[0][0].input).toMatchObject({ source: null, sourceType: "other", occurredOn: null });
  });

  it("validates pasted images and blocks save until they are checked", async () => {
    const selected = deferredPng();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });
    fillRequiredFields();
    fireEvent.paste(screen.getByRole("group", { name: "Paste or drop evidence" }), { clipboardData: captured("", [selected.file]) });
    expect(screen.getByRole("button", { name: "Checking attachment…" })).toBeDisabled();
    await act(async () => selected.finish());
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].image).toBe(selected.file);
  });

  it.each(["close", "unmount"])("ignores a pasted attachment after %s", async route => {
    const selected = deferredPng();
    const onClose = vi.fn();
    const { unmount } = render(<ProofEditor item={null} busy={false} onClose={onClose} onSave={async () => undefined} />);
    fireEvent.paste(screen.getByRole("group", { name: "Paste or drop evidence" }), { clipboardData: captured("", [selected.file]) });
    if (route === "close") {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledOnce();
    } else unmount();
    await act(async () => selected.finish());
    expect(screen.queryByText(/validated and ready to save/)).not.toBeInTheDocument();
  });

  it("rejects excess capture text without truncating the note or replacing the selected attachment", async () => {
    const file = validPng("kept.png");
    renderEditor();
    fillRequiredFields();
    const capture = screen.getByRole("group", { name: "Paste or drop evidence" });
    fireEvent.drop(capture, { dataTransfer: captured("", [file]) });
    await screen.findByText(file.name);
    fireEvent.paste(capture, { clipboardData: captured("x".repeat(20_000), [validPng("not-selected.png")]) });
    expect(screen.getByRole("alert")).toHaveTextContent("Your current note is unchanged");
    expect(screen.getByLabelText(/Exact quote or evidence/i)).toHaveValue("Synthetic evidence text");
    expect(screen.getByText(file.name)).toBeInTheDocument();
    expect(screen.queryByText("not-selected.png")).not.toBeInTheDocument();
  });

  it("keeps the latest file when a dropped image beats a previous slow paste", async () => {
    const earlier = deferredPng();
    const latest = validPng("dropped.png");
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });
    fillRequiredFields();
    const capture = screen.getByRole("group", { name: "Paste or drop evidence" });
    fireEvent.paste(capture, { clipboardData: captured("", [earlier.file]) });
    fireEvent.drop(capture, { dataTransfer: captured("", [latest]) });
    await screen.findByText(latest.name);
    await act(async () => earlier.finish());
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].image).toBe(latest);
  });

  it("rejects unsafe media and multiple files without silently accepting a selection", async () => {
    renderEditor();
    const capture = screen.getByRole("group", { name: "Paste or drop evidence" });
    fireEvent.drop(capture, { dataTransfer: captured("", [validPng("a.png"), validPng("b.png")]) });
    expect(screen.getByRole("alert")).toHaveTextContent("one attachment");
    fireEvent.drop(capture, { dataTransfer: captured("", [new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" })]) });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("JPEG, PNG, WebP, or GIF"));
    expect(screen.queryByText(/validated and ready/)).not.toBeInTheDocument();
  });

  it("retains local image-only save with a literal filename title and an owner-chosen category", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProofEditor item={null} busy={false} allowLocalMedia onClose={() => undefined} onSave={onSave} />);
    const file = validPng("synthetic-2026.png");
    fireEvent.drop(screen.getByRole("group", { name: "Paste or drop evidence" }), { dataTransfer: captured("", [file]) });
    await screen.findByText(file.name);
    expect(screen.getByLabelText(/^Title$/)).toHaveValue(file.name);
    expect(screen.getByLabelText(/Exact quote or evidence/i)).not.toBeRequired();
    fireEvent.change(screen.getByLabelText(/^Category$/), { target: { value: "creativity" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].input).toMatchObject({ title: file.name, evidenceText: "", category: "creativity", occurredOn: null, source: null, sourceType: "other" });
  });

  it("does not accept paste/drop changes during an in-flight save", async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    renderEditor({ onSave });
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Save Proof" }));
    const capture = screen.getByRole("group", { name: "Paste or drop evidence" });
    expect(capture).toHaveAttribute("aria-disabled", "true");
    expect(capture).toHaveAttribute("tabindex", "-1");
    fireEvent.paste(capture, { clipboardData: captured("Late change") });
    fireEvent.drop(capture, { dataTransfer: captured("", [validPng("late.png")]) });
    expect(screen.getByLabelText(/Exact quote or evidence/i)).toHaveValue("Synthetic evidence text");
    await act(async () => finish());
    expect(screen.queryByText("late.png")).not.toBeInTheDocument();
  });
});
