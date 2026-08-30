import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthPanel } from "./components/AuthPanel";
import { DecorativeVisual } from "./components/DecorativeVisual";
import { ProofCard } from "./components/ProofCard";
import { ProofEditor } from "./components/ProofEditor";
import { MediaInbox } from "./components/MediaInbox";
import {
  createProofItem,
  deleteProofItem,
  listProofItems,
  searchProofItems,
  updateProofItem,
} from "./lib/proof-api";
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
} from "./lib/local-proof-store";
import {
  EMPTY_PROOF_FILTERS,
  PROOF_CATEGORIES,
  PROOF_CONSTITUTION,
  normalizeTags,
  sortProofItems,
  type ProofFilters,
  type ProofItem,
  type ProofItemInput,
} from "./lib/proof";
import { getSupabase, isConfigured } from "./lib/supabase";

type StorageMode = "local" | "hosted";

const STORAGE_MODE_KEY = "proof-gallery-storage-mode";

function initialStorageMode(): StorageMode | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_MODE_KEY);
    if (saved === "local") return "local";
    if (saved === "hosted" && isConfigured) return "hosted";
  } catch {
    // Fall through to an explicit local choice or configured hosted mode.
  }
  return null;
}

function downloadBackup(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `proof-gallery-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function LocalStart({
  onUseLocal,
  onUseHosted,
}: {
  onUseLocal: () => void;
  onUseHosted?: () => void;
}) {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Primary navigation">
        <a className="landing-brand" href="#top" aria-label="Proof Gallery home">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>Proof Gallery</span>
        </a>
        <div className="landing-nav-actions">
          <span className="open-source-pill">Free + open source</span>
          <a
            className="text-link"
            href="https://github.com/Muse-Nexus/proof-gallery"
            target="_blank"
            rel="noreferrer"
          >
            View the code
          </a>
        </div>
      </nav>

      <section className="landing-hero" id="top" aria-labelledby="local-start-heading">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow">Loved. Valued. Connected. Accomplished.</span>
          <h1 id="local-start-heading">
            Evidence that you matter.
          </h1>
          <p className="landing-lede">
            Messages of care. Times you were chosen. Moments of connection.
            Things you made happen. Keep the real words and photos, with their
            dates and sources, for when they are hard to remember.
          </p>
          <p className="landing-constitution">
            Proof does not cancel pain. It only restores evidence you chose to
            save.
          </p>
          <div className="landing-cta-row">
            <button
              className="primary-button landing-primary"
              type="button"
              aria-describedby="local-storage-disclosure"
              onClick={onUseLocal}
            >
              Start in this browser
            </button>
            <a className="secondary-link" href="#how-it-works">
              See how it works
            </a>
          </div>
          <p id="local-storage-disclosure" className="local-start-disclosure">
            Stored in this browser profile. Not synced or encrypted by Proof
            Gallery. Clearing site data can erase it; export a private backup.
          </p>
          <p className="landing-fine-print">
            No account. No app analytics or session replay. Nothing collected automatically.
          </p>
          {onUseHosted && (
            <button className="text-button landing-hosted-button" type="button" onClick={onUseHosted}>
              Or use a hosted account
            </button>
          )}
        </div>

        <DecorativeVisual
          className="landing-hero-visual"
          kind="ai"
          src="/visuals/evidence-desk-ai.webp"
        />
      </section>

      <section
        className="landing-visual-boundary"
        aria-labelledby="visual-boundary-heading"
      >
        <DecorativeVisual
          className="landing-collage-visual"
          kind="unsplash"
          src="/visuals/paper-collage-unsplash.webp"
        />
        <div className="visual-boundary-copy">
          <span className="landing-eyebrow">Image forward, truth intact</span>
          <h2 id="visual-boundary-heading">
            Warm visuals can set the tone. They cannot fill in your history.
          </h2>
          <p>
            Stock and AI art appear only as clearly labeled decoration. Inside
            your gallery, every image is an evidence attachment you chose.
            Text-only Proof stays text-only.
          </p>
          <div className="visual-truth-receipt" aria-label="Visual truth boundary">
            <div>
              <span>Evidence attachment</span>
              <strong>Your image · stored with the item</strong>
            </div>
            <div>
              <span>Decorative visual</span>
              <strong>Public-page atmosphere · never item data</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section" id="how-it-works" aria-labelledby="how-heading">
        <div className="section-heading">
          <span>How it works</span>
          <h2 id="how-heading">Concrete, source-faithful, and yours.</h2>
        </div>
        <ol className="landing-steps">
          <li>
            <span className="step-number">01</span>
            <h3>Bring photos in a batch</h3>
            <p>Choose photos, screenshots, or short clips on Mac, Android, or PC. They arrive in review, not straight into your gallery.</p>
          </li>
          <li>
            <span className="step-number">02</span>
            <h3>Keep what belongs</h3>
            <p>Review together, choose a category, and save selected. The original file stays attached. Notes and unknown dates can stay blank.</p>
          </li>
          <li>
            <span className="step-number">03</span>
            <h3>Ask only when you want it</h3>
            <p>Look for care, belonging, or accomplishment. Results come only from your saved evidence—not invented reassurance.</p>
          </li>
        </ol>
      </section>

      <section className="landing-privacy" aria-labelledby="privacy-heading">
        <div>
          <span className="privacy-badge">Browser-local by default</span>
          <h2 id="privacy-heading">A small tool with honest boundaries.</h2>
        </div>
        <div className="privacy-points">
          <p><strong>Local means local.</strong> Saving and searching do not call a server in browser-local mode.</p>
          <p><strong>Permission comes first.</strong> Only sources you choose. Nothing silently searches your accounts or photo library.</p>
          <p><strong>Backups are your safety net.</strong> They are portable plaintext, so keep them somewhere private.</p>
        </div>
      </section>

      <section className="landing-open-source" aria-labelledby="open-source-heading">
        <figure>
          <img
            src="/og-purpose.png"
            alt="Proof Gallery — Evidence that you matter. Decorative paper frames, not saved Proof."
            width="1731"
            height="909"
            loading="lazy"
            decoding="async"
          />
          <figcaption>AI-generated decorative art · not saved Proof</figcaption>
        </figure>
        <div className="open-source-copy">
          <span className="landing-eyebrow">Free + open source</span>
          <h2 id="open-source-heading">Public code. Your evidence is not.</h2>
          <p>
            Read it, run it locally, self-host it, or help make it better. Your
            saved Proof never belongs in the public repository.
          </p>
          <div className="open-source-links" aria-label="Project links">
            <a href="https://github.com/Muse-Nexus/proof-gallery" target="_blank" rel="noreferrer">Source code</a>
            <a href="https://github.com/Muse-Nexus/proof-gallery/blob/main/docs/PRIVACY.md" target="_blank" rel="noreferrer">Privacy model</a>
            <a href="https://github.com/Muse-Nexus/proof-gallery/blob/main/docs/SAFETY.md" target="_blank" rel="noreferrer">Safety constitution</a>
            <a href="https://github.com/Muse-Nexus/proof-gallery/security" target="_blank" rel="noreferrer">Security</a>
          </div>
        </div>
      </section>

      <section className="landing-final-cta" aria-labelledby="final-cta-heading">
        <span aria-hidden="true">✦</span>
        <h2 id="final-cta-heading">Start with one real thing.</h2>
        <p>A kind message. A moment together. Someone choosing you. Keep the evidence and let it remain exactly what it is.</p>
        <button className="primary-button landing-primary" type="button" onClick={onUseLocal}>
          Open my local gallery
        </button>
      </section>

      <footer className="landing-footer">
        <p>Free and open source under the MIT License.</p>
        <p>Never use Proof to invalidate pain, create guilt, demand optimism, rank worth, or invent emotional meaning.</p>
      </footer>
    </main>
  );
}

function Gallery({
  ownerId,
  storageMode,
  onVisitLanding,
  onSwitchMode,
  onSignOut,
}: {
  ownerId: string;
  storageMode: StorageMode;
  onVisitLanding: () => void;
  onSwitchMode?: () => void;
  onSignOut?: () => void;
}) {
  const isLocal = storageMode === "local";
  const [items, setItems] = useState<ProofItem[]>([]);
  const [searchResults, setSearchResults] = useState<ProofItem[] | null>(null);
  const [filters, setFilters] = useState<ProofFilters>(EMPTY_PROOF_FILTERS);
  const [query, setQuery] = useState("");
  const [semanticDegraded, setSemanticDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<ProofItem | "new" | null>(null);
  const [showMediaInbox, setShowMediaInbox] = useState(false);
  const [mediaDirty, setMediaDirty] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(
        isLocal ? await listLocalProofItems() : await listProofItems(),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Proof could not be loaded");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    if (!isLocal) return;

    const unsubscribe = subscribeToLocalProofChanges((kind) => {
      releaseLocalProofImageUrls();
      setSearchResults(null);
      setSemanticDegraded(false);
      if (kind === "clear") {
        setEditor(null);
        setFilters(EMPTY_PROOF_FILTERS);
        setNotice("Local Proof was removed in another open tab.");
      }
      void reload();
    });

    return () => {
      unsubscribe();
      releaseLocalProofImageUrls();
    };
  }, [ownerId, isLocal]);

  useEffect(() => {
    setSearchResults(null);
    setSemanticDegraded(false);
  }, [filters.category, filters.tag]);

  const tags = useMemo(
    () => normalizeTags(items.flatMap((item) => item.tags)).sort(),
    [items],
  );
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (!filters.category || item.category === filters.category) &&
          (!filters.tag || item.tags.includes(filters.tag)),
      ),
    [items, filters],
  );
  const visible = sortProofItems(
    searchResults ?? filtered,
    searchResults ? "relevance" : "newest",
  );
  const hasFilters = Boolean(filters.category || filters.tag);
  const hasSearch = searchResults !== null;
  const isNarrowed = hasFilters || hasSearch;

  function clearSearch() {
    setSearchResults(null);
    setQuery("");
    setSemanticDegraded(false);
  }

  function clearFilters() {
    setFilters(EMPTY_PROOF_FILTERS);
    setSearchResults(null);
    setSemanticDegraded(false);
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = isLocal
        ? await searchLocalProofItems(query, filters)
        : await searchProofItems(query, filters);
      setSearchResults(result.items);
      setSemanticDegraded(result.semanticDegraded);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEditor(result: {
    input: ProofItemInput;
    image: File | null;
    removeExistingImage: boolean;
  }) {
    setBusy(true);
    setNotice(null);
    try {
      const saved =
        editor === "new"
          ? isLocal
            ? await createLocalProofItem(result.input, result.image)
            : await createProofItem(result.input, result.image)
          : isLocal
            ? await updateLocalProofItem(
                editor as ProofItem,
                result.input,
                result.image,
                result.removeExistingImage,
              )
            : await updateProofItem(
                editor as ProofItem,
                result.input,
                result.image,
                result.removeExistingImage,
              );
      setEditor(null);
      setSearchResults(null);
      if (isLocal) {
        const persistence = await requestLocalProofPersistence();
        setNotice(
          persistence === true
            ? "Proof saved in this browser profile. Download a backup for recovery."
            : "Proof saved locally, but browser persistence is not guaranteed. Download a backup now.",
        );
      } else {
        setNotice(
          saved.semanticReady
            ? "Proof saved privately and indexed."
            : "Proof saved privately. Semantic indexing is unavailable; lexical search still works.",
        );
      }
      if ("cleanupFailed" in saved && saved.cleanupFailed) {
        setNotice(
          "Proof saved, but an old private image could not be removed. See the recovery guide.",
        );
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: ProofItem) {
    if (!window.confirm("Delete this Proof item? This cannot be undone.")) return;
    setBusy(true);
    setError(null);
    try {
      const result = isLocal
        ? await deleteLocalProofItem(item)
        : await deleteProofItem(item);
      setSearchResults(null);
      setNotice(
        result.cleanupFailed
          ? "Proof deleted, but its private image could not be removed. See the recovery guide."
          : "Proof deleted.",
      );
      await reload();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function backUpLocalData() {
    setBusy(true);
    setError(null);
    try {
      downloadBackup(await exportLocalProofBackup());
      setNotice(
        "Unencrypted backup prepared for download. Store it somewhere private, such as a local folder, private Drive, or private Dropbox.",
      );
    } catch (backupError) {
      setError(
        backupError instanceof Error
          ? backupError.message
          : "Local backup could not be created",
      );
    } finally {
      setBusy(false);
    }
  }

  async function restoreLocalData(event: ChangeEvent<HTMLInputElement>) {
    const backup = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!backup) return;
    if (
      !window.confirm(
        "Import this Proof Gallery backup? Nothing will be written unless the entire file passes validation.",
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await importLocalProofBackup(backup);
      const persistence = await requestLocalProofPersistence();
      setSearchResults(null);
      setNotice(
        persistence
          ? `${result.imported} Proof ${result.imported === 1 ? "item" : "items"} restored locally. Keep the backup somewhere private for recovery.`
          : `${result.imported} Proof ${result.imported === 1 ? "item" : "items"} restored locally, but browser persistence is not guaranteed. Keep the backup somewhere private.`,
      );
      await reload();
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "The local backup could not be imported",
      );
    } finally {
      setBusy(false);
    }
  }

  async function clearLocalData() {
    const imageCount = items.filter((item) => item.imagePath).length;
    if (
      !window.confirm(
        `Remove all ${items.length} saved Proof ${items.length === 1 ? "item" : "items"} and ${imageCount} attachments from this browser profile? Download a backup first. This cannot be undone. Pending review items, downloaded backups, and original files are not removed.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await clearLocalProofItems();
      setSearchResults(null);
      setNotice("All locally stored Proof items were deleted from this browser profile.");
      await reload();
    } catch (clearError) {
      setError(
        clearError instanceof Error
          ? clearError.message
          : "Local Proof data could not be cleared",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <span className="privacy-badge">
            {isLocal
              ? "Local · not synced · not encrypted"
              : "Private · only you"}
          </span>
          <h1>Proof Gallery</h1>
          <p className="gallery-purpose">Loved. Valued. Connected. Accomplished. The real evidence, here when you need it.</p>
          <p>{PROOF_CONSTITUTION}</p>
        </div>
        <div className="header-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditor("new")}
            disabled={busy}
          >
            Add Proof
          </button>
          {isLocal ? (
            <>
              <button className="secondary-button" disabled={busy} onClick={() => setShowMediaInbox(true)}>Photos & media</button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void backUpLocalData()}
                disabled={busy}
              >
                Back up
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => importInput.current?.click()}
                disabled={busy}
              >
                Restore
              </button>
              <input
                ref={importInput}
                className="visually-hidden"
              type="file"
              accept="application/json,.json"
              aria-label="Restore Proof Gallery backup"
              onChange={(event) => void restoreLocalData(event)}
                tabIndex={-1}
              />
              <button
                className="danger-button"
                type="button"
                onClick={() => void clearLocalData()}
                disabled={busy}
              >
                Remove all saved local Proof
              </button>
              {onSwitchMode && (
                <button
                  className="text-button"
                  type="button"
                  onClick={onSwitchMode}
                  disabled={busy || mediaDirty}
                >
                  Use hosted account
                </button>
              )}
            </>
          ) : (
            <>
              {onSwitchMode && (
                <button
                  className="text-button"
                  type="button"
                  onClick={onSwitchMode}
                >
                  Use this browser
                </button>
              )}
              <button className="text-button" type="button" onClick={onSignOut}>
                Sign out
              </button>
            </>
          )}
          <button className="text-button" type="button" onClick={onVisitLanding} disabled={busy || mediaDirty}>
            About
          </button>
        </div>
      </header>

      {isLocal && (
        <section className="local-boundary" aria-label="Local storage boundary">
          <strong>Local to this browser profile.</strong>
          <span>
            Not synced or encrypted by Proof Gallery. Clearing site data, using
            private browsing, or losing this profile can erase it. Backups are
            portable plaintext—keep them somewhere private.
          </span>
        </section>
      )}

      {isLocal && showMediaInbox && <MediaInbox busy={busy} onBusyChange={setBusy} onDirtyStateChange={setMediaDirty} onClose={() => setShowMediaInbox(false)} onSaved={async () => { clearSearch(); await reload(); }} />}

      <section className="search-panel" aria-labelledby="search-title">
        <div>
          <h2 id="search-title">What do you need proof of right now?</h2>
          <p>
            Search is user-initiated and restricted to this {isLocal ? "local Proof" : "private"} collection.
          </p>
        </div>
        <form className="search-form" onSubmit={runSearch}>
          <input
            type="search"
            aria-label="Search your Proof"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchResults(null);
              setSemanticDegraded(false);
            }}
            placeholder="Show me times people valued my work…"
            minLength={3}
            maxLength={2000}
            required
            disabled={busy}
          />
          <button className="primary-button" disabled={busy}>Search Proof</button>
          {(hasSearch || query) && (
            <button
              type="button"
              className="secondary-button"
              onClick={clearSearch}
              disabled={busy}
            >
              Clear search
            </button>
          )}
        </form>
        {searchResults && isLocal && (
          <p className="search-receipt">
            Showing deterministic local lexical matches. No model or provider
            was called.
          </p>
        )}
        {semanticDegraded && !isLocal && (
          <p className="search-receipt">Showing private lexical matches; semantic embeddings are not configured or temporarily unavailable.</p>
        )}
      </section>

      <section className="filters" aria-label="Proof filters">
        <label>
          Category
          <select
            value={filters.category ?? ""}
            disabled={busy}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                category: (event.target.value || null) as ProofFilters["category"],
              }))
            }
          >
            <option value="">All categories</option>
            {PROOF_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </select>
        </label>
        <label>
          Tag
          <select
            value={filters.tag ?? ""}
            disabled={busy}
            onChange={(event) => setFilters((current) => ({ ...current, tag: event.target.value || null }))}
          >
            <option value="">All tags</option>
            {tags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
          </select>
        </label>
        {hasFilters && (
          <button className="text-button" type="button" onClick={clearFilters} disabled={busy}>
            Clear filters
          </button>
        )}
      </section>

      {!loading && (
        <div className="gallery-summary" role="status">
          <span>
            {hasSearch
              ? `${visible.length} search ${visible.length === 1 ? "result" : "results"}`
              : hasFilters
                ? `${visible.length} of ${items.length} saved Proof ${items.length === 1 ? "item" : "items"}`
                : `${items.length} saved Proof ${items.length === 1 ? "item" : "items"}`}
          </span>
          <span>{hasSearch ? "Sorted by relevance" : "Newest first"}</span>
        </div>
      )}

      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="notice-banner" role="status">{notice}</p>}

      {loading ? (
        <p className="loading-state" role="status">Loading Proof…</p>
      ) : visible.length === 0 ? (
        <section className="empty-state">
          {!isNarrowed && (
            <div className="empty-state-visual">
              <div className="empty-state-frames" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p>Illustration only · not saved Proof</p>
            </div>
          )}
          <h2>
            {hasSearch
              ? "No matching Proof yet"
              : hasFilters
                ? "No Proof matches these filters"
                : isLocal
                  ? "Your local gallery is empty"
                  : "Your private gallery is empty"}
          </h2>
          <p>
            {hasSearch
              ? "Try different literal terms or clear a filter. Results are never padded with ordinary memories."
              : hasFilters
                ? "Try another category or tag, or show all your saved Proof."
                : "A message of care. A photo together. A moment of belonging or accomplishment. Bring the real evidence; you do not have to explain your worth."}
          </p>
          {isNarrowed ? (
            <button className="secondary-button" type="button" disabled={busy} onClick={() => {
              clearSearch();
              clearFilters();
            }}>
              Show all Proof
            </button>
          ) : (
            <button className="primary-button" type="button" disabled={busy} onClick={() => setEditor("new")}>Add the first Proof</button>
          )}
        </section>
      ) : (
        <section className="gallery-grid" aria-label="Saved Proof">
          {visible.map((item) => (
            <ProofCard key={item.id} item={item} disabled={busy} onEdit={setEditor} onDelete={(candidate) => void remove(candidate)} />
          ))}
        </section>
      )}

      <footer className="safety-footer">
        Never use Proof to invalidate pain, create guilt, demand optimism, diagnose, rank worth, or invent emotional meaning.
      </footer>

      {editor && (
        <ProofEditor
          allowLocalMedia={isLocal}
          key={editor === "new" ? "new" : editor.id}
          item={editor === "new" ? null : editor}
          busy={busy}
          privacyLabel={
            isLocal
              ? "Local · not synced · not encrypted"
              : "Private · only you"
          }
          onClose={() => setEditor(null)}
          onSave={saveEditor}
        />
      )}
    </main>
  );
}

