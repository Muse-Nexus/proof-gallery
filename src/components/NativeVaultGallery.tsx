import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PROOF_CATEGORIES, PROOF_SOURCE_TYPES } from '../lib/proof';
import { LOCAL_MEDIA_ACCEPT } from '../lib/media';
import './NativeVaultGallery.css';
import { NativeVaultClient, validNativeFields, NATIVE_ERROR, type NativeFields, type NativeInfo, type NativeList, type NativeRecord, type NativeState } from '../lib/native-vault';

function NativeEditor({ record, busy, onSave, onClose }: { record: NativeRecord | null; busy: boolean; onSave: (fields: NativeFields, file?: File) => void; onClose: () => void }) {
  const [fields, setFields] = useState<NativeFields>(record?.fields ?? { title: '', evidenceText: '', sourceType: 'other', tags: [] });
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const change = (key: keyof NativeFields, value: string) => setFields(old => ({ ...old, [key]: key === 'tags' ? value.split(',').map(s => s.trim()).filter(Boolean) : value || (['title', 'evidenceText'].includes(key) ? '' : undefined) }));
  return <form className="proof-editor" onSubmit={e => { e.preventDefault(); if (!validNativeFields(fields, true) || (!record?.media && !file && !fields.evidenceText.trim())) { setError('Choose a category and add a note or attachment. Check field lengths and dates.'); return; } setError(''); onSave(fields, file); }} aria-label={record?.state === 'pending' ? 'Review native evidence' : 'Edit native evidence'}>
    <h2>{record?.state === 'pending' ? 'Review before saving as Proof' : record ? 'Edit saved Proof' : 'Add to the native vault'}</h2>
    <p>Keep the original words. Unknown dates and details may stay blank. Existing media and source receipts remain attached.</p>
    <label>Title<input value={fields.title} onChange={e => change('title', e.target.value)} maxLength={300} disabled={busy} /></label>
    <label>Exact words or note<textarea value={fields.evidenceText} onChange={e => change('evidenceText', e.target.value)} maxLength={16000} disabled={busy} /></label>
    <label>Category<select required value={fields.category ?? ''} onChange={e => change('category', e.target.value)} disabled={busy}><option value="">Choose a category</option>{PROOF_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
    <label>Occurred date<input type="date" value={fields.occurredOn ?? ''} onChange={e => change('occurredOn', e.target.value)} disabled={busy} /></label>
    <label>Source type<select value={fields.sourceType} onChange={e => change('sourceType', e.target.value)} disabled={busy}>{PROOF_SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
    {(['source', 'person', 'project'] as const).map(key => <label key={key}>{key[0].toUpperCase() + key.slice(1)}<input value={fields[key] ?? ''} onChange={e => change(key, e.target.value)} maxLength={2000} disabled={busy} /></label>)}
    <label>Tags, separated by commas<input defaultValue={fields.tags.join(', ')} onChange={e => change('tags', e.target.value)} disabled={busy} /></label>
    {!record && <label>Optional photo or clip<input type="file" accept={LOCAL_MEDIA_ACCEPT} onChange={e => setFile(e.target.files?.[0])} disabled={busy} /></label>}
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
  const [query, setQuery] = useState(''); const [category, setCategory] = useState(''); const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [hidden, setHidden] = useState(document.hidden);
  const [editor, setEditor] = useState<{ record: NativeRecord | null } | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const client = useRef<NativeVaultClient | null>(null); const epoch = useRef(0);
  const liveURLs = useRef(new Set<string>()); const busyRef = useRef(false);
  function clearEvidence() {
    for (const url of liveURLs.current) URL.revokeObjectURL(url);
    liveURLs.current.clear(); setUrls({}); setResult(null); setEditor(null);
  }
  function disconnect(note = 'Disconnected. The native vault remains on this Mac.') {
    epoch.current++; client.current?.disconnect(); client.current = null;
    clearEvidence(); setInfo(null); setCode(''); setQuery(''); setCategory(''); setTag('');
    busyRef.current = false; setBusy(false); setMessage(note);
  }
  useEffect(() => {
    const visibility = () => {
      epoch.current++; client.current?.cancel(); clearEvidence(); setCode(''); setQuery(''); setCategory(''); setTag('');
      busyRef.current = false; setBusy(false); setHidden(document.hidden);
      if (document.hidden) { setMessage('Evidence and unsaved edits cleared while this page is hidden.'); return; }
      const current = client.current, currentEpoch = epoch.current;
      if (current) {
        setInfo(null); busyRef.current = true; setBusy(true);
        void current.info().then(next => {
          if (client.current === current && epoch.current === currentEpoch) { setInfo(next); setMessage('Permission checked. Choose saved Proof or pending review to continue.'); }
        }).catch(() => { if (epoch.current === currentEpoch) disconnect(NATIVE_ERROR); }).finally(() => {
          if (epoch.current === currentEpoch) { busyRef.current = false; setBusy(false); }
        });
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); epoch.current++; client.current?.disconnect(); for (const url of liveURLs.current) URL.revokeObjectURL(url); liveURLs.current.clear(); };
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
  function load(nextState: NativeState, nextOffset = 0) {
    const currentEpoch = epoch.current;
    void run(async c => {
      clearEvidence(); const list = await c.list(nextState, nextOffset, nextState === 'saved' ? query : '', category, tag);
      if (epoch.current !== currentEpoch) return;
      setState(nextState); setOffset(nextOffset); setResult(list);
    });
  }
  function save(fields: NativeFields, file?: File) {
    const selected = editor?.record, currentEpoch = epoch.current;
    void run(async c => {
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
    <header><h1>Native vault on this Mac</h1><p>A separate collection kept by the companion. This connection does not import or merge your browser collection.</p>
      <button onClick={() => { disconnect(); onExit(); }}>Return to browser gallery</button>
      {info && <button onClick={() => disconnect()}>Disconnect native vault</button>}
    </header>
    <p>Native storage is local to this OS account and is not encrypted by Proof. Browser backups do not include it. Hide or leave this page to clear displayed evidence and unsaved edits.</p>
    {message && <p role="status">{message}</p>}
    {!info && !hidden && <form onSubmit={connect} autoComplete="off">
      <label>Native gallery connection code<input type="password" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" spellCheck={false} maxLength={110} disabled={busy} /></label>
      <p>Create a gallery permission in the native companion, then paste its code here. The code lasts only in this page’s memory. Do not paste an assistant token.</p>
      <button type="submit" disabled={busy || !code.trim()}>Connect native vault</button>
    </form>}
    {info && !hidden && <>
      <p>Collection: {info.collectionID} · Permission expires {info.expiresAt}</p>
      <nav aria-label="Native collection"><button disabled={busy} onClick={() => load('saved')}>Open saved Proof</button><button disabled={busy} onClick={() => load('pending')}>Open pending review</button><button disabled={busy} onClick={() => { clearEvidence(); setEditor({ record: null }); }}>Add native Proof</button></nav>
      <form onSubmit={e => { e.preventDefault(); load('saved'); }}>
        <label>Search saved native Proof<input value={query} onChange={e => setQuery(e.target.value)} disabled={busy} /></label>
        <label>Category filter<select value={category} onChange={e => setCategory(e.target.value)} disabled={busy}><option value="">All categories</option>{PROOF_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
        <label>Tag filter<input value={tag} onChange={e => setTag(e.target.value)} disabled={busy} maxLength={100} /></label>
        <button disabled={busy}>Search saved Proof</button>
      </form>
      {editor && <NativeEditor key={editor.record?.revision ?? 'new'} record={editor.record} busy={busy} onSave={save} onClose={() => setEditor(null)} />}
      {result && <section aria-label={state === 'pending' ? 'Native pending review' : 'Native saved Proof'}>
        <h2>{state === 'pending' ? 'Pending review — not saved Proof' : 'Saved Proof'}</h2>
        <p>{result.matching === 'local-semantic' ? 'On-device meaning matching' : result.matching === 'local-literal-text' ? 'Literal text matching (local fallback)' : 'Newest added first'}{result.searchScope ? ` · ${result.searchScope}` : ''}{result.searchedCount !== undefined ? ` · ${result.searchedCount} records searched` : ''}</p>
        {query && state === 'saved' && <p>Search considers up to the newest 100 saved records matching these filters. It may return fewer matches; browse without a query to page through the whole collection.</p>}
        {!result.items.length && <p>No items match this view.</p>}
        {result.items.map(record => <article className="proof-card" key={record.id}>
          <h3>{record.fields.title || (state === 'pending' ? 'Untitled candidate' : 'Untitled saved item')}</h3>
          <blockquote>{record.fields.evidenceText}</blockquote>
          <dl><dt>Occurred</dt><dd>{record.fields.occurredOn ?? 'Unknown'}</dd><dt>Source</dt><dd>{record.fields.source ?? 'Unknown'}</dd><dt>Source type</dt><dd>{record.fields.sourceType}</dd><dt>Person</dt><dd>{record.fields.person ?? 'Unknown'}</dd><dt>Project</dt><dd>{record.fields.project ?? 'Unknown'}</dd><dt>Category</dt><dd>{record.fields.category ?? 'Not chosen'}</dd><dt>Tags</dt><dd>{record.fields.tags.join(', ') || 'None'}</dd></dl>
          {record.receipt && <p>{record.receipt.representation === 'jpeg-preview' ? 'JPEG preview; original remains in Photos.' : 'Original media bytes.'} Source: {record.receipt.scope}. Original filename: {record.receipt.originalFilename}. Capture date: {record.receipt.captureDate ?? 'Unknown'}.</p>}
          {record.approval && <p>{record.approval.method === 'trusted-source' ? 'Saved under exact-source approval' : 'Saved by owner review'} · {record.approval.approvedAt}</p>}
          {record.media && !urls[record.id] && <button disabled={busy} onClick={() => preview(record)}>Open attachment</button>}
          {urls[record.id] && (record.media?.mimeType.startsWith('video/') ? <video src={urls[record.id]} controls playsInline preload="metadata" aria-label="Saved evidence attachment" /> : <img src={urls[record.id]} alt="Saved evidence attachment" referrerPolicy="no-referrer" />)}
          <details><summary>Original source receipt and provenance</summary><pre>{JSON.stringify({ receipt: record.receipt, provenance: record.provenance, media: record.media, restoreReceipt: record.restoreReceipt }, null, 2)}</pre></details>
          <button disabled={busy} onClick={() => setEditor({ record })}>{record.state === 'pending' ? 'Review candidate' : 'Edit Proof'}</button>
          <button disabled={busy} onClick={() => {
            if (!window.confirm(record.state === 'pending' ? 'Remove this pending candidate from the native vault?' : 'Delete this saved item from the native vault? Original source files remain.')) return;
            const currentEpoch = epoch.current;
            void run(async c => { await c.delete(record); if (epoch.current === currentEpoch) { clearEvidence(); setMessage('Removed from the native vault.'); } });
          }}>{record.state === 'pending' ? 'Remove candidate' : 'Delete Proof'}</button>
        </article>)}
        <button disabled={busy || offset === 0} onClick={() => load(state, Math.max(0, offset - (query && state === 'saved' ? 10 : 30)))}>Previous page</button>
        <button disabled={busy || !result.hasMore || offset >= 9970} onClick={() => load(state, offset + (query && state === 'saved' ? 10 : 30))}>Next page</button>
      </section>}
    </>}
  </main>;
}
