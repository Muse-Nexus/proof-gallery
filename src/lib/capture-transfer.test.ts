import { describe, expect, it } from "vitest";
import { appendCapturedText, readCaptureTransfer } from "./capture-transfer";

function transfer(text = "", files: File[] = []) {
  return { files, items: [], getData: (type: string) => type === "text/plain" ? text : "<img src='https://example.test/private'>" } as unknown as DataTransfer;
}

describe("explicit capture transfer", () => {
  it("keeps literal text and URLs without interpreting HTML or fetching", () => {
    expect(readCaptureTransfer(transfer("  Exact\nwords https://example.test/photo  ")))
      .toEqual({ file: null, text: "  Exact\nwords https://example.test/photo  " });
  });
  it("uses a supplied file without reading its content", () => {
    const file = new File(["fixture"], "example.png", { type: "image/png" });
    expect(readCaptureTransfer(transfer("", [file]))).toEqual({ file, text: "" });
  });
  it("supports clipboard file items when files is empty", () => {
    const file = new File(["fixture"], "pasted.png");
    const input = transfer();
    Object.assign(input, { items: [{ kind: "file", getAsFile: () => file }] });
    expect(readCaptureTransfer(input).file).toBe(file);
  });
  it("rejects multiple files instead of silently choosing one", () => {
    expect(() => readCaptureTransfer(transfer("", [new File(["a"], "a"), new File(["b"], "b")]))).toThrow("one attachment");
  });
  it("rejects HTML-only or URI-list-only drops", () => {
    expect(() => readCaptureTransfer(transfer())).toThrow("Links are not downloaded");
  });
  it("appends without trimming or silently losing excess text", () => {
    expect(appendCapturedText("  Existing. ", " Pasted.\n")).toBe("  Existing. \n\n Pasted.\n");
    expect(appendCapturedText("", "  Quote\n")).toBe("  Quote\n");
    expect(appendCapturedText("Existing", "")).toBe("Existing");
    expect(() => appendCapturedText("Existing", "x".repeat(20_000))).toThrow("unchanged");
  });
});
