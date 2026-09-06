import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptProofBackup, encryptProofBackup, isEncryptedProofBackup } from "./encrypted-backup";
beforeAll(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("Blob", NodeBlob); });
afterAll(() => vi.unstubAllGlobals());
describe("encrypted private archives", () => {
  it("round-trips exact bytes with fresh salts and IVs", async () => {
    const payload = new Blob(['{"synthetic":"saved and pending"}']);
    const one = await encryptProofBackup(payload, "synthetic long password");
    const two = await encryptProofBackup(payload, "synthetic long password");
    expect(await isEncryptedProofBackup(one)).toBe(true);
    expect(await one.text()).not.toContain("saved and pending");
    expect([...new Uint8Array(await one.arrayBuffer())]).not.toEqual([...new Uint8Array(await two.arrayBuffer())]);
    expect(await (await decryptProofBackup(one, "synthetic long password")).text()).toBe(await payload.text());
    expect(await isEncryptedProofBackup(payload)).toBe(false);
  });
  it("fails closed for wrong passwords, tampering, and unsupported work factors", async () => {
    const archive = await encryptProofBackup(new Blob(["synthetic evidence"]), "synthetic long password");
    await expect(decryptProofBackup(archive, "wrong but long password")).rejects.toThrow("incorrect");
    const bytes = new Uint8Array(await archive.arrayBuffer()); bytes[29] ^= 1;
    await expect(decryptProofBackup(new Blob([bytes]), "synthetic long password")).rejects.toThrow("damaged");
    bytes[9] = 255;
    await expect(decryptProofBackup(new Blob([bytes]), "synthetic long password")).rejects.toThrow("Unsupported");
    await expect(encryptProofBackup(new Blob(["synthetic"]), "short")).rejects.toThrow("12");
  });
});
