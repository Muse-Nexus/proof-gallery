import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto as nodeWebCrypto } from "node:crypto";
import { BroadcastChannel as NodeBroadcastChannel } from "node:worker_threads";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_PROOF_OWNER_ID,
  clearLocalProofItems,
  createLocalProofItem,
  deleteLocalProofItem,
  exportLocalProofBackup,
  importLocalProofBackup,
  listLocalProofItems,
  releaseLocalProofImageUrls,
  requestLocalProofPersistence,
  searchLocalProofItems,
  subscribeToLocalProofChanges,
  updateLocalProofItem,
} from "./local-proof-store";
import type { ProofItemInput } from "./proof";

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalBlob = globalThis.Blob;
const originalFile = globalThis.File;
const originalCrypto = globalThis.crypto;
const originalBroadcastChannel = globalThis.BroadcastChannel;
const originalStorageDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "storage",
);
let objectUrlSequence = 0;
const createObjectUrl = vi.fn(() => `blob:synthetic-${++objectUrlSequence}`);
const revokeObjectUrl = vi.fn();

function input(overrides: Partial<ProofItemInput> = {}): ProofItemInput {
  return {
    title: "Synthetic shipped example",
    evidenceText:
      "A fictional reviewer wrote that the synthetic release was complete.",
    occurredOn: "2026-04-05",
    category: "shipped",
    sourceType: "email",
    source: "Synthetic reviewer email",
    tags: ["example", "complete"],
    person: "Example Person",
    project: "Synthetic Project",
    ...overrides,
  };
}

function pngFile(name = "synthetic.png"): File {
  return new File(
    [
      new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
      ]),
    ],
    name,
    { type: "image/png" },
  );
}

async function backupDocument(): Promise<Record<string, unknown>> {
  return JSON.parse(await (await exportLocalProofBackup()).text()) as Record<
    string,
    unknown
  >;
}

function backupBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: "application/json" });
}

beforeAll(() => {
  // fake-indexeddb delegates cloning to Node's structuredClone, which only
  // preserves Node's Blob implementation (jsdom Blob would become `{}`).
  Object.defineProperty(globalThis, "Blob", {
    configurable: true,
    value: NodeBlob,
  });
  Object.defineProperty(globalThis, "File", {
    configurable: true,
    value: NodeFile,
  });
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: nodeWebCrypto,
  });
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: NodeBroadcastChannel,
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
  });
});

beforeEach(async () => {
  await clearLocalProofItems();
  releaseLocalProofImageUrls();
  createObjectUrl.mockClear();
  revokeObjectUrl.mockClear();
  objectUrlSequence = 0;
});

afterAll(() => {
  releaseLocalProofImageUrls();
  Object.defineProperty(globalThis, "Blob", {
    configurable: true,
    value: originalBlob,
  });
  Object.defineProperty(globalThis, "File", {
    configurable: true,
    value: originalFile,
  });
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
  });
  if (originalBroadcastChannel) {
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: originalBroadcastChannel,
    });
  } else {
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
  }
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl,
    });
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  } else {
    Reflect.deleteProperty(URL, "revokeObjectURL");
  }
  if (originalStorageDescriptor) {
    Object.defineProperty(navigator, "storage", originalStorageDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "storage");
  }
});

