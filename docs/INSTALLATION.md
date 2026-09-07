# Install Proof for easy access

Installation adds an app icon. It does not grant access to Photos, messages,
folders, or accounts, and it does not add background collection. You still use
the explicit local picker, paste/drop capture, or a separately confirmed folder.

- **Android:** open Proof in Chrome or another supporting browser and choose
  **Install app** or **Add to Home screen** from its menu. When the browser offers
  it, Proof also shows an **Install Proof** button.
- **Mac or PC:** use Chrome or Edge's install icon/menu. On supported Macs,
  Safari offers **File → Add to Dock**.
- **iPhone or iPad:** use the browser's Share menu and **Add to Home Screen**.
- If installation is unavailable, bookmark Proof. The ordinary browser version
  works without installation. UI names and support vary by browser/version.

Use the same browser/profile. An installed app, another browser, or another
device may have separate storage. Installation does not transfer your gallery,
encrypt it, or make a recovery copy. Keep an encrypted backup and test recovery.
See [MDN's platform installation guidance](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## Offline access

Visit a production build while connected and wait until **Public app files are
ready offline** appears under installation help. Reopening the root gallery can
then use cached app code and the browser's existing local collection. Hosted
accounts, server search, and external services still need a connection. Decorative
landing images are not part of the offline shell; real attachments stay in their
existing local store and are never added to the service-worker cache.

The worker precaches only an explicit build-fingerprinted list: app HTML, JS,
CSS/fonts, offline help, manifest, and icons. It never caches API responses,
authenticated requests, evidence attachments, query-bearing URLs, or POSTs.
Its HTML cache keys are `/` and `/offline`, not the physical `index.html` and
`offline.html` filenames, because [Cloudflare Pages redirects HTML filenames to
clean URLs](https://developers.cloudflare.com/pages/configuration/serving-pages/#route-matching).
Precache requests still reject redirects and omit credentials; this does not
expand the allowed public files.
There are no push messages, background-sync jobs, OS share target, library reads,
or runtime cache expansion. Browser eviction/site-data removal can remove both
offline files and local evidence; offline availability is not durability.

## Updates do not interrupt edits

An update prepares a separate public app-shell cache and waits. Proof never
forces a new worker onto an open page or reloads a page automatically. When an
update is ready, save edits and close **every** Proof tab/app window, then reopen.
The new worker activates only after the previous version no longer has clients.
It removes only old caches with Proof's own `proof-gallery-public-shell-v1-`
prefix, never IndexedDB or unrelated caches. This follows the browser's
[service-worker lifecycle](https://web.dev/articles/service-worker-lifecycle).

## Why OS “Share to Proof” is not enabled yet

An installed web share target delivers media as a multipart POST. A functioning
service worker can intercept it locally, but a missing/removed worker can allow
that POST to reach the hosting origin. Server rejection cannot prove the bytes
never left the device. Therefore this manifest deliberately has no `share_target`
and no temporary share inbox/database. We are not trading the local boundary for
a convenient share-sheet button. A native receiver with a verified local-only
handoff is the next route to investigate. Existing paste/drop and file selection
do not use a share POST. See the [Chrome share-target flow](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target).

## Development and release checks

The service worker is emitted by `bun run build` and registered only by production
builds; Vite development does not register it. Test a clean built preview on a
dedicated loopback origin/profile, never a personal gallery. Use synthetic media
to check offline saved/pending isolation and inspect the cache allowlist. Check
that a second build waits without reloading an editor, then activates after all
old clients close. Real OS installation remains a per-device check; a browser
test of the manifest and offline worker alone is not that receipt.

Run `bun run build` followed by `bun run test:e2e:pwa` for the repeatable synthetic
check. Its loopback server redirects both physical HTML filenames like Pages,
then verifies canonical precaching, offline attachments/pending isolation, and
the waiting/activation update lifecycle. During offline checks the fixture server
also drops connections, because browser emulation alone can leave worker fetches
online. It uses a fresh browser session and
never opens a personal gallery or deploys the build.
