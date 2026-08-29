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
import { ProofCard } from "./components/ProofCard";
import { ProofEditor } from "./components/ProofEditor";
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
  return isConfigured ? "hosted" : null;
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

function LocalStart({ onUseLocal }: { onUseLocal: () => void }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="local-start-heading">
        <span className="privacy-badge">No account required</span>
        <h1 id="local-start-heading">Proof Gallery</h1>
        <p className="lede">
          Keep your evidence on this device and search it without configuring a
          server or connecting an account.
        </p>
        <div className="local-start-warning">
          <strong>Local to this browser profile.</strong>
          <span>
            Not synced or encrypted by Proof Gallery. Browser data can be
            cleared or lost, so download private backups regularly.
          </span>
        </div>
        <button className="primary-button" type="button" onClick={onUseLocal}>
          Use this browser
        </button>
        <p className="small-print">
          Nothing is imported automatically. You choose every item that enters
          the Gallery.
        </p>
      </section>
    </main>
  );
}

function Gallery({
  ownerId,
  storageMode,
  onSwitchMode,
  onSignOut,
}: {
  ownerId: string;
  storageMode: StorageMode;
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

  async function runSearch(event: FormEvent) {
    event.preventDefault();
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
      setSearchResults(null);
      setNotice(
        `${result.imported} Proof ${result.imported === 1 ? "item" : "items"} restored locally.`,
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
        `Remove all ${items.length} Proof ${items.length === 1 ? "item" : "items"} and ${imageCount} ${imageCount === 1 ? "image" : "images"} from this browser profile? Download a backup first. This cannot be undone and will not remove downloaded backups or original files.`,
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
          <p>{PROOF_CONSTITUTION}</p>
        </div>
        <div className="header-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditor("new")}
          >
            Add Proof
          </button>
          {isLocal ? (
            <>
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
                onChange={(event) => void restoreLocalData(event)}
                tabIndex={-1}
              />
              <button
                className="danger-button"
                type="button"
                onClick={() => void clearLocalData()}
                disabled={busy}
              >
                Remove all local Proof
              </button>
              {onSwitchMode && (
                <button
                  className="text-button"
                  type="button"
                  onClick={onSwitchMode}
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

      <section className="search-panel" aria-labelledby="search-title">
        <div>
          <h2 id="search-title">Restore the evidence you saved</h2>
          <p>
            Search is user-initiated and restricted to this {isLocal ? "local Proof" : "private"} collection.
          </p>
        </div>
        <form className="search-form" onSubmit={runSearch}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Show me times people valued my work…"
            minLength={3}
            maxLength={2000}
            required
          />
          <button className="primary-button" disabled={busy}>Search Proof</button>
          {searchResults && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSearchResults(null);
                setQuery("");
                setSemanticDegraded(false);
              }}
            >
              Clear
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
            onChange={(event) => setFilters((current) => ({ ...current, tag: event.target.value || null }))}
          >
            <option value="">All tags</option>
            {tags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
          </select>
        </label>
        <span className="sort-label">{searchResults ? "Sorted by relevance" : "Newest first"}</span>
      </section>

      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="notice-banner" role="status">{notice}</p>}

      {loading ? (
        <p className="loading-state" role="status">Loading Proof…</p>
      ) : visible.length === 0 ? (
        <section className="empty-state">
          <h2>
            {searchResults
              ? "No matching Proof yet"
              : isLocal
                ? "Your local gallery is empty"
                : "Your private gallery is empty"}
          </h2>
          <p>
            {searchResults
              ? "Try different literal terms or clear a filter. Results are never padded with ordinary memories."
              : "Save one concrete message, receipt, photo, finished thing, or memory with its date and source."}
          </p>
          {!searchResults && <button className="primary-button" onClick={() => setEditor("new")}>Add the first Proof</button>}
        </section>
      ) : (
        <section className="gallery-grid" aria-label="Saved Proof">
          {visible.map((item) => (
            <ProofCard key={item.id} item={item} onEdit={setEditor} onDelete={(candidate) => void remove(candidate)} />
          ))}
        </section>
      )}

      <footer className="safety-footer">
        Never use Proof to invalidate pain, create guilt, demand optimism, diagnose, rank worth, or invent emotional meaning.
      </footer>

      {editor && (
        <ProofEditor
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
    return <LocalStart onUseLocal={() => chooseStorageMode("local")} />;
  }
  if (storageMode === "local") {
    return (
      <Gallery
        key={LOCAL_PROOF_OWNER_ID}
        ownerId={LOCAL_PROOF_OWNER_ID}
        storageMode="local"
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
      onSwitchMode={() => chooseStorageMode("local")}
      onSignOut={() => void getSupabase().auth.signOut()}
    />
  );
}
