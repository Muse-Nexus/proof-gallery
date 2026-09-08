import { ProofMark } from "./ProofMark";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PROOF_CATEGORIES, PROOF_SOURCE_TYPES } from '../lib/proof';
import { LOCAL_MEDIA_ACCEPT } from '../lib/media';
import './NativeVaultGallery.css';
import { NativeVaultClient, validNativeFields, NATIVE_ERROR, type NativeFields, type NativeInfo, type NativeList, type NativeRecord, type NativeState } from '../lib/native-vault';

interface AppliedNativeFilters { query: string; category: string; tag: string }
const EMPTY_NATIVE_FILTERS: AppliedNativeFilters = { query: '', category: '', tag: '' };

interface NativeDraft {
  readonly record: NativeRecord | null;
  fields: NativeFields;
  tagsText: string;
  file?: File;
  submissionUncertain?: boolean;
}
function draftFor(record: NativeRecord | null): NativeDraft {
  return { record, fields: record ? { ...record.fields, tags: [...record.fields.tags] } : { title: '', evidenceText: '', sourceType: 'other', tags: [] }, tagsText: record?.fields.tags.join(', ') ?? '' };
}
function NativeEditor({ draft, busy, onChange, onSave, onClose }: { draft: NativeDraft; busy: boolean; onChange: (draft: NativeDraft) => void; onSave: (fields: NativeFields, file?: File) => void; onClose: () => void }) {
  const { record, fields, file } = draft;
  const [error, setError] = useState('');
  const change = (key: keyof NativeFields, value: string) => onChange({ ...draft,
    ...(key === 'tags' ? { tagsText: value } : {}),
    fields: { ...fields, [key]: key === 'tags' ? value.split(',').map(s => s.trim()).filter(Boolean) : value || (['title', 'evidenceText'].includes(key) ? '' : undefined) },
  });
  return <form className="proof-editor" onSubmit={e => { e.preventDefault(); if (!validNativeFields(fields, true) || (!record?.media && !file && !fields.evidenceText.trim())) { setError('Choose a category and add a note or attachment. Check field lengths and dates.'); return; } setError(''); onSave(fields, file); }} aria-label={record?.state === 'pending' ? 'Review native evidence' : 'Edit native evidence'}>
    <h2>{record?.state === 'pending' ? 'Review before saving as Proof' : record ? 'Edit saved Proof' : 'Add to the native vault'}</h2>
    <p>Keep the original words. Unknown dates and details may stay blank. Existing media and source receipts remain attached.</p>
    <label>Title<input value={fields.title} onChange={e => change('title', e.target.value)} maxLength={300} disabled={busy} /></label>
    <label>Exact words or note<textarea value={fields.evidenceText} onChange={e => change('evidenceText', e.target.value)} maxLength={16000} disabled={busy} /></label>
    <label>Category<select required value={fields.category ?? ''} onChange={e => change('category', e.target.value)} disabled={busy}><option value="">Choose a category</option>{PROOF_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
    <label>Occurred date<input type="date" value={fields.occurredOn ?? ''} onChange={e => change('occurredOn', e.target.value)} disabled={busy} /></label>
    <label>Source type<select value={fields.sourceType} onChange={e => change('sourceType', e.target.value)} disabled={busy}>{PROOF_SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
    {(['source', 'person', 'project'] as const).map(key => <label key={key}>{key[0].toUpperCase() + key.slice(1)}<input value={fields[key] ?? ''} onChange={e => change(key, e.target.value)} maxLength={2000} disabled={busy} /></label>)}
    <label>Tags, separated by commas<input value={draft.tagsText} onChange={e => change('tags', e.target.value)} disabled={busy} /></label>
    {!record && <label>Optional photo or clip<input type="file" accept={LOCAL_MEDIA_ACCEPT} onChange={e => onChange({ ...draft, file: e.target.files?.[0] })} disabled={busy} /></label>}
    {file && <p>Selected attachment: {file.name} <button type="button" disabled={busy} onClick={() => onChange({ ...draft, file: undefined })}>Remove selected attachment</button></p>}
    {draft.submissionUncertain && <p role="alert">A save may already have completed before this page was hidden. Check saved Proof before repeating it.</p>}
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{record?.state === 'pending' ? 'Approve and save Proof' : 'Save in native vault'}</button>
    <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
  </form>;
}

export function NativeVaultGallery({ onExit }: { onExit: () => void }) {
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<NativeInfo | null>(null);
  const [result, setResult] = useState<NativeList | null>(null);
  const [state, setState] = useState<NativeState>('saved');
  const [offset, setOffset] = useState(0);
  const [applied, setApplied] = useState<AppliedNativeFilters>(EMPTY_NATIVE_FILTERS);
  const [query, setQuery] = useState(''); const [category, setCategory] = useState(''); const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [hidden, setHidden] = useState(document.hidden);
  const [editor, setEditorState] = useState<NativeDraft | null>(null);
  const editorRef = useRef<NativeDraft | null>(null);
  const [draftSuspended, setDraftSuspended] = useState(false);
  function setEditor(next: NativeDraft | null) { editorRef.current = next; setEditorState(next); }
  const [urls, setUrls] = useState<Record<string, string>>({});
  const client = useRef<NativeVaultClient | null>(null); const epoch = useRef(0);
  const liveURLs = useRef(new Set<string>()); const busyRef = useRef(false);
  function clearEvidence(preserveDraft = false) {
    for (const url of liveURLs.current) URL.revokeObjectURL(url);
    liveURLs.current.clear(); setUrls({}); setResult(null); setApplied(EMPTY_NATIVE_FILTERS);
    if (preserveDraft) setDraftSuspended(Boolean(editorRef.current));
    else { setEditor(null); setDraftSuspended(false); }
  }
  function confirmDiscardDraft() { return !editorRef.current || window.confirm('Discard this unsaved native draft? It is kept only in this page’s memory.'); }
  function disconnect(note = 'Disconnected. The native vault remains on this Mac.') {
    epoch.current++; client.current?.disconnect(); client.current = null;
    clearEvidence(); setInfo(null); setCode(''); setQuery(''); setCategory(''); setTag('');
    busyRef.current = false; setBusy(false); setMessage(note);
  }
  useEffect(() => {
    const visibility = () => {
      epoch.current++; client.current?.cancel(); clearEvidence(true); setCode(''); setQuery(''); setCategory(''); setTag('');
      busyRef.current = false; setBusy(false); setHidden(document.hidden);
      if (document.hidden) { setMessage('Evidence hidden. An unsaved draft, if any, stays only in memory.'); return; }
      const current = client.current, currentEpoch = epoch.current;
      if (current) {
        busyRef.current = true; setBusy(true);
        void current.info().then(next => {
          if (client.current === current && epoch.current === currentEpoch) { setInfo(next); setMessage('Permission checked. Choose saved Proof or pending review to continue.'); }
        }).catch(() => { if (epoch.current === currentEpoch) disconnect(NATIVE_ERROR); }).finally(() => {
          if (epoch.current === currentEpoch) { busyRef.current = false; setBusy(false); }
        });
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (editorRef.current) { event.preventDefault(); event.returnValue = ''; } };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('beforeunload', beforeUnload);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('beforeunload', beforeUnload); epoch.current++; client.current?.disconnect(); editorRef.current = null; for (const url of liveURLs.current) URL.revokeObjectURL(url); liveURLs.current.clear(); };
  }, []);
  useEffect(() => {
    if (!info) return;
    const timeout = window.setTimeout(() => disconnect('Native permission expired. Create a new connection in the companion.'), Math.max(0, Math.min(2_147_483_647, Date.parse(info.expiresAt) - Date.now())));
    return () => window.clearTimeout(timeout);
  }, [info]);
  // Quiet auth-only revalidation bounds revocation while evidence is visible. Never fetch evidence here.
  useEffect(() => {
    if (!info || hidden) return;
    const timer = window.setInterval(() => {
      const current = client.current, currentEpoch = epoch.current;
      if (!current || busyRef.current) return;
      void current.info().then(next => { if (epoch.current === currentEpoch) setInfo(next); }).catch(() => { if (epoch.current === currentEpoch) disconnect(NATIVE_ERROR); });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [info, hidden]);
  async function connect(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || document.hidden) return;
    busyRef.current = true; setBusy(true); setMessage('');
    const entered = code; setCode(''); const currentEpoch = ++epoch.current;
    try {
      const next = new NativeVaultClient(entered); client.current = next;
      const receipt = await next.info();
      if (epoch.current !== currentEpoch) return;
      setInfo(receipt); setMessage('Connected to a separate native collection. Choose what to open.');
    } catch { if (epoch.current === currentEpoch) disconnect(NATIVE_ERROR); }
    finally { if (epoch.current === currentEpoch) { busyRef.current = false; setBusy(false); } }
  }
  async function run(operation: (c: NativeVaultClient) => Promise<void>) {
    const current = client.current; if (!current || busyRef.current || document.hidden) return;
    busyRef.current = true; setBusy(true); setMessage(''); const currentEpoch = epoch.current;
    try { await current.info(); if (epoch.current === currentEpoch) await operation(current); }
    catch { if (epoch.current === currentEpoch) disconnect(NATIVE_ERROR); }
    finally { if (epoch.current === currentEpoch) { busyRef.current = false; setBusy(false); } }
  }
  function load(nextState: NativeState, nextOffset = 0, filters?: AppliedNativeFilters) {
    if (!confirmDiscardDraft()) return;
    const selected = filters ?? { query: nextState === 'saved' ? query.trim() : '', category, tag: tag.trim() };
    const currentEpoch = epoch.current;
    void run(async c => {
      clearEvidence(); const list = await c.list(nextState, nextOffset, selected.query, selected.category, selected.tag);
      if (epoch.current !== currentEpoch) return;
      setState(nextState); setOffset(nextOffset); setApplied(selected); setResult(list);
    });
  }
  function save(fields: NativeFields, file?: File) {
    const selected = editor?.record, currentEpoch = epoch.current;
    void run(async c => {
      if (editorRef.current) setEditor({ ...editorRef.current, submissionUncertain: true });
      await c.write(selected ? selected.state === 'pending' ? 'approve' : 'edit' : 'create', fields, selected ?? undefined, file);
      if (epoch.current !== currentEpoch) return;
      clearEvidence(); setMessage('Saved in the native vault. Open saved Proof when you choose.');
    });
  }
  function preview(record: NativeRecord) {
    const currentEpoch = epoch.current;
    void run(async c => {
      const blob = await c.media(record); if (epoch.current !== currentEpoch) return;
      const url = URL.createObjectURL(blob); liveURLs.current.add(url); setUrls(old => ({ ...old, [record.id]: url }));
    });
  }
  return <main className="app-shell native-vault">
    <header className="native-header">
      <span className="gallery-eyebrow"><ProofMark />Proof Gallery · on this Mac</span><span className="privacy-badge">Same Mac · private connection</span><h1>Native vault on this Mac</h1><p>A separate collection kept by the companion. This connection does not import or merge your browser collection.</p>
      <div className="native-actions"><button onClick={() => { if (confirmDiscardDraft()) { disconnect(); onExit(); } }}>Return to browser gallery</button>
      {info && <button onClick={() => disconnect()}>Disconnect native vault</button>}</div>
    </header>
    <p className="native-privacy">Native storage is local to this OS account and is not encrypted by Proof. Browser backups do not include it. Hiding this page hides evidence and keeps your unsaved draft only in memory. Returning requires permission and an explicit resume. Leaving discards the draft.</p>
    {message && <p className="native-status" role="status">{message}</p>}
    {!info && !hidden && <form className="native-connect" onSubmit={connect} autoComplete="off">
      <label>Native gallery connection code<input type="password" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" spellCheck={false} maxLength={110} disabled={busy} /></label>
      <p>Create a gallery permission in the native companion, then paste its code here. The code lasts only in this page’s memory. Do not paste an assistant token.</p>
      <button type="submit" disabled={busy || !code.trim()}>Connect native vault</button>
    </form>}
    {info && !hidden && <>
      <details className="native-connection-details"><summary>Connection details</summary><p>Collection: {info.collectionID}<br />Permission expires {info.expiresAt}</p></details>
      <nav className="native-collection-nav" aria-label="Native collection"><button disabled={busy} onClick={() => load('saved')}>Open saved Proof</button><button disabled={busy} onClick={() => load('pending')}>Open pending review</button><button disabled={busy} onClick={() => { if (confirmDiscardDraft()) { clearEvidence(); setEditor(draftFor(null)); } }}>Add native Proof</button></nav>
      <form className="native-filter-bar" onSubmit={e => { e.preventDefault(); load('saved'); }}>
        <label>Search saved native Proof<input value={query} onChange={e => setQuery(e.target.value)} disabled={busy} /></label>
        <label>Category filter<select value={category} onChange={e => setCategory(e.target.value)} disabled={busy}><option value="">All categories</option>{PROOF_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
        <label>Tag filter<input value={tag} onChange={e => setTag(e.target.value)} disabled={busy} maxLength={100} /></label>
        <button disabled={busy}>Search saved Proof</button>
      </form>
      {editor && draftSuspended && <p>A draft is available in this page’s memory. <button disabled={busy} onClick={() => { const currentEpoch = epoch.current; void run(async () => { if (epoch.current === currentEpoch) setDraftSuspended(false); }); }}>Resume draft</button></p>}
      {editor && !draftSuspended && <NativeEditor key={editor.record?.revision ?? 'new'} draft={editor} onChange={setEditor} busy={busy} onSave={save} onClose={() => { if (confirmDiscardDraft()) setEditor(null); }} />}
      {result && <section className="native-results" aria-label={state === 'pending' ? 'Native pending review' : 'Native saved Proof'}>
        <h2>{state === 'pending' ? 'Pending review — not saved Proof' : 'Saved Proof'}</h2>
        <p className="native-result-detail">{result.matching === 'local-semantic' ? 'On-device meaning matching' : result.matching === 'local-literal-text' ? 'Literal text matching (local fallback)' : 'Newest added first'}{result.searchScope ? ` · ${result.searchScope}` : ''}{result.searchedCount !== undefined ? ` · ${result.searchedCount} records searched` : ''}</p>
        <p className="native-result-detail">Applied category: {PROOF_CATEGORIES.find(c => c.value === applied.category)?.label ?? 'All categories'} · Applied tag: {applied.tag || 'All tags'}. Form changes apply only when you open or search a view.</p>
        {applied.query && state === 'saved' && <>
          <p>Search considers up to the newest 100 saved records matching these filters and does not have additional result pages.{result.hasMore ? ' More filtered records exist outside this search window.' : ''}</p>
          <button disabled={busy} onClick={() => { setQuery(''); setCategory(applied.category); setTag(applied.tag); load('saved', 0, { ...applied, query: '' }); }}>Browse all filtered saved Proof</button>
        </>}
        {!result.items.length && <p>No items match this view.</p>}
        <div className="native-card-grid">{result.items.map(record => <article className="proof-card native-card" key={record.id}>
          <div className="native-media">
          {urls[record.id] && (record.media?.mimeType.startsWith('video/') ? <video src={urls[record.id]} controls playsInline preload="metadata" aria-label={record.state === 'pending' ? 'Pending candidate attachment' : 'Saved evidence attachment'} /> : <img src={urls[record.id]} alt={record.state === 'pending' ? 'Pending candidate attachment' : 'Saved evidence attachment'} referrerPolicy="no-referrer" />)}
          </div>
          <h3>{record.fields.title || (state === 'pending' ? 'Untitled candidate' : 'Untitled saved item')}</h3>
          <blockquote>{record.fields.evidenceText}</blockquote>
          <dl className="native-receipt"><div><dt>Occurred</dt><dd>{record.fields.occurredOn ?? 'Unknown'}</dd></div><div><dt>Source</dt><dd>{record.fields.source ?? 'Unknown'}</dd></div></dl>
          <p className="native-category">{PROOF_CATEGORIES.find(c => c.value === record.fields.category)?.label ?? 'Category not chosen'}{record.fields.tags.length ? ` · ${record.fields.tags.join(', ')}` : ''}</p>
          {record.receipt && <p className="native-source-detail">{record.receipt.representation === 'jpeg-preview' ? 'JPEG preview; original remains in Photos.' : 'Original media bytes.'} Source: {record.receipt.scope}. Original filename: {record.receipt.originalFilename}. Capture date: {record.receipt.captureDate ?? 'Unknown'}.</p>}
          {record.approval && <p className="native-source-detail">{record.approval.method === 'trusted-source' ? 'Saved under exact-source approval' : 'Saved by owner review'} · {record.approval.approvedAt}</p>}
          {record.media && !urls[record.id] && <button disabled={busy} onClick={() => preview(record)}>Open attachment</button>}
          <details className="native-provenance"><summary>Original source receipt and provenance</summary><p>Source type: {record.fields.sourceType}{record.fields.person ? ` · Person: ${record.fields.person}` : ''}{record.fields.project ? ` · Project: ${record.fields.project}` : ''}</p><pre>{JSON.stringify({ receipt: record.receipt, provenance: record.provenance, media: record.media, restoreReceipt: record.restoreReceipt }, null, 2)}</pre></details>
          <div className="native-card-actions"><button disabled={busy} onClick={() => { if (confirmDiscardDraft()) setEditor(draftFor(record)); }}>{record.state === 'pending' ? 'Review candidate' : 'Edit Proof'}</button>
          <button className="native-danger" disabled={busy} onClick={() => {
            if (!window.confirm(record.state === 'pending' ? 'Remove this pending candidate from the native vault?' : 'Delete this saved item from the native vault? Original source files remain.')) return;
            if (!confirmDiscardDraft()) return;
            const currentEpoch = epoch.current;
            void run(async c => { await c.delete(record); if (epoch.current === currentEpoch) { clearEvidence(); setMessage('Removed from the native vault.'); } });
          }}>{record.state === 'pending' ? 'Remove candidate' : 'Delete Proof'}</button></div>
        </article>)}</div>
        {result.matching === 'newest' && !applied.query && <div className="native-pagination">
          <button disabled={busy || offset === 0} onClick={() => load(state, Math.max(0, offset - 30), applied)}>Previous page</button>
          <button disabled={busy || !result.hasMore || offset >= 9970} onClick={() => load(state, offset + 30, applied)}>Next page</button>
        </div>}
      </section>}
    </>}
  </main>;
}
