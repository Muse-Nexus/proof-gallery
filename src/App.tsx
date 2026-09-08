import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { NativeVaultGallery } from "./components/NativeVaultGallery";
import { ProofMark } from "./components/ProofMark";
import { AuthPanel } from "./components/AuthPanel";
import { DecorativeVisual } from "./components/DecorativeVisual";
import { ProofCard } from "./components/ProofCard";
import { ProofEditor } from "./components/ProofEditor";
import { MediaInbox } from "./components/MediaInbox";
import { ProofStory } from "./components/ProofStory";
import { BackupPanel } from "./components/BackupPanel";
import { CompanionPanel } from "./components/CompanionPanel";
import { FolderSource } from "./components/FolderSource";
import { LocalStorageStatus } from "./components/LocalStorageStatus";
import { InstallProof } from "./components/InstallProof";
import { semanticCompanionSearch, type CompanionSession } from "./lib/local-companion";
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
  countLocalProofCandidates,
  deleteLocalProofItem,
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
  type ProofSort,
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

function LocalStart({
  onUseLocal,
  onUseHosted,
  onNative,
}: {
  onUseLocal: () => void;
  onUseHosted?: () => void;
  onNative: () => void;
}) {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Primary navigation">
        <a className="landing-brand" href="#top" aria-label="Proof Gallery home">
          <ProofMark />
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
          <button className="text-button" type="button" onClick={onNative}>Connect native vault</button>
          <p id="local-storage-disclosure" className="local-start-disclosure">
            Stored in this browser profile. Not synced or encrypted by Proof
            Gallery. Clearing site data can erase it; export a private backup.
          </p>
          <p className="landing-fine-print">
            No account needed. Choose what comes in. Keep what feels relevant.
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
          <span className="landing-eyebrow">A photo. A few words. Enough.</span>
          <h2 id="visual-boundary-heading">
            You bring the moment. Start with a short note.
          </h2>
          <p>
            Add a photo, a message, or a few words about what happened. Keep the
            details you know. Later, find it again or read your saved moments
            together as a story, in your own words.
          </p>
          <div className="visual-truth-receipt" role="group" aria-label="Visual truth boundary">
            <div>
              <span>Your gallery</span>
              <strong>Your photos, exact words, dates, and sources</strong>
            </div>
            <div>
              <span>This page</span>
              <strong>Labeled decorative art · never your evidence</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section" id="how-it-works" aria-labelledby="how-heading">
        <div className="section-heading">
          <span>How it works</span>
          <h2 id="how-heading">Less collecting. More finding it again.</h2>
        </div>
        <ol className="landing-steps">
          <li>
            <span className="step-number">01</span>
            <h3>Choose a source</h3>
            <p>Pick photos on your phone or computer. In supported browsers, start checking a chosen folder while the gallery is open. The Mac companion can read a selected Photos source.</p>
          </li>
          <li>
            <span className="step-number">02</span>
            <h3>Keep what belongs</h3>
            <p>Review new media individually, or explicitly trust a chosen folder to save its media automatically. Add a short note whenever you want. A date you do not know can stay blank.</p>
          </li>
          <li>
            <span className="step-number">03</span>
            <h3>Ask only when you want it</h3>
            <p>Find a kind message, a moment together, or something you made happen. Search returns your saved words and photos with their dates and sources.</p>
          </li>
        </ol>
      </section>

      <section className="landing-privacy" aria-labelledby="privacy-heading">
        <div>
          <span className="privacy-badge">Browser-local by default</span>
          <h2 id="privacy-heading">Personal by design.</h2>
        </div>
        <div className="privacy-points">
          <p><strong>Local means local.</strong> Browser saving and text search stay here. Optional meaning matching uses a paired companion on this Mac, not a cloud service.</p>
          <p><strong>Permission comes first.</strong> Only sources you choose. Nothing silently searches your accounts or photo library.</p>
          <p><strong>Keep a recovery copy.</strong> Encrypted backups include saved Proof, pending media, and saved notes. Keep the passphrase safe.</p>
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
          <div className="open-source-links" role="group" aria-label="Project links">
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
  onNative,
  onSwitchMode,
  onSignOut,
}: {
  ownerId: string;
  storageMode: StorageMode;
  onVisitLanding: () => void;
  onNative: () => void;
  onSwitchMode?: () => void;
  onSignOut?: () => void;
}) {
  const isLocal = storageMode === "local";
  const [items, setItems] = useState<ProofItem[]>([]);
  const [searchResults, setSearchResults] = useState<ProofItem[] | null>(null);
  const [filters, setFilters] = useState<ProofFilters>(EMPTY_PROOF_FILTERS);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProofSort>("newest");
  const [semanticDegraded, setSemanticDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<ProofItem | "new" | null>(null);
  const [showMediaInbox, setShowMediaInbox] = useState(false);
  const [mediaDirty, setMediaDirty] = useState(false);
  const [storySeedId, setStorySeedId] = useState<string | null>(null);
  const storySeed = items.find(item => item.id === storySeedId);
  const [backupMode, setBackupMode] = useState<"export" | "restore" | null>(null);
  const [companion, setCompanion] = useState<CompanionSession | null>(null);
  const [showCompanion, setShowCompanion] = useState(false);
  const [useSemantic, setUseSemantic] = useState(false);
  const [view, setView] = useState<"gallery" | "sources">("gallery");
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [storageRevision, setStorageRevision] = useState(0);
  const [automaticChanges, setAutomaticChanges] = useState(false);
  const automaticGeneration = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const toolsDisclosure = useRef<HTMLDetailsElement>(null);
  const currentItems = useRef(items); currentItems.current = items;
  const searchRequest = useRef<AbortController | null>(null);
  useEffect(() => () => searchRequest.current?.abort(), []);
  useEffect(() => {
    searchRequest.current?.abort();
    if (!companion) { setUseSemantic(false); return; }
    const timer = window.setTimeout(() => { setCompanion(null); setUseSemantic(false); }, Math.max(0, companion.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [companion]);

  async function refreshPendingCount() {
    try { setPendingCount(await countLocalProofCandidates()); }
    catch { setPendingCount(null); }
    finally { setStorageRevision(value => value + 1); }
  }

  async function reload() {
    const generation = automaticGeneration.current;
    setLoading(true);
    setError(null);
    try {
      setItems(
        isLocal ? await listLocalProofItems() : await listProofItems(),
      );
      if (generation === automaticGeneration.current) setAutomaticChanges(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Proof could not be loaded");
    } finally {
      setLoading(false);
    }
    if (isLocal) await refreshPendingCount();
  }

  useEffect(() => {
    void reload();
    if (!isLocal) return;

    const unsubscribe = subscribeToLocalProofChanges((kind) => {
      if (kind === "source") return;
      if (kind === "automatic") {
        automaticGeneration.current++;
        setAutomaticChanges(true);
        return;
      }
      if (kind === "pending") {
        void refreshPendingCount();
        return;
      }
      searchRequest.current?.abort();
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
    searchResults ? "relevance" : sort,
  );
  const hasFilters = Boolean(filters.category || filters.tag);
  const hasSearch = searchResults !== null;
  const isNarrowed = hasFilters || hasSearch;
  const editingBlocked = busy || mediaDirty;

  function changeView(next: "gallery" | "sources") {
    if (editingBlocked) return;
    searchRequest.current?.abort();
    setStorySeedId(null);
    setView(next);
    setShowMediaInbox(false);
    if (next === "gallery" && automaticChanges) {
      clearSearch();
      clearFilters();
      setSort("recently_added");
      void reload();
    }
  }

  function showAutomaticProof() {
    if (editingBlocked || editor || backupMode || storySeedId || showMediaInbox) return;
    setView("gallery");
    clearSearch();
    clearFilters();
    setSort("recently_added");
    void reload();
  }

  function openReview() {
    if (editingBlocked) return;
    setStorySeedId(null);
    setView("gallery");
    setBackupMode(null);
    setShowMediaInbox(true);
  }

  function openBackup(mode: "export" | "restore") {
    if (editingBlocked) return;
    setStorySeedId(null);
    setShowMediaInbox(false);
    setBackupMode(mode);
  }

  function openEditor(next: ProofItem | "new") {
    if (editingBlocked) return;
    setStorySeedId(null);
    setEditor(next);
  }

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
    const controller = new AbortController(); searchRequest.current = controller;
    let snapshot = currentItems.current;
    const generation = automaticGeneration.current;
    try {
      // A new request may include auto-saved Proof, but arrival alone must not
      // change a reading/search already on screen. Keep all on-device paths on
      // the same fresh, filtered saved snapshot after this explicit request.
      if (isLocal) {
        const fresh = await listLocalProofItems();
        if (controller.signal.aborted || currentItems.current !== snapshot) return;
        snapshot = fresh;
        currentItems.current = fresh;
        setItems(fresh);
        if (generation === automaticGeneration.current) setAutomaticChanges(false);
      }
      const searchSources = snapshot.filter(item =>
        (!filters.category || item.category === filters.category) &&
        (!filters.tag || item.tags.includes(filters.tag)));
      const result = isLocal && companion?.semantic && useSemantic && searchSources.length
        ? { items: await semanticCompanionSearch(companion, query, searchSources, controller.signal), semanticDegraded: false }
        : isLocal
        ? await searchLocalProofItems(query, filters)
        : await searchProofItems(query, filters);
      if (controller.signal.aborted || currentItems.current !== snapshot) return;
      // Local lexical recall reads storage separately. A different tab may add
      // Proof during that read; keep results on the requested source revisions
      // so every displayed result remains available to the same story snapshot.
      const requestedVersions = new Map(searchSources.map(item => [item.id, item.updatedAt]));
      setSearchResults(isLocal
        ? result.items.filter(item => requestedVersions.get(item.id) === item.updatedAt)
        : result.items);
      setSemanticDegraded(result.semanticDegraded);
    } catch (searchError) {
      if (!controller.signal.aborted) setError(searchError instanceof Error ? searchError.message : "Search failed");
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

  async function clearLocalData() {
    const imageCount = items.filter((item) => item.imagePath).length;
    if (
      !window.confirm(
        `Remove all ${items.length} displayed saved Proof ${items.length === 1 ? "item" : "items"}, any newly auto-saved Proof, and their attachments (${imageCount} displayed) from this browser profile? This also forgets trusted-folder approval and stops automatic saving. Download a backup first. This cannot be undone. Pending review items, downloaded backups, and original files are not removed.`,
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
        <div className="app-identity">
          <span className="gallery-eyebrow"><ProofMark />A place for your real life</span>
          <h1>Proof Gallery</h1>
          <p className="gallery-purpose">The care, connection, and things you made happen. Here when you want to remember.</p>
        </div>
        <div className="header-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => openEditor("new")}
            disabled={editingBlocked}
          >
            Add Proof
          </button>
          {isLocal && <button className="secondary-button review-button" type="button" aria-label={`Review media${pendingCount === null ? "" : `, ${pendingCount} pending`}`} disabled={editingBlocked} onClick={openReview}>
            Review media{pendingCount !== null && <span className="review-count" aria-hidden="true">{pendingCount}</span>}
          </button>}
          <details className="gallery-tools" ref={toolsDisclosure} onKeyDown={event => {
            if (event.key === "Escape" && toolsDisclosure.current) {
              toolsDisclosure.current.open = false;
              toolsDisclosure.current.querySelector("summary")?.focus();
            }
          }} onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
          }}>
            <summary>More <span aria-hidden="true">⌄</span></summary>
            <div className="gallery-tools-menu" onClick={event => {
              const button = (event.target as HTMLElement).closest("button");
              if (button && !button.disabled && toolsDisclosure.current) toolsDisclosure.current.open = false;
            }}>
          {isLocal ? (
            <>
              <button
                className="text-button"
                type="button"
                onClick={() => openBackup("export")}
                disabled={editingBlocked}
              >
                Back up
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => openBackup("restore")}
                disabled={editingBlocked}
              >
                Restore
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => void clearLocalData()}
                disabled={editingBlocked}
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
          <button className="text-button" type="button" onClick={onNative} disabled={editingBlocked || Boolean(editor || backupMode || storySeedId) || showMediaInbox}>Connect native vault</button>
          <button className="text-button" type="button" onClick={onVisitLanding} disabled={busy || mediaDirty}>
            About
          </button>
            </div>
          </details>
        </div>
      </header>

      <div className="gallery-navigation">
        <nav aria-label="Gallery views" className="gallery-view-buttons">
          <button type="button" aria-current={view === "gallery" ? "page" : undefined} disabled={editingBlocked} onClick={() => changeView("gallery")}>Saved Proof</button>
          {isLocal && <button type="button" aria-current={view === "sources" ? "page" : undefined} disabled={editingBlocked} onClick={() => changeView("sources")}>Sources</button>}
        </nav>
        <span className="privacy-badge">{isLocal ? "Local · not synced · not encrypted" : "Private · only you"}</span>
      </div>

      {isLocal && (
        <LocalStorageStatus disabled={editingBlocked} revision={storageRevision} onBackup={() => openBackup("export")} />
      )}
      {isLocal && <InstallProof disabled={editingBlocked || Boolean(editor || backupMode || storySeedId) || showMediaInbox} />}

      {isLocal && backupMode && <BackupPanel key={backupMode} mode={backupMode} blocked={mediaDirty || busy} onBusyChange={setBusy} onClose={() => setBackupMode(null)} onRestored={async () => { setNotice(null); clearSearch(); await reload(); }} />}
      {isLocal && automaticChanges && <div className="automatic-proof-notice" role="status">
        <p>Your trusted folder has saved new Proof. Your current view has not changed.</p>
        <button type="button" className="text-button" disabled={editingBlocked || Boolean(editor || backupMode || storySeedId) || showMediaInbox} onClick={showAutomaticProof}>Show newly saved Proof</button>
      </div>}
      {isLocal && <section className="sources-panel" aria-labelledby="sources-title" hidden={view !== "sources"}>
        <div className="sources-heading">
          <span className="gallery-eyebrow">Make room for the everyday</span>
          <h2 id="sources-title">Your sources, at your pace.</h2>
          <p>Choose where media comes from. Review first, or explicitly trust a folder to save its media automatically.</p>
        </div>
        <div className="source-cards">
          <FolderSource suspended={busy || mediaDirty || Boolean(editor || backupMode || storySeedId) || showMediaInbox} onReview={openReview} onCandidatesAdded={() => void refreshPendingCount()} />
          <section className="source-card" aria-labelledby="media-source-title">
            <span className="source-kind">Mac · Android · PC</span>
            <h3 id="media-source-title">Photos & media</h3>
            <p>Choose a few images, screenshots, or clips from your device. Add a short note during review.</p>
            <button className="secondary-button" type="button" disabled={editingBlocked} onClick={openReview}>Choose media</button>
            <small>Only the files you choose. Originals stay where they are.</small>
          </section>
          <section className="source-card" aria-labelledby="mac-source-title">
            <span className="source-kind">Optional Mac companion</span>
            <h3 id="mac-source-title">Apple Photos</h3>
            <p>Use the companion to select a Photos album or date range. Transfer a prepared batch into your review.</p>
            <button className="secondary-button" type="button" disabled={editingBlocked} onClick={() => setShowCompanion(value => !value)}>{showCompanion ? "Close Mac connection" : "Connect this Mac"}</button>
            <small>{companion ? "A temporary companion connection is active." : "Companion prerelease: a public notarized installer is not available yet. Choose media above to begin without it."}</small>
          </section>
        </div>
        {showCompanion && <CompanionPanel session={companion} onSession={setCompanion} onBusyChange={setBusy} disabled={busy || mediaDirty} onImported={() => { setView("gallery"); setShowMediaInbox(false); window.setTimeout(() => setShowMediaInbox(true), 0); void reload(); }} />}
        <details className="source-guide">
          <summary>A simple drop folder for Drive, Dropbox, or your device</summary>
          <p>Create a dedicated folder such as “For Proof” in a folder already synced by your own Drive or Dropbox app. Choose that one folder above. Only its top-level media is read; this does not connect your whole account.</p>
          <p>Review is the default. You can separately confirm automatic saving for this exact folder. Keep this page open and visible for checks; installing the web app does not make collection run while it is closed.</p>
          <p>The sync provider may hold the source files under its own privacy settings. Your gallery stays in this browser; folder sync is not a gallery backup or cross-device gallery sync.</p>
        </details>
        <aside className="connection-status" aria-label="Assistant connection status">
          <h3>Who can access this gallery?</h3>
          <p>{companion ? "This Mac is temporarily paired for the actions you request. Pairing expires after five minutes." : "No assistant is connected to this browser’s saved Proof."}</p>
          <p>ChorOS and its MCP tools use a separate private collection. Signing into an assistant does not give it this local gallery. Nothing here is sent to a cloud model.</p>
        </aside>
        <p className="sources-footnote">Review is a place to choose, not an assessment of your life. Photos do not tell us who someone is or what a moment means to you.</p>
      </section>}
      {isLocal && showMediaInbox && <MediaInbox savedProof={items} busy={busy} onBusyChange={setBusy} onDirtyStateChange={setMediaDirty} onClose={() => { setShowMediaInbox(false); void refreshPendingCount(); }} onSaved={async () => { clearSearch(); await reload(); }} />}

      {storySeed && <ProofStory key={storySeed.id} seed={storySeed} savedProof={items} companion={companion} onClose={() => setStorySeedId(null)} />}

      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="notice-banner" role="status">{notice}</p>}

      <div hidden={view !== "gallery" || showMediaInbox}>
      <section className="search-panel" aria-labelledby="search-title">
        <div>
          <h2 id="search-title">What do you need proof of right now?</h2>
          <p>
            Find your saved words, photos, and moments. Only the Proof you have chosen to keep.
          </p>
        </div>
        {isLocal && companion?.semantic && <label className="checkbox-row"><input type="checkbox" checked={useSemantic} disabled={busy} onChange={event => setUseSemantic(event.target.checked)} />Match by meaning on this Mac. Sends only filtered saved Proof text to the paired companion when you search.</label>}
        <form className="search-form" onSubmit={runSearch}>
          <input
            ref={searchInput}
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
        {!query && <div className="search-starters" role="group" aria-label="Search ideas">
          <span>Try a starting point</span>
          {["Times people valued my work", "Moments of connection", "Things I finished"].map(prompt => <button className="search-starter" key={prompt} type="button" disabled={busy} onClick={() => { setQuery(prompt); searchInput.current?.focus(); }}>{prompt}<span aria-hidden="true"> ↗</span></button>)}
        </div>}
        {searchResults && isLocal && (
          <p className="search-receipt">
            {semanticDegraded ? "Showing deterministic local lexical matches. No model or provider was called." : "Showing on-device meaning matches from filtered saved Proof only. Similarity is not a judgment of worth or meaning."}
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
        <label>
          Order
          <select value={hasSearch ? "relevance" : sort} disabled={busy || hasSearch} onChange={event => setSort(event.target.value as ProofSort)}>
            <option value="newest">Newest event first</option>
            <option value="recently_added">Recently added</option>
            {hasSearch && <option value="relevance">Relevance</option>}
          </select>
        </label>
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
          <span>{hasSearch ? "Sorted by relevance" : sort === "recently_added" ? "Recently added · event dates unchanged" : "Newest event first"}</span>
        </div>
      )}

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
          ) : isLocal ? (
            <div className="first-use-paths">
              <article>
                <span className="step-number">01 · Begin anywhere</span>
                <h3>One real thing</h3>
                <p>A kind message, a photo, or a short note. Keep the original words.</p>
                <button className="primary-button" type="button" disabled={editingBlocked} onClick={() => openEditor("new")}>Add the first Proof</button>
              </article>
              <article>
                <span className="step-number">02 · Make it easier</span>
                <h3>Choose a source</h3>
                <p>Bring media from your device or start a chosen folder checking for new files.</p>
                <button className="secondary-button" type="button" disabled={editingBlocked} onClick={() => changeView("sources")}>Explore sources</button>
              </article>
              <article>
                <span className="step-number">03 · Keep a copy</span>
                <h3>Make a private backup</h3>
                <p>Once you have saved something, protect it with an encrypted recovery file.</p>
                <button className="text-button" type="button" disabled={editingBlocked} onClick={() => openBackup("export")}>Open backup tools</button>
              </article>
            </div>
          ) : (
            <button className="primary-button" type="button" disabled={busy} onClick={() => openEditor("new")}>Add the first Proof</button>
          )}
        </section>
      ) : (
        <section className="gallery-grid" aria-label="Saved Proof">
          {visible.map((item) => (
            <ProofCard key={item.id} item={item} disabled={busy} onEdit={openEditor} onReadStory={candidate => setStorySeedId(candidate.id)} onDelete={(candidate) => void remove(candidate)} />
          ))}
        </section>
      )}
      </div>

      <footer className="safety-footer">
        <p>{PROOF_CONSTITUTION}</p>
        <span>Private review. Original evidence. Your own words.</span>
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

function BrowserGalleryApp({ onNative }: { onNative: () => void }) {
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
        onNative={onNative}
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
        onNative={onNative}
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
      onNative={onNative}
      onSwitchMode={() => chooseStorageMode("local")}
      onSignOut={() => void getSupabase().auth.signOut()}
    />
  );
}

export default function App() {
  const [native, setNative] = useState(false);
  if (native) return <NativeVaultGallery onExit={() => setNative(false)} />;
  return <BrowserGalleryApp onNative={() => setNative(true)} />;
}
