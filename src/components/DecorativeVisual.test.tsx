import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DecorativeVisual } from "./DecorativeVisual";

afterEach(cleanup);

describe("DecorativeVisual disclosure", () => {
  it("labels AI imagery as decoration that is not saved Proof", () => {
    const { container } = render(
      <DecorativeVisual kind="ai" src="/visuals/evidence-desk-ai.webp" />,
    );

    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.querySelector("img")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("AI-generated decorative image")).toBeInTheDocument();
    expect(screen.getByText("Not saved Proof")).toBeInTheDocument();
  });

  it("credits the bundled Unsplash photo beside the same disclosure", () => {
    render(
      <DecorativeVisual
        kind="unsplash"
        src="/visuals/paper-collage-unsplash.webp"
      />,
    );

    expect(screen.getByRole("link", { name: "Jan L." })).toHaveAttribute(
      "href",
      "https://unsplash.com/@janlbhj",
    );
    expect(screen.getByRole("link", { name: "Unsplash" })).toHaveAttribute(
      "href",
      "https://unsplash.com/photos/colorful-paper-cutouts-form-an-abstract-collage-rUJP-3aLpBE",
    );
    expect(screen.getByText("Not saved Proof")).toBeInTheDocument();
  });
});