export default function App() {
  const [storageMode, setStorageMode] = useState<StorageMode | null>(
    initialStorageMode,
  );
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (storageMode !== "hosted" || !isConfigured) {
      setSession(null);
      setReady(true);
      return;
    }
    setReady(false);
    const client = getSupabase();
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, [storageMode]);

  function chooseStorageMode(nextMode: StorageMode) {
    try {
      window.localStorage.setItem(STORAGE_MODE_KEY, nextMode);
    } catch {
      // The active mode still changes for this session when storage is blocked.
    }
    setStorageMode(nextMode);
  }

  if (storageMode === null || (storageMode === "hosted" && !isConfigured)) {
    return (
      <LocalStart
        onUseLocal={() => chooseStorageMode("local")}
        onUseHosted={
          isConfigured ? () => chooseStorageMode("hosted") : undefined
        }
      />
    );
  }
  if (storageMode === "local") {
    return (
      <Gallery
        key={LOCAL_PROOF_OWNER_ID}
        ownerId={LOCAL_PROOF_OWNER_ID}
        storageMode="local"
        onVisitLanding={() => setStorageMode(null)}
        onSwitchMode={
          isConfigured ? () => chooseStorageMode("hosted") : undefined
        }
      />
    );
  }
  if (!ready) return <p className="loading-state">Opening Proof Gallery…</p>;
  if (!session?.user) {
    return <AuthPanel onUseLocal={() => chooseStorageMode("local")} />;
  }
  return (
    <Gallery
      key={session.user.id}
      ownerId={session.user.id}
      storageMode="hosted"
      onVisitLanding={() => setStorageMode(null)}
      onSwitchMode={() => chooseStorageMode("local")}
      onSignOut={() => void getSupabase().auth.signOut()}
    />
  );
}
