import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallProof } from "./InstallProof";
import type { ProofInstallEvent } from "../lib/pwa";

const fixtures = vi.hoisted(() => ({ state: { available: true, offlineReady: true, updateWaiting: true, error: false, installed: false, installPrompt: null as ProofInstallEvent | null }, check: vi.fn(), listeners: new Set<() => void>() }));
vi.mock("../lib/pwa", () => ({
  getProofPwaState: () => fixtures.state,
  subscribeProofPwa: (listener: () => void) => { fixtures.listeners.add(listener); return () => { fixtures.listeners.delete(listener); }; },
  checkProofPwaUpdate: fixtures.check,
  takeProofInstallPrompt: () => {
    const prompt = fixtures.state.installPrompt;
    fixtures.state = { ...fixtures.state, installPrompt: null };
    fixtures.listeners.forEach(listener => listener());
    return prompt;
  },
}));
beforeEach(() => { fixtures.state = { ...fixtures.state, installPrompt: null, installed: false }; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function offer(choice: "accepted" | "dismissed" = "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: choice }) });
  act(() => {
    fixtures.state = { ...fixtures.state, installPrompt: event as ProofInstallEvent };
    fixtures.listeners.forEach(listener => listener());
  });
  return prompt;
}
function openHelp() { fireEvent.click(screen.getByText("Install Proof for easy access")); }

describe("installation help", () => {
  it("offers truthful platform guidance and passive update instructions without an automatic prompt", () => {
    render(<InstallProof />); openHelp();
    expect(screen.getByText(/This version is not an OS share-sheet destination/)).toBeInTheDocument();
    expect(screen.getByText(/No page will reload automatically/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install Proof" })).not.toBeInTheDocument();
    const prompt = offer();
    expect(prompt).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Install Proof" })).toBeInTheDocument();
  });
  it("opens installation only from the owner's click and handles cancellation", async () => {
    render(<InstallProof />); openHelp();
    const prompt = offer();
    fireEvent.click(screen.getByRole("button", { name: "Install Proof" }));
    await waitFor(() => expect(screen.getByText(/Installation canceled/)).toBeInTheDocument());
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Install Proof" })).not.toBeInTheDocument();
  });
  it("disables install and update actions while the parent is editing or saving", () => {
    render(<InstallProof disabled />); openHelp();
    const prompt = offer();
    expect(screen.getByRole("button", { name: "Install Proof" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check for app update" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Install Proof" }));
    expect(prompt).not.toHaveBeenCalled();
  });
  it("acknowledges installed state and removes its state subscription on unmount", () => {
    const { unmount } = render(<InstallProof />); openHelp();
    offer();
    act(() => {
      fixtures.state = { ...fixtures.state, installed: true, installPrompt: null };
      fixtures.listeners.forEach(listener => listener());
    });
    expect(screen.getByText("Proof app & offline access")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install Proof" })).not.toBeInTheDocument();
    unmount();
    expect(fixtures.listeners.size).toBe(0);
    expect(() => offer()).not.toThrow();
  });
});
