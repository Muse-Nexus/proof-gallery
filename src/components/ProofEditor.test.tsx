import {
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

function validPng(): File {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    "synthetic.png",
    { type: "image/png" },
  );
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

    expect(screen.getByLabelText(/^Title$/)).toHaveFocus();

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
