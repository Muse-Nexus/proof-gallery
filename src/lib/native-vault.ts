import { isProofCategory, isProofSourceType } from './proof';
import { LOCAL_MEDIA_TYPES, validateLocalProofMedia } from './media';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
export type NativeState = 'saved' | 'pending';
export interface NativeFields {
  title: string; evidenceText: string; occurredOn?: string; category?: string;
  sourceType: string; source?: string; tags: string[]; person?: string; project?: string;
}
export interface NativeRecord {
  id: string; collectionID: string; revision: string; state: NativeState; fields: NativeFields;
  media?: { filename: string; mimeType: string; sha256: string; size: number };
  receipt?: { version: number; provider: 'photos' | 'folder'; sourceID: string; assetIdentifier?: string;
    originalFilename: string; originalSha256: string; representation: 'original' | 'jpeg-preview';
    captureDate?: string; timeZone?: string; scope: string };
  provenance: Record<string, unknown>;
  approval?: { method: string; approvedAt: string; sourceGrantID?: string; sourceGrantRevision?: string };
  restoreReceipt?: { originalCollectionID: string; sourceCollectionID: string; restoredAt: string };
  createdAt: string; updatedAt: string;
}
export interface NativeInfo { version: 2; collectionID: string; grantID: string; expiresAt: string; scopes: string[] }
export interface NativeList { collectionID: string; items: NativeRecord[]; matching: 'newest' | 'local-semantic' | 'local-literal-text'; hasMore: boolean; searchedCount?: number; searchScope?: string }
export interface NativeMedia { filename: string; mimeType: string; sha256: string; bytes: string }
export interface NativeInput { fields: NativeFields; media?: NativeMedia; provenance: Record<string, unknown> }
export const NATIVE_ERROR = 'Native connection unavailable or changed. Reconnect and check the collection before repeating an action; a submitted change may already have completed.';
const invalid = (): never => { throw new Error(NATIVE_ERROR); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number, required = false): v is string => typeof v === 'string' && new TextEncoder().encode(v).length <= max && !v.includes('\0') && (!required || !!v.trim());
const optional = (v: unknown, max: number) => v === undefined || text(v, max);
const stamp = (v: unknown): v is string => text(v, 64, true) && Number.isFinite(Date.parse(v));
export function parseNativeConnection(code: string): { port: number; token: string; collectionID: string } {
  const parts = code.trim().split('.');
  if (parts.length !== 3 || !/^\d{4,5}$/.test(parts[0]) || Number(parts[0]) < 1024 || Number(parts[0]) > 65535 || !HASH.test(parts[1]) || !UUID.test(parts[2])) return invalid();
  return { port: Number(parts[0]), token: parts[1], collectionID: parts[2] };
}
export function validNativeFields(v: unknown, saved: boolean): v is NativeFields {
  if (!object(v) || !text(v.title, 300) || !text(v.evidenceText, 16000) || !isProofSourceType(v.sourceType) ||
      !Array.isArray(v.tags) || v.tags.length > 30 || !v.tags.every(t => text(t, 100, true)) ||
      ![v.source, v.person, v.project].every(t => optional(t, 2000)) ||
      (v.category !== undefined && !isProofCategory(v.category)) || (saved && !isProofCategory(v.category))) return false;
  if (v.occurredOn !== undefined && (!text(v.occurredOn, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(v.occurredOn) || !Number.isFinite(Date.parse(v.occurredOn)) || new Date(v.occurredOn).toISOString().slice(0, 10) !== v.occurredOn)) return false;
  return true;
}
export function validateNativeRecord(v: unknown, collectionID: string, state?: NativeState): NativeRecord {
  if (!object(v) || !text(v.id, 36) || !UUID.test(v.id) || !text(v.revision, 36) || !UUID.test(v.revision) || v.collectionID !== collectionID ||
      !['saved', 'pending'].includes(String(v.state)) || (state && v.state !== state) || !validNativeFields(v.fields, v.state === 'saved') ||
      !object(v.provenance) || JSON.stringify(v.provenance).length > 32768 || !stamp(v.createdAt) || !stamp(v.updatedAt)) return invalid();
  if (v.restoreReceipt !== undefined && (!object(v.restoreReceipt) || !text(v.restoreReceipt.originalCollectionID, 36) || !UUID.test(v.restoreReceipt.originalCollectionID) || !text(v.restoreReceipt.sourceCollectionID, 36) || !UUID.test(v.restoreReceipt.sourceCollectionID) || !stamp(v.restoreReceipt.restoredAt))) return invalid();
  if (v.state === 'saved' && !object(v.approval)) return invalid();
  if (v.state === 'pending' && v.approval !== undefined) return invalid();
  if (v.approval !== undefined && (!object(v.approval) || !['manual', 'manual-review', 'trusted-source'].includes(String(v.approval.method)) || !stamp(v.approval.approvedAt) || !optional(v.approval.sourceGrantID, 1024) || !optional(v.approval.sourceGrantRevision, 1024))) return invalid();
  if (v.media !== undefined && (!object(v.media) || !text(v.media.filename, 1024, true) || !LOCAL_MEDIA_TYPES.has(String(v.media.mimeType)) ||
      !text(v.media.sha256, 64) || !HASH.test(v.media.sha256) || !Number.isInteger(v.media.size) || Number(v.media.size) < 1 || Number(v.media.size) > 10 * 1024 * 1024)) return invalid();
  if (v.receipt !== undefined) {
    const r = v.receipt;
    if (!object(r) || !object(v.media) || r.version !== 1 || !['folder', 'photos'].includes(String(r.provider)) ||
        !text(r.sourceID, 1024, true) || !text(r.scope, 1024, true) || !text(r.originalFilename, 1024, true) ||
        !text(r.originalSha256, 64) || !HASH.test(r.originalSha256) || !optional(r.assetIdentifier, 1024) ||
        !['original', 'jpeg-preview'].includes(String(r.representation)) ||
        (r.representation === 'original' ? r.originalSha256 !== v.media.sha256 : v.media.mimeType !== 'image/jpeg') ||
        (r.captureDate !== undefined && !stamp(r.captureDate)) || !optional(r.timeZone, 100)) return invalid();
  }
  return v as unknown as NativeRecord;
}

/** Ephemeral connection; credentials never enter URL, storage, logs, or browser DB. */
export class NativeVaultClient {
  private connection: ReturnType<typeof parseNativeConnection> | null;
  private controllers = new Set<AbortController>();
  private generation = 0;
  private expiresAt = 0;
  constructor(code: string, private fetcher: typeof fetch = fetch, private now: () => number = Date.now) { this.connection = parseNativeConnection(code); }
  get collectionID(): string { return this.connection?.collectionID ?? ''; }
  disconnect(): void { this.cancel(); this.connection = null; this.expiresAt = 0; }
  cancel(): void { this.generation++; for (const c of this.controllers) c.abort(); this.controllers.clear(); }
  private async request(path: string, body: unknown, max = 8 * 1024 * 1024): Promise<unknown> {
    const c = this.connection;
    if (!c || (path !== 'info' && this.now() >= this.expiresAt)) return invalid();
    const controller = new AbortController(); this.controllers.add(controller);
    const generation = this.generation;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetcher(`http://127.0.0.1:${c.port}/v2/gallery/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
        body: JSON.stringify(body), signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (!response.ok || response.redirected || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || Number(response.headers.get('content-length') ?? 0) > max) return invalid();
      const reader = response.body?.getReader(); if (!reader) return invalid();
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > max) return invalid(); chunks.push(value); }
      } finally { await reader.cancel(); }
      if (generation !== this.generation || this.connection !== c || controller.signal.aborted || (path !== 'info' && this.now() >= this.expiresAt)) return invalid();
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { return invalid(); }
    finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
  async info(): Promise<NativeInfo> {
    const value = await this.request('info', {});
    if (!object(value) || value.version !== 2 || value.collectionID !== this.collectionID || !text(value.grantID, 36) || !UUID.test(value.grantID) ||
        !stamp(value.expiresAt) || Date.parse(value.expiresAt) <= this.now() || !Array.isArray(value.scopes) ||
        !['savedText', 'savedMedia', 'galleryReview'].every(s => (value.scopes as unknown[]).includes(s))) return invalid();
    this.expiresAt = Date.parse(value.expiresAt); return value as unknown as NativeInfo;
  }
  async list(state: NativeState, offset = 0, query = '', category = '', tag = ''): Promise<NativeList> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || !text(query, 500) || !text(tag, 100) || (category && !isProofCategory(category)) || (state === 'pending' && query)) return invalid();
    const value = await this.request('list', { state, limit: query ? 10 : 30, offset, ...(query ? { query } : {}), ...(category ? { category } : {}), ...(tag ? { tag } : {}) });
    if (!object(value) || value.collectionID !== this.collectionID || !Array.isArray(value.items) || value.items.length > (query ? 10 : 30) ||
        !['newest', 'local-semantic', 'local-literal-text'].includes(String(value.matching)) || typeof value.hasMore !== 'boolean' || (value.searchedCount !== undefined && (!Number.isInteger(value.searchedCount) || Number(value.searchedCount) < 0 || Number(value.searchedCount) > 100)) || !optional(value.searchScope, 500)) return invalid();
    return { ...value, items: value.items.map(v => validateNativeRecord(v, this.collectionID, state)) } as NativeList;
  }
  async media(record: NativeRecord): Promise<Blob> {
    const value = await this.request('media', { id: record.id, revision: record.revision }, 15 * 1024 * 1024);
    if (!record.media || !object(value) || value.filename !== record.media.filename || value.mimeType !== record.media.mimeType || value.sha256 !== record.media.sha256 ||
        !text(value.bytes, 14 * 1024 * 1024) || (value.bytes.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value.bytes) || value.bytes.slice(0, -2).includes('='))) return invalid();
    const generation = this.generation;
    let bytes: Uint8Array<ArrayBuffer>;
    try { const binary = atob(value.bytes); if (btoa(binary) !== value.bytes) return invalid(); bytes = Uint8Array.from(binary, c => c.charCodeAt(0)); } catch { return invalid(); }
    if (bytes.length !== record.media.size) return invalid();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    const file = new File([bytes], value.filename, { type: value.mimeType as string });
    try { await validateLocalProofMedia(file); } catch { return invalid(); }
    if (digest !== record.media.sha256 || generation !== this.generation || !this.connection || this.now() >= this.expiresAt) return invalid();
    return file;
  }
  async write(action: 'create' | 'edit' | 'approve', fields: NativeFields, record?: NativeRecord, media?: File): Promise<NativeRecord> {
    if (!validNativeFields(fields, action !== 'edit' || record?.state === 'saved') || (action !== 'create' && !record)) return invalid();
    const input: NativeInput = { fields, provenance: {} };
    const generation = this.generation;
    if (media) {
      if (action !== 'create') return invalid();
      await validateLocalProofMedia(media); const bytes = new Uint8Array(await media.arrayBuffer());
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      input.media = { filename: media.name, mimeType: media.type, sha256, bytes: btoa(binary) };
    }
    if (generation !== this.generation) return invalid();
    const value = await this.request(action, action === 'create' ? { input } : { id: record!.id, revision: record!.revision, fields });
    if (!object(value)) return invalid();
    return validateNativeRecord(value.item, this.collectionID, action === 'edit' ? record!.state : 'saved');
  }
  async delete(record: NativeRecord): Promise<void> {
    const value = await this.request('delete', { id: record.id, revision: record.revision });
    if (!object(value) || value.deleted !== true) return invalid();
  }
}
