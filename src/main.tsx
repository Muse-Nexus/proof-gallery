import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerProofPwa } from "./lib/pwa";
import "./styles.css";
import "./visual-polish.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) void registerProofPwa();
