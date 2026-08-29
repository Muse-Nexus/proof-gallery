import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("standalone setup boundary", () => {
  it("fails visibly when the owner has not configured a backend", () => {
    render(<App />);
    expect(screen.getByText("Setup required")).toBeInTheDocument();
    expect(screen.getByText(/self-hosting guide/i)).toBeInTheDocument();
  });
});
