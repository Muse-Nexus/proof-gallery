import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProofMedia } from "./ProofMedia";
afterEach(cleanup);
it("never autoplays a clip and keeps an original download if playback fails", () => {
  const { container } = render(<ProofMedia url="blob:synthetic-video" type="video/mp4" title="Synthetic clip" />);
  const video = container.querySelector("video")!;
  expect(video).toHaveAttribute("controls"); expect(video).not.toHaveAttribute("autoplay");
  fireEvent.error(video);
  expect(screen.getByText(/Preview unavailable/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Download original" })).toHaveAttribute("href", "blob:synthetic-video");
});
it("resets failed preview state when the attachment changes", () => {
  const { rerender } = render(<ProofMedia url="blob:old" title="Synthetic" />);
  fireEvent.error(screen.getByRole("img"));
  rerender(<ProofMedia url="blob:new" title="Synthetic" />);
  expect(screen.getByRole("img")).toHaveAttribute("src", "blob:new");
});
