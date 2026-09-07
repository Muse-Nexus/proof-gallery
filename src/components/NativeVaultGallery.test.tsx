import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { NativeVaultGallery } from './NativeVaultGallery';
import { NativeVaultClient } from '../lib/native-vault';
const collectionID = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const code = `12345.${'a'.repeat(64)}.${collectionID}`;
const note = 'I did not say it was easy. Thank you for reviewing my draft.';
const record = { id, revision: id, collectionID, state: 'saved', fields: { title: 'Synthetic message', evidenceText: note, category: 'creativity', sourceType: 'message', tags: [], source: 'Synthetic source' }, provenance: {}, approval: { method: 'manual', approvedAt: '2026-09-07T00:00:00.000Z' }, createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z' };
const info = { version: 2, collectionID, grantID: id, expiresAt: new Date(Date.now() + 600000).toISOString(), scopes: ['savedText', 'savedMedia', 'galleryReview'] };
const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
let hidden = false;
beforeEach(() => { hidden = false; vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  const fetcher = vi.fn().mockImplementation(async (url: string) => url.endsWith('/info') ? response(info) : response({ collectionID, items: [record], hasMore: false, matching: 'newest' }));
  vi.stubGlobal('fetch', fetcher); const exit = vi.fn(); render(<NativeVaultGallery onExit={exit} />); return { fetcher, exit };
}
async function connect() {
  fireEvent.change(screen.getByLabelText('Native gallery connection code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect native vault' }));
  await screen.findByText('Connected to a separate native collection. Choose what to open.');
}
it('does not connect automatically or fetch evidence until requested; preserves full original words', async () => {
  const { fetcher } = setup(); expect(fetcher).not.toHaveBeenCalled(); await connect();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(screen.queryByText(note)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open saved Proof' }));
  expect(await screen.findByText(note)).toBeInTheDocument(); expect(screen.getByText('Synthetic source')).toBeInTheDocument();
  expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
});
it('hides evidence and preserves the draft until permission and explicit resume', async () => {
  const { fetcher } = setup(); await connect(); fireEvent.click(screen.getByRole('button', { name: 'Open saved Proof' })); await screen.findByText(note);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Proof' }));
  fireEvent.change(screen.getByLabelText('Exact words or note'), { target: { value: 'Unsaved synthetic change' } });
  act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  expect(screen.queryByText(note)).not.toBeInTheDocument(); expect(screen.queryByDisplayValue('Unsaved synthetic change')).not.toBeInTheDocument();
  const before = fetcher.mock.calls.length;
  act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await screen.findByText('Permission checked. Choose saved Proof or pending review to continue.');
  expect(fetcher.mock.calls.slice(before).map(c => c[0])).toEqual(['http://127.0.0.1:12345/v2/gallery/info']);
  expect(screen.queryByText(note)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Unsaved synthetic change')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Resume draft' }));
  expect(await screen.findByDisplayValue('Unsaved synthetic change')).toBeInTheDocument();
  expect(fetcher.mock.calls.slice(before).every(c => c[0].endsWith('/info'))).toBe(true);
  fetcher.mockImplementation(async (url: string) => url.endsWith('/info') ? response(info) : response({ item: { ...record, fields: { ...record.fields, evidenceText: 'Unsaved synthetic change' } } }));
  fireEvent.click(screen.getByRole('button', { name: 'Save in native vault' }));
  await screen.findByText('Saved in the native vault. Open saved Proof when you choose.');
  const edit = fetcher.mock.calls.find(c => c[0].endsWith('/edit'))!;
  expect(JSON.parse(edit[1].body).revision).toBe(record.revision);
});
it('drops evidence when revocation is detected and never shows server diagnostics', async () => {
  const { fetcher } = setup(); await connect(); fireEvent.click(screen.getByRole('button', { name: 'Open saved Proof' })); await screen.findByText(note);
  fetcher.mockResolvedValue(response({ error: 'private path and token' }, 403));
  fireEvent.click(screen.getByRole('button', { name: 'Open saved Proof' }));
  await screen.findByText(/Native connection unavailable or changed/);
  expect(screen.queryByText(note)).not.toBeInTheDocument(); expect(screen.queryByText('private path and token')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Native gallery connection code')).toHaveValue('');
});
it('pending stays separate until explicit category choice and approval; writes only editable fields', async () => {
  const { fetcher } = setup(); await connect();
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith('/info')) return response(info);
    if (url.endsWith('/approve')) return response({ item: record });
    return response({ collectionID, items: [{ ...record, state: 'pending', approval: undefined, fields: { ...record.fields, category: undefined } }], matching: 'newest', hasMore: false });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open pending review' })); await screen.findByText('Pending review — not saved Proof');
  expect(fetcher.mock.calls.some(c => c[0].endsWith('/approve'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Review candidate' }));
  fireEvent.change(screen.getByLabelText('Category', { exact: true }), { target: { value: 'creativity' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve and save Proof' }));
  await screen.findByText('Saved in the native vault. Open saved Proof when you choose.');
  const call = fetcher.mock.calls.find(c => c[0].endsWith('/approve'))!;
  expect(JSON.parse(call[1].body)).toEqual({ id, revision: id, fields: record.fields });
  expect(screen.queryByText(note)).not.toBeInTheDocument();
});
it('disconnect aborts in-flight reads and a late response cannot restore the collection', async () => {
  const { fetcher } = setup(); await connect();
  let resolve!: (response: Response) => void;
  fetcher.mockImplementation((url: string) => url.endsWith('/info') ? Promise.resolve(response(info)) : new Promise<Response>(r => { resolve = r; }));
  fireEvent.click(screen.getByRole('button', { name: 'Open saved Proof' }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect native vault' }));
  await act(async () => resolve(response({ collectionID, items: [record], hasMore: false, matching: 'newest' })));
  expect(screen.queryByText(note)).not.toBeInTheDocument(); expect(screen.getByLabelText('Native gallery connection code')).toHaveValue('');
});

it('retains the selected File in memory while hidden without exposing its name before resume', async () => {
  const { fetcher } = setup(); await connect();
  fireEvent.click(screen.getByRole('button', { name: 'Add native Proof' }));
  fireEvent.change(screen.getByLabelText('Exact words or note'), { target: { value: 'Synthetic draft with attachment' } });
  fireEvent.change(screen.getByLabelText('Category', { exact: true }), { target: { value: 'creativity' } });
  const file = new File(['synthetic'], 'private-synthetic-file.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Optional photo or clip'), { target: { files: [file] } });
  act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  expect(screen.queryByText(/private-synthetic-file/)).not.toBeInTheDocument();
  const callsBefore = fetcher.mock.calls.length;
  act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await screen.findByText('Permission checked. Choose saved Proof or pending review to continue.');
  expect(screen.queryByText(/private-synthetic-file/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Resume draft' }));
  await screen.findByDisplayValue('Synthetic draft with attachment');
  expect(screen.getByText(/Selected attachment: private-synthetic-file.png/)).toBeInTheDocument();
  expect(fetcher.mock.calls.slice(callsBefore).every(c => c[0].endsWith('/info'))).toBe(true);
  const write = vi.spyOn(NativeVaultClient.prototype, 'write').mockResolvedValue(record as never);
  fireEvent.click(screen.getByRole('button', { name: 'Save in native vault' }));
  await screen.findByText('Saved in the native vault. Open saved Proof when you choose.');
  expect(write.mock.calls[0][3]).toBe(file);
});
it('erases a suspended draft after denied revalidation and cannot resume it after reconnect', async () => {
  const { fetcher } = setup(); await connect(); fireEvent.click(screen.getByRole('button', { name: 'Add native Proof' }));
  fireEvent.change(screen.getByLabelText('Exact words or note'), { target: { value: 'Discard after revoke' } });
  act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  fetcher.mockResolvedValue(response({}, 403));
  act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await screen.findByText(/Native connection unavailable or changed/);
  fetcher.mockResolvedValue(response(info)); await connect();
  expect(screen.queryByRole('button', { name: 'Resume draft' })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Discard after revoke')).not.toBeInTheDocument();
});
it('confirms discarding a draft before explicit navigation and warns on browser unload', async () => {
  const { exit } = setup(); await connect(); fireEvent.click(screen.getByRole('button', { name: 'Add native Proof' }));
  fireEvent.change(screen.getByLabelText('Exact words or note'), { target: { value: 'Keep this draft' } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Return to browser gallery' }));
  expect(exit).not.toHaveBeenCalled(); expect(screen.getByDisplayValue('Keep this draft')).toBeInTheDocument();
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Return to browser gallery' }));
  expect(exit).toHaveBeenCalledTimes(1); expect(screen.queryByDisplayValue('Keep this draft')).not.toBeInTheDocument();
});
it('erases a suspended draft when its permission expires while hidden', async () => {
  const { fetcher } = setup();
  fetcher.mockImplementation(async () => response({ ...info, expiresAt: new Date(Date.now() + 200).toISOString() }));
  await connect(); fireEvent.click(screen.getByRole('button', { name: 'Add native Proof' }));
  fireEvent.change(screen.getByLabelText('Exact words or note'), { target: { value: 'Expire this draft' } });
  act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  await screen.findByText('Native permission expired. Create a new connection in the companion.');
  act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  fetcher.mockResolvedValue(response(info)); await connect();
  expect(screen.queryByRole('button', { name: 'Resume draft' })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Expire this draft')).not.toBeInTheDocument();
});
it('explicit disconnect erases a suspended draft without revealing it', async () => {
  setup(); await connect(); fireEvent.click(screen.getByRole('button', { name: 'Add native Proof' }));
  fireEvent.change(screen.getByLabelText('Exact words or note'), { target: { value: 'Erase on disconnect' } });
  act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect native vault' }));
  act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await connect(); expect(screen.queryByRole('button', { name: 'Resume draft' })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Erase on disconnect')).not.toBeInTheDocument();
});
