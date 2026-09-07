import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup() {
  vi.resetModules();
  const installing = Object.assign(new EventTarget(), { state: "installing" });
  const registration = Object.assign(new EventTarget(), { active: null as object | null, waiting: null as object | null, installing, update: vi.fn().mockResolvedValue(undefined) });
  const serviceWorker = { register: vi.fn().mockResolvedValue(registration), ready: Promise.resolve(registration) };
  vi.stubGlobal("navigator", { serviceWorker });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { isSecureContext: true }));
  return { registration, serviceWorker, installing };
}

describe("non-disruptive PWA registration", () => {
  it("registers once and observes readiness without claiming or reloading pages", async () => {
    const fixture = setup();
    const api = await import("./pwa");
    const listener = vi.fn();
    const unsubscribe = api.subscribeProofPwa(listener);
    await api.registerProofPwa();
    await api.registerProofPwa();
    expect(fixture.serviceWorker.register).toHaveBeenCalledExactlyOnceWith("/proof-sw.js", { scope: "/", updateViaCache: "none" });
    expect(api.getProofPwaState().offlineReady).toBe(false);
    fixture.registration.active = {};
    fixture.installing.state = "activated";
    fixture.installing.dispatchEvent(new Event("statechange"));
    expect(api.getProofPwaState().offlineReady).toBe(true);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
  it("exposes a waiting update, checks only on request, and never sends activation commands", async () => {
    const fixture = setup();
    const api = await import("./pwa");
    await api.registerProofPwa();
    fixture.registration.active = {};
    fixture.registration.waiting = { postMessage: vi.fn() };
    fixture.installing.state = "installed";
    fixture.installing.dispatchEvent(new Event("statechange"));
    expect(api.getProofPwaState().updateWaiting).toBe(true);
    expect(fixture.registration.update).not.toHaveBeenCalled();
    await api.checkProofPwaUpdate();
    expect(fixture.registration.update).toHaveBeenCalledOnce();
    expect((fixture.registration.waiting as { postMessage: ReturnType<typeof vi.fn> }).postMessage).not.toHaveBeenCalled();
  });
  it("reports failed registration without making an offline promise", async () => {
    const fixture = setup();
    fixture.serviceWorker.register.mockRejectedValue(new Error("Synthetic unavailable"));
    const api = await import("./pwa");
    await api.registerProofPwa();
    expect(api.getProofPwaState()).toMatchObject({ offlineReady: false, error: true });
  });
  it("does nothing when service workers or secure context are unavailable", async () => {
    const fixture = setup();
    vi.stubGlobal("window", { isSecureContext: false });
    const api = await import("./pwa");
    await api.registerProofPwa();
    expect(fixture.serviceWorker.register).not.toHaveBeenCalled();
  });
  it("captures an install offer before UI mount and consumes it only once", async () => {
    setup();
    const api = await import("./pwa");
    await api.registerProofPwa();
    const event = new Event("beforeinstallprompt", { cancelable: true });
    const prompt = vi.fn();
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(api.getProofPwaState().installPrompt).toBe(event);
    expect(prompt).not.toHaveBeenCalled();
    const unsubscribe = api.subscribeProofPwa(() => {});
    unsubscribe();
    expect(api.takeProofInstallPrompt()).toBe(event);
    expect(api.takeProofInstallPrompt()).toBeNull();
    window.dispatchEvent(new Event("appinstalled"));
    expect(api.getProofPwaState().installed).toBe(true);
  });
});
