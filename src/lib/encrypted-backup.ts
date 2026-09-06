/** Versioned, authenticated binary archive. No passphrase or key is persisted. */
const MAGIC = new TextEncoder().encode("PROOFENC");
const HEADER_BYTES = 41;
const ITERATIONS = 600_000;
export const MAX_FULL_BACKUP_BYTES = 144 * 1024 * 1024;

async function keyFor(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const bytes = new TextEncoder().encode(passphrase);
  if (passphrase.length < 12 || bytes.length > 1024) {
    throw new Error("Use a passphrase of at least 12 characters (at most 1,024 bytes).");
  }
  const material = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
  bytes.fill(0);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

export async function isEncryptedProofBackup(blob: Blob): Promise<boolean> {
  const prefix = new Uint8Array(await blob.slice(0, MAGIC.length).arrayBuffer());
  return prefix.length === MAGIC.length && MAGIC.every((byte, index) => prefix[index] === byte);
}

export async function encryptProofBackup(payload: Blob, passphrase: string): Promise<Blob> {
  if (!payload.size || payload.size > MAX_FULL_BACKUP_BYTES) throw new Error("Backup is too large to encrypt safely.");
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  header[8] = 1;
  new DataView(header.buffer).setUint32(9, ITERATIONS);
  header.set(crypto.getRandomValues(new Uint8Array(16)), 13);
  header.set(crypto.getRandomValues(new Uint8Array(12)), 29);
  const key = await keyFor(passphrase, header.slice(13, 29));
  const plaintext = new Uint8Array(await payload.arrayBuffer());
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: header.slice(29), additionalData: header, tagLength: 128 }, key, plaintext,
    );
    return new Blob([header, ciphertext], { type: "application/octet-stream" });
  } finally { plaintext.fill(0); }
}

export async function decryptProofBackup(archive: Blob, passphrase: string): Promise<Blob> {
  if (archive.size <= HEADER_BYTES + 16 || archive.size > MAX_FULL_BACKUP_BYTES + HEADER_BYTES + 16) {
    throw new Error("Encrypted backup has an invalid size.");
  }
  const header = new Uint8Array(await archive.slice(0, HEADER_BYTES).arrayBuffer());
  if (!MAGIC.every((byte, index) => header[index] === byte) || header[8] !== 1 ||
      new DataView(header.buffer).getUint32(9) !== ITERATIONS) {
    throw new Error("Unsupported encrypted backup format. Nothing was restored.");
  }
  const key = await keyFor(passphrase, header.slice(13, 29));
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: header.slice(29), additionalData: header, tagLength: 128 },
      key, await archive.slice(HEADER_BYTES).arrayBuffer(),
    );
    const result = new Blob([plaintext], { type: "application/json" });
    new Uint8Array(plaintext).fill(0);
    return result;
  } catch {
    throw new Error("The passphrase is incorrect or this backup is damaged. Nothing was restored.");
  }
}
