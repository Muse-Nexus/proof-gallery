import { afterEach, describe, expect, it, vi } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { NativeVaultClient, NATIVE_ERROR, parseNativeConnection, validateNativeRecord, type NativeRecord } from './native-vault';
const collectionID = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const code = `12345.${'a'.repeat(64)}.${collectionID}`;
const info = { version: 2, collectionID, grantID: id, expiresAt: '2030-01-01T00:00:00.000Z', scopes: ['savedText', 'savedMedia', 'galleryReview'] };
const record: NativeRecord = { id, collectionID, revision: id, state: 'saved', fields: { title: 'Synthetic note', evidenceText: 'I did not say that. Thank you for reviewing the draft.', category: 'creativity', sourceType: 'message', source: 'Synthetic original source', tags: [] }, provenance: { fixture: true }, approval: { method: 'manual', approvedAt: '2026-09-07T00:00:00.000Z' }, createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z' };
const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
const list = (items = [record]) => ({ collectionID, items, hasMore: false, matching: 'newest' });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['https://example.org', `12345.${'a'.repeat(64)}.${collectionID}.extra`, `80.${'a'.repeat(64)}.${collectionID}`, `12345.${'A'.repeat(64)}.${collectionID}`, `65536.${'a'.repeat(64)}.${collectionID}`])('rejects malformed or external connection %s', value => expect(() => parseNativeConnection(value)).toThrow(NATIVE_ERROR));
it('connects without retrieval or storage and sends only a header credential to exact loopback', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(info)); const storage = vi.spyOn(window.localStorage, 'setItem');
  const client = new NativeVaultClient(code, fetcher); await client.info();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:12345/v2/gallery/info', expect.objectContaining({ method: 'POST', body: '{}', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'a'.repeat(64)}` } }));
  expect(storage).not.toHaveBeenCalled(); client.disconnect();
  await expect(client.info()).rejects.toThrow(NATIVE_ERROR); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([{ ...info, collectionID: id }, { ...info, scopes: ['savedText'] }, { ...info, expiresAt: '2000-01-01' }])('rejects wrong collection, missing scope or expired permission', async value => {
  await expect(new NativeVaultClient(code, vi.fn().mockResolvedValue(response(value))).info()).rejects.toThrow(NATIVE_ERROR);
});
it('preserves full negation/source/unknown date and historical restore receipt', () => {
  const restored = { ...record, restoreReceipt: { originalCollectionID: id, sourceCollectionID: id, restoredAt: record.createdAt } };
  expect(validateNativeRecord(restored, collectionID, 'saved')).toBe(restored);
  expect(restored.fields.evidenceText).toContain('did not'); expect(restored.fields.occurredOn).toBeUndefined();
});
it.each([{ ...record, collectionID: id }, { ...record, state: 'pending' }, { ...record, approval: undefined }, { ...record, fields: { ...record.fields, occurredOn: '2026-02-30' } }])('rejects foreign/pending/unapproved/malformed saved records', value => {
  expect(() => validateNativeRecord(value, collectionID, 'saved')).toThrow(NATIVE_ERROR);
});
it('checks search byte limit before network and keeps pending out of search', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(info)); const client = new NativeVaultClient(code, fetcher); await client.info();
  await expect(client.list('saved', 0, 'é'.repeat(251))).rejects.toThrow(NATIVE_ERROR);
  await expect(client.list('pending', 0, 'thank')).rejects.toThrow(NATIVE_ERROR); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('preserves response order and scoped-search limits', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response({ ...list(), matching: 'local-literal-text', searchedCount: 100, searchScope: 'newest 100 filtered saved items' }));
  const client = new NativeVaultClient(code, fetcher); await client.info();
  const found = await client.list('saved', 0, 'draft'); expect(found.items[0].fields).toEqual(record.fields); expect(found.searchedCount).toBe(100);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ state: 'saved', limit: 10, offset: 0, query: 'draft' });
});
it('aborts and discards an in-flight result on disconnect, even if transport ignores abort', async () => {
  let resolve!: (v: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(response(info)).mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
  const client = new NativeVaultClient(code, fetcher); await client.info(); const pending = client.list('saved');
  client.disconnect(); expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true); resolve(response(list()));
  await expect(pending).rejects.toThrow(NATIVE_ERROR);
});
it('never retries a write with an uncertain result or echoes errors', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response({ error: 'private token source' }, 409));
  const client = new NativeVaultClient(code, fetcher); await client.info();
  await expect(client.write('edit', record.fields, record)).rejects.toThrow(NATIVE_ERROR); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ id, revision: id, fields: record.fields });
});
it('bounds streamed JSON even without content-length', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); c.close(); } }), { headers: { 'Content-Type': 'application/json' } }));
  const client = new NativeVaultClient(code, fetcher); await client.info(); await expect(client.list('saved')).rejects.toThrow(NATIVE_ERROR);
});
it('verifies attachment hash, length and MIME before returning bytes', async () => {
  vi.stubGlobal('File', NodeFile); vi.stubGlobal('crypto', webcrypto);
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const sha256 = [...new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  const media = { filename: 'synthetic.png', mimeType: 'image/png', sha256, size: bytes.length };
  const item = { ...record, media }; const payload = { ...media, bytes: btoa(String.fromCharCode(...bytes)) };
  const fetcher = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response(payload)).mockResolvedValueOnce(response({ ...payload, bytes: btoa('wrong!!!') }));
  const client = new NativeVaultClient(code, fetcher); await client.info(); expect((await client.media(item)).size).toBe(8);
  await expect(client.media(item)).rejects.toThrow(NATIVE_ERROR);
});
it('calls browser fetch with the global receiver rather than the client instance', async () => {
  const browserFetch = vi.fn(function (this: unknown) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return Promise.resolve(response(info));
  });
  vi.stubGlobal('fetch', browserFetch);
  const client = new NativeVaultClient(code);
  await expect(client.info()).resolves.toMatchObject({ collectionID });
  expect(browserFetch.mock.contexts).toEqual([globalThis]);
});
