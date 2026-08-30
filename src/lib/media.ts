import { validateProofImage } from "./proof";

export const LOCAL_MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm";
export const LOCAL_MEDIA_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm",
]);

// This only checks a bounded container signature, not codec/playback support.
// Media is rendered in a native img/video element, never as HTML or an iframe.
export async function validateLocalProofMedia(file: File): Promise<void> {
  if (file.type.startsWith("image/")) return validateProofImage(file);
  if (!LOCAL_MEDIA_TYPES.has(file.type)) {
    throw new Error("Choose JPEG, PNG, WebP, GIF, MP4, or WebM. Export HEIC/HEIF as JPEG and MOV as MP4 first.");
  }
  if (!file.size || file.size > 10 * 1024 * 1024) {
    throw new Error("Each photo or clip must be between 1 byte and 10 MB");
  }
  const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const ascii = new TextDecoder("latin1").decode(bytes);
  if (file.type === "video/mp4") {
    const boxLength = bytes.length >= 12 ? new DataView(bytes.buffer).getUint32(0) : 0;
    const brand = ascii.slice(8, 12);
    if (boxLength < 16 || boxLength > file.size || ascii.slice(4, 8) !== "ftyp" ||
      !/^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(brand)) {
      throw new Error("The file is not a supported MP4 container");
    }
  } else if (![0x1a, 0x45, 0xdf, 0xa3].every((b, i) => bytes[i] === b) || !ascii.includes("webm")) {
    throw new Error("The file is not a supported WebM container");
  }
}
