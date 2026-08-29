import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
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

function ConfigurationRequired() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="privacy-badge">Setup required</span>
        <h1>Proof Gallery</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code>, add your
          Supabase project values, and follow the self-hosting guide.
        </p>
      </section>
    </main>
  );
}

function Gallery({ user }: { user: User }) {
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

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await listProofItems());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Proof could not be loaded");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [user.id]);

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
      const result = await searchProofItems(query, filters);
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
          ? await createProofItem(result.input, result.image)
          : await updateProofItem(
              editor as ProofItem,
              result.input,
              result.image,
              result.removeExistingImage,
            );
      setEditor(null);
      setSearchResults(null);
      setNotice(
        saved.semanticReady
          ? "Proof saved privately and indexed."
          : "Proof saved privately. Semantic indexing is unavailable; lexical search still works.",
      );
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
      const result = await deleteProofItem(item);
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <span className="privacy-badge">Private · only you</span>
          <h1>Proof Gallery</h1>
          <p>{PROOF_CONSTITUTION}</p>
        </div>
        <div className="header-actions">
          <button className="primary-button" type="button" onClick={() => setEditor("new")}>Add Proof</button>
          <button className="text-button" type="button" onClick={() => getSupabase().auth.signOut()}>Sign out</button>
        </div>
      </header>

      <section className="search-panel" aria-labelledby="search-title">
        <div>
          <h2 id="search-title">Restore the evidence you saved</h2>
          <p>Search is user-initiated and restricted to this private collection.</p>
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
        {semanticDegraded && (
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
        <p className="loading-state" role="status">Loading private Proof…</p>
      ) : visible.length === 0 ? (
        <section className="empty-state">
          <h2>{searchResults ? "No matching Proof yet" : "Your private gallery is empty"}</h2>
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
          onClose={() => setEditor(null)}
          onSave={saveEditor}
        />
      )}
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isConfigured) {
      setReady(true);
      return;
    }
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
  }, []);

  if (!isConfigured) return <ConfigurationRequired />;
  if (!ready) return <p className="loading-state">Opening Proof Gallery…</p>;
  if (!session?.user) return <AuthPanel />;
  return <Gallery key={session.user.id} user={session.user} />;
}
