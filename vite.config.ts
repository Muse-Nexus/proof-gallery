import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildProofWorker } from "./src/lib/pwa-worker";

export default defineConfig({
  plugins: [react(), {
    name: "proof-public-shell",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        // Pages redirects physical HTML filenames; cache only canonical public URLs.
        // The generated root index.html is hashed with the bundle below.
        const publicFiles = {
          "/offline": "offline.html",
          "/manifest.webmanifest": "manifest.webmanifest",
          "/favicon.svg": "favicon.svg",
          "/icons/proof-192.svg": "icons/proof-192.svg",
          "/icons/proof-512.svg": "icons/proof-512.svg",
        };
        const publicAssets = ["/", ...Object.keys(publicFiles)];
        const emitted = Object.keys(bundle).filter(name => /^assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2?)$/.test(name)).sort();
        const hash = createHash("sha256").update(buildProofWorker.toString());
        for (const name of Object.keys(bundle).sort()) {
          const output = bundle[name];
          hash.update(name).update(output.type === "chunk" ? output.code : output.source);
        }
        for (const [url, file] of Object.entries(publicFiles)) hash.update(url).update(readFileSync(new URL(`./public/${file}`, import.meta.url)));
        const source = buildProofWorker([...publicAssets, ...emitted.map(name => `/${name}`)], hash.digest("hex").slice(0, 16));
        this.emitFile({ type: "asset", fileName: "proof-sw.js", source });
      },
    },
  }],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