describe("local private Proof CRUD", () => {
  it("stores the record and validated image Blob together with local-only ownership", async () => {
    const created = await createLocalProofItem(input(), pngFile());

    expect(created.semanticReady).toBe(false);
    expect(created.item).toMatchObject({
      userId: LOCAL_PROOF_OWNER_ID,
      title: "Synthetic shipped example",
      evidenceText:
        "A fictional reviewer wrote that the synthetic release was complete.",
      category: "shipped",
      sourceType: "email",
      source: "Synthetic reviewer email",
      tags: ["example", "complete"],
      visibility: "personal",
      relevance: null,
    });
    expect(created.item.imagePath).toMatch(/^local-proof:\/\//);
    expect(created.item.imageUrl).toBe("blob:synthetic-1");
    expect(created.item.provenance).toEqual({
      kind: "manual",
      captured_via: "proof_gallery",
      source_type: "email",
      source: "Synthetic reviewer email",
    });

    const firstList = await listLocalProofItems();
    const secondList = await listLocalProofItems();
    expect(firstList).toHaveLength(1);
    expect(secondList[0]?.imageUrl).toBe(firstList[0]?.imageUrl);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("updates and deletes with stale-write protection and explicit URL cleanup", async () => {
    const original = (await createLocalProofItem(input(), pngFile())).item;
    const updated = await updateLocalProofItem(
      original,
      input({
        title: "Synthetic updated title",
        evidenceText: "The exact fictional evidence was updated without inference.",
        source: "Synthetic source, page 2",
      }),
      null,
      false,
    );

    expect(updated).toMatchObject({ semanticReady: false, cleanupFailed: false });
    expect(updated.item.createdAt).toBe(original.createdAt);
    expect(updated.item.updatedAt).not.toBe(original.updatedAt);
    expect(updated.item.imagePath).toBe(original.imagePath);
    expect(updated.item.provenance.source).toBe("Synthetic source, page 2");
    expect(revokeObjectUrl).toHaveBeenCalledWith(original.imageUrl);
    await expect(
      updateLocalProofItem(original, input(), null, false),
    ).rejects.toThrow("changed in another tab");

    const withoutImage = await updateLocalProofItem(
      updated.item,
      input({ title: "Synthetic updated title" }),
      null,
      true,
    );
    expect(withoutImage.item.imagePath).toBeNull();
    expect(withoutImage.item.imageUrl).toBeNull();

    await expect(deleteLocalProofItem(withoutImage.item)).resolves.toEqual({
      cleanupFailed: false,
    });
    await expect(listLocalProofItems()).resolves.toEqual([]);
  });

  it("applies category/tag filters and bounded deterministic Proof-only lexical recall", async () => {
    for (let index = 0; index < 12; index += 1) {
      await createLocalProofItem(
        input({
          title: `Synthetic client release ${index}`,
          evidenceText: `A fictional client valued finished work number ${index}.`,
          tags: ["client", "finished"],
        }),
        null,
      );
    }
    await createLocalProofItem(
      input({
        title: "Synthetic kindness note",
        evidenceText: "A fictional friend sent a kind message.",
        category: "kindness_received",
        sourceType: "message",
        tags: ["friend"],
      }),
      null,
    );

    await expect(
      listLocalProofItems({ category: "kindness_received", tag: "#FRIEND" }),
    ).resolves.toHaveLength(1);
    const result = await searchLocalProofItems(
      "Show times clients valued finished work",
      { category: "shipped", tag: "client" },
    );
    expect(result.semanticDegraded).toBe(true);
    expect(result.items).toHaveLength(10);
    expect(result.items.every((item) => item.category === "shipped")).toBe(true);
    expect(result.items.every((item) => item.tags.includes("client"))).toBe(true);
    expect(result.items.every((item) => (item.relevance ?? 0) > 0)).toBe(true);
    await expect(searchLocalProofItems("no")).rejects.toThrow(
      "at least 3 characters",
    );
  });

  it("maps the documented retrieval questions to stored Proof fields without a model", async () => {
    const shipped = await createLocalProofItem(
      input({
        title: "Synthetic launch record",
        evidenceText: "A fictional release reached its intended destination.",
        category: "shipped",
        tags: ["launch"],
      }),
      null,
    );
    const recovery = await createLocalProofItem(
      input({
        title: "Synthetic difficult-week record",
        evidenceText: "A fictional later entry recorded a material change.",
        category: "recovery",
        tags: ["week"],
      }),
      null,
    );

    await expect(
      searchLocalProofItems("Show me things I finished"),
    ).resolves.toMatchObject({ items: [{ id: shipped.item.id }] });
    await expect(
      searchLocalProofItems("Show me evidence that bad weeks ended"),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: recovery.item.id }),
      ]),
    });
  });

  it("keeps lexical aliases narrow and token-boundary safe", async () => {
    const shipped = await createLocalProofItem(
      input({
        title: "Synthetic delivery record",
        evidenceText: "A fictional artifact reached delivery.",
        category: "shipped",
        tags: ["boundary"],
      }),
      null,
    );
    const unfinished = await createLocalProofItem(
      input({
        title: "Synthetic unfinished draft",
        evidenceText: "A fictional draft remained open.",
        category: "creativity",
        tags: ["boundary"],
      }),
      null,
    );
    const trusted = await createLocalProofItem(
      input({
        title: "Synthetic explicit trust",
        evidenceText: "A fictional client trusted this work.",
        category: "belonging",
        tags: ["boundary"],
      }),
      null,
    );
    const distrusted = await createLocalProofItem(
      input({
        title: "Synthetic distrust decoy",
        evidenceText: "A fictional client distrusted an unrelated draft.",
        category: "belonging",
        tags: ["boundary"],
      }),
      null,
    );
    const explicitFailure = await createLocalProofItem(
      input({
        title: "Synthetic failed check",
        evidenceText: "A fictional validation failed once.",
        category: "creativity",
        tags: ["boundary"],
      }),
      null,
    );
    for (const category of ["competence", "recovery", "shipped"] as const) {
      await createLocalProofItem(
        input({
          title: `Synthetic ${category} category decoy`,
          evidenceText: "A fictional unrelated category record.",
          category,
          tags: ["boundary"],
        }),
        null,
      );
    }

    const finished = await searchLocalProofItems("finished");
    expect(finished.items.map((item) => item.id)).toContain(shipped.item.id);
    expect(finished.items.map((item) => item.id)).not.toContain(
      unfinished.item.id,
    );

    const valued = await searchLocalProofItems("valued");
    expect(valued.items.map((item) => item.id)).toContain(trusted.item.id);
    expect(valued.items.map((item) => item.id)).not.toContain(
      distrusted.item.id,
    );

    const failing = await searchLocalProofItems("failing");
    expect(failing.items.map((item) => item.id)).toEqual([
      explicitFailure.item.id,
    ]);
  });
});

