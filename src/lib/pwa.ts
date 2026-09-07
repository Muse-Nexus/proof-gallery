export type ProofInstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type PwaState = { available: boolean; offlineReady: boolean; updateWaiting: boolean; error: boolean; installPrompt: ProofInstallEvent | null; installed: boolean };
let state: PwaState = { available: false, offlineReady: false, updateWaiting: false, error: false, installPrompt: null, installed: false };
let registration: ServiceWorkerRegistration | null = null;
let started = false;
const listeners = new Set<() => void>();

export const getProofPwaState = () => state;
export function subscribeProofPwa(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function updateState(next: Partial<PwaState>) {
  state = { ...state, ...next };
  listeners.forEach(listener => listener());
}

/** Production builds only. Registration caches public code, never evidence or account responses. */
export async function registerProofPwa(): Promise<void> {
  if (started || !window.isSecureContext || !("serviceWorker" in navigator)) return;
  started = true;
  // Capture while the landing page is open too. The event remains in memory only,
  // across component remounts, and is consumed by one explicit owner click.
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    if ("prompt" in event && typeof event.prompt === "function") updateState({ installPrompt: event as ProofInstallEvent });
  });
  window.addEventListener("appinstalled", () => updateState({ installed: true, installPrompt: null }));
  updateState({ available: true, installed: window.matchMedia?.("(display-mode: standalone)").matches ?? false });
  try {
    registration = await navigator.serviceWorker.register("/proof-sw.js", { scope: "/", updateViaCache: "none" });
    const refresh = () => updateState({ offlineReady: Boolean(registration?.active), updateWaiting: Boolean(registration?.waiting), error: false });
    const watchInstalling = () => {
      const installing = registration?.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "redundant") updateState({ error: true });
        else { refresh(); queueMicrotask(refresh); }
      });
      refresh();
    };
    registration.addEventListener("updatefound", watchInstalling);
    watchInstalling();
    void navigator.serviceWorker.ready.then(refresh);
  } catch { updateState({ error: true }); }
}

export function takeProofInstallPrompt(): ProofInstallEvent | null {
  const prompt = state.installPrompt;
  updateState({ installPrompt: null });
  return prompt;
}

export async function checkProofPwaUpdate(): Promise<void> {
  if (!registration) return;
  try { await registration.update(); }
  catch { updateState({ error: true }); }
}