describe("versioned local backup boundary", () => {
  it("round-trips exact evidence, provenance, and a magic-byte-validated image", async () => {
    const original = (await createLocalProofItem(input(), pngFile())).item;
    const backup = await exportLocalProofBackup();
    const document = JSON.parse(await backup.text()) as {
      format: string;
      version: number;
      encryption: string;
      items: Array<Record<string, unknown>>;
    };
    expect(backup.type).toBe("application/json");
    expect(document).toMatchObject({
      format: "muse-nexus-proof-gallery-backup",
      version: 1,
      encryption: "none",
    });
    expect(document.items[0]).toMatchObject({
      evidenceText: original.evidenceText,
      source: original.source,
      provenance: original.provenance,
      visibility: "personal",
      integrity: {
        purpose: "corruption-detection",
        algorithm: "SHA-256",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(document.items[0]?.image).toMatchObject({
      integritySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(document.items[0]).not.toHaveProperty("imageUrl");
    expect(document.items[0]).not.toHaveProperty("userId");

    await clearLocalProofItems();
    const imported = await importLocalProofBackup(backup);
    expect(imported.imported).toBe(1);
    expect(imported.importedCount).toBe(1);
    const [restored] = await listLocalProofItems();
    expect(restored).toMatchObject({
      id: original.id,
      evidenceText: original.evidenceText,
      source: original.source,
      provenance: original.provenance,
      visibility: "personal",
    });
    expect(restored?.imagePath).not.toBeNull();

    const repeated = await importLocalProofBackup(backup);
    expect(repeated).toMatchObject({ imported: 0, importedCount: 0, items: [] });
  });

  it("rejects a divergent same-id collision and rolls back new items", async () => {
    const original = (await createLocalProofItem(input(), null)).item;
    const removedBeforeRestore = (
      await createLocalProofItem(
        input({ title: "Synthetic item that must roll back" }),
        null,
      )
    ).item;
    const backup = await exportLocalProofBackup();
    await deleteLocalProofItem(removedBeforeRestore);
    const divergent = await updateLocalProofItem(
      original,
      input({
        evidenceText: "Divergent synthetic evidence must remain local.",
      }),
      null,
      false,
    );

    await expect(
      importLocalProofBackup(backup),
    ).rejects.toThrow("conflicts with the existing item");
    const remaining = await listLocalProofItems();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      id: original.id,
      evidenceText: divergent.item.evidenceText,
    });
  });

  it("rejects a same-id collision with a different valid image", async () => {
    const original = (await createLocalProofItem(input(), pngFile())).item;
    const backup = await exportLocalProofBackup();
    const changedImage = new File(
      [
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x00,
        ]),
      ],
      "changed.png",
      { type: "image/png" },
    );
    await updateLocalProofItem(original, input(), changedImage, false);

    await expect(
      importLocalProofBackup(backup),
    ).rejects.toThrow("conflicts with the existing item");

    const after = await backupDocument();
    const afterImage = (after.items as Array<Record<string, unknown>>)[0]
      ?.image as Record<string, unknown>;
    const originalDocument = JSON.parse(await backup.text()) as {
      items: Array<Record<string, unknown>>;
    };
    const originalImage = originalDocument.items[0]?.image as Record<
      string,
      unknown
    >;
    expect(afterImage.integritySha256).not.toBe(
      originalImage.integritySha256,
    );
  });

  it("rejects unknown schema, category, source type, and visibility values", async () => {
    await createLocalProofItem(input(), null);
    const valid = await backupDocument();
    const item = (valid.items as Array<Record<string, unknown>>)[0];

    await expect(
      importLocalProofBackup(backupBlob({ ...valid, unexpected: true })),
    ).rejects.toThrow("unsupported schema");
    await expect(
      importLocalProofBackup(
        backupBlob({ ...valid, items: [{ ...item, category: "gratitude" }] }),
      ),
    ).rejects.toThrow("unsupported category");
    await expect(
      importLocalProofBackup(
        backupBlob({ ...valid, items: [{ ...item, sourceType: "gmail" }] }),
      ),
    ).rejects.toThrow("unsupported source type");
    await expect(
      importLocalProofBackup(
        backupBlob({ ...valid, items: [{ ...item, visibility: "team" }] }),
      ),
    ).rejects.toThrow("non-private");
  });

  it("detects evidence or provenance corruption with the canonical item receipt", async () => {
    await createLocalProofItem(input(), null);
    const document = await backupDocument();
    const item = (document.items as Array<Record<string, unknown>>)[0];

    await expect(
      importLocalProofBackup(
        backupBlob({
          ...document,
          items: [
            {
              ...item,
              evidenceText: "Synthetic text altered after export.",
            },
          ],
        }),
      ),
    ).rejects.toThrow("corruption-detection integrity check failed");
  });

  it("validates every item and image before one atomic import transaction", async () => {
    await createLocalProofItem(
      input({ title: "Synthetic valid import A" }),
      pngFile("a.png"),
    );
    await createLocalProofItem(
      input({ title: "Synthetic invalid import B" }),
      pngFile("b.png"),
    );
    const document = await backupDocument();
    const items = document.items as Array<Record<string, unknown>>;
    const badImage = {
      ...(items[1]?.image as Record<string, unknown>),
      base64: btoa("not-a-png!"),
    };
    const invalidBackup = backupBlob({
      ...document,
      items: [items[0], { ...items[1], image: badImage }],
    });

    await clearLocalProofItems();
    const sentinel = await createLocalProofItem(
      input({ title: "Synthetic existing sentinel" }),
      null,
    );
    await expect(importLocalProofBackup(invalidBackup)).rejects.toThrow(
      "do not match",
    );
    const remaining = await listLocalProofItems();
    expect(remaining.map((item) => item.id)).toEqual([sentinel.item.id]);
  });
});

describe("local durability helpers", () => {
  it("requests persistent browser storage and reports the browser decision", async () => {
    const persisted = vi.fn().mockResolvedValue(false);
    const persist = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persisted, persist },
    });

    await expect(requestLocalProofPersistence()).resolves.toBe(true);
    expect(persisted).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
  });

  it("revokes all cached image URLs and clears the canonical store", async () => {
    await createLocalProofItem(input(), pngFile());
    const [{ imageUrl }] = await listLocalProofItems();
    releaseLocalProofImageUrls();
    expect(revokeObjectUrl).toHaveBeenCalledWith(imageUrl);

    await clearLocalProofItems();
    await expect(listLocalProofItems()).resolves.toEqual([]);
  });

  it("broadcasts clear to another tab only after cached image URLs are revoked", async () => {
    await createLocalProofItem(input(), pngFile());
    const [{ imageUrl }] = await listLocalProofItems();
    revokeObjectUrl.mockClear();

    const peer = new NodeBroadcastChannel(
      "muse-nexus-proof-gallery-local-changes-v1",
    );
    const received = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for local Proof clear")),
        2_000,
      );
      peer.onmessage = (event) => {
        if (event.data !== "clear") return;
        try {
          expect(revokeObjectUrl).toHaveBeenCalledWith(imageUrl);
          clearTimeout(timeout);
          resolve();
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };
    });

    try {
      await clearLocalProofItems();
      await received;
    } finally {
      peer.close();
    }
  });

  it("delivers only incoming cross-tab notices to subscribers", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToLocalProofChanges(listener);
    const peer = new NodeBroadcastChannel(
      "muse-nexus-proof-gallery-local-changes-v1",
    );

    try {
      await createLocalProofItem(input(), null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(listener).not.toHaveBeenCalled();

      const received = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timed out waiting for local Proof change")),
          2_000,
        );
        listener.mockImplementationOnce((kind: "change" | "clear") => {
          try {
            expect(kind).toBe("change");
            clearTimeout(timeout);
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });
      });
      peer.postMessage("change");
      await received;
    } finally {
      unsubscribe();
      peer.close();
    }
  });

  it("uses no network across the complete local Proof lifecycle", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      const created = await createLocalProofItem(input(), pngFile());
      await listLocalProofItems();
      await searchLocalProofItems("finished");
      const backup = await exportLocalProofBackup();
      await deleteLocalProofItem(created.item);
      const imported = await importLocalProofBackup(backup);
      await deleteLocalProofItem(imported.items[0]!);

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
