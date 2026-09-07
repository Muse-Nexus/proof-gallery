# Proof Gallery

**A free place to keep real evidence of being loved, valued, connected, and accomplished.**

A kind message. Someone choosing your work. A photo with someone you love.
A difficult stretch that ended. Keep the original words or image, its date,
and where it came from. Find it again when your own history feels hard to reach.

> Never use proof to invalidate pain, create guilt, demand optimism, or argue
> that the user should feel better. Use it only to restore evidence that
> depression has hidden.

[Open Proof Gallery](https://proof-gallery-9jn.pages.dev/) ·
[Get started](docs/GETTING_STARTED.md) · [Run your own](docs/SELF_HOSTING.md) ·
[Privacy](docs/PRIVACY.md)

![Proof Gallery. Decorative paper art, not saved evidence.](public/og-purpose.png)

## Use it in everyday life

1. **Start in this browser.** No account or paid API key needed.
2. **Bring something real.** Add a message or note, choose photos and clips,
   or connect a dedicated folder for automatic checks while the gallery is open.
3. **Choose your approval style.** Review incoming items, or explicitly confirm
   automatic saving for a trusted folder. Choose its category and tags once;
   new validated media can then save without approving each item.
4. **Find it when you want it.** Search saved evidence, filter by category or
   tag, or read selected moments together with their original words and sources.
5. **Back up.** Download an encrypted archive of saved items and pending review.
   Keep its passphrase somewhere safe; it cannot be recovered.

## Let a chosen folder bring things to you

Choose a small folder for screenshots or exported media and start its source.
While the gallery is open and visible, it checks about once a minute and stages
new supported files in review by default. You may confirm automatic saving for
that exact folder: its handle and approval are remembered in this browser,
and new media is saved with a clear source-consent receipt. The app does not
interpret images or invent missing dates, quotes, or people.

Pause, resume, check now, and forget are available. A trusted source can resume
when you reopen the gallery if its approval and browser read permission remain
active; a paused source stays paused. Ordinary review connections end on reload.
Nothing runs with the browser closed. Original files are never changed.

The browser asks for read access where folder permission is supported. Other
browsers keep the ordinary media picker. Only immediate files are checked;
there is no recursive library scan. See [source behavior and limits](docs/AUTOMATIC_SOURCES.md).

The optional [Mac Photos companion](docs/COMPANION.md) reads Recent Photos,
Favorites, or an album/date range you choose. It prepares media locally, then
transfers a batch through a review file or a temporary same-Mac connection.
On-device OCR and metadata are review aids, not verified quotes or inferred
identities. The native installer is a prerelease; public notarized distribution
is still pending. Browser media selection works without it on Mac, PC, or phone.

### Full-version native work (not yet released)

This branch adds a durable private Mac collection, explicit background source
consent, a same-store gallery connection, read-only MCP access and separately
opted-in generic reminders. Source and assistant permissions do not restore from
backups or appear just because you install the app. See [native setup](docs/NATIVE_SETUP.md)
and [completion gates](docs/FULL_VERSION_PLAN.md). The released website and a
local source build are not a notarized installer or verified Windows/Android
background service; those platform and distribution gates remain separate.

## Your evidence stays yours

The code is public and MIT licensed. Personal evidence does not belong in this
repository, its issues, screenshots, examples, or release bundles.

- **Browser-local mode:** items and original media stay in this profile. Active
  storage is not encrypted by Proof Gallery, authenticated, or synced. Other
  users of the profile may access it. Clearing site data can erase it.
- **Native collection (unreleased):** a separate private Mac database, accessed
  only through explicitly granted gallery/assistant connections. Active storage
  is not app-encrypted; OS permissions do not block software running as you.
  A cloud assistant can disclose the saved text you request to its provider.
- **Encrypted backups:** include saved Proof, pending media, and saved review
  notes. Encryption protects the downloaded archive, not active browser storage.
  Older plaintext backups remain readable. Test recovery before relying on it.
- **Optional hosted mode:** your own Supabase instance provides owner accounts,
  forced row-level security, private images, and scoped search. An unavailable
  hosted connection never silently changes storage mode.
- **No app analytics or cloud image analysis.** Bundled stock/AI illustrations
  are labeled decoration. Saved cards show real evidence attachments.

Original media can contain embedded location/device metadata. Removing gallery
items cannot remove originals or another program's copies.
Read the [privacy model](docs/PRIVACY.md).

## Find and read evidence

Every result retains the actual note or quote, known date, and source.
Search excludes pending review and ordinary ChorOS memories. Retrieval starts
only when you ask.

Local text search needs no model. Optional same-Mac meaning matching runs on
filtered saved text. The companion currently pairs only with the official
website; localhost and custom hosts use the review-file fallback. Hosted
embeddings use one optional, operator-configured OpenAI-compatible endpoint.
Images are never sent, and lexical fallback is visible.

The story reading brings together selected notes and photos without inventing
autobiography or emotional conclusions. The optional on-device model selects
source IDs; code displays full original notes.

## Run locally

Install [Bun](https://bun.sh), then:

```sh
git clone https://github.com/Muse-Nexus/proof-gallery.git
cd proof-gallery
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:5173` and choose **Start in this browser**. A different
hostname or port has a separate collection. Use encrypted backup and restore
to transfer intentionally.

`bun run build` produces `dist/` for a dedicated HTTPS hostname with the
included security headers. The software has no subscription; hosting and
optional providers may have costs. See [self-hosting](docs/SELF_HOSTING.md)
for accounts, embeddings, Storage, origins, recovery, and deletion.

## Develop and contribute

Read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), and the
[safety constitution](docs/SAFETY.md). Use synthetic evidence for testing.

```sh
bun run check
bun run test:e2e
deno fmt --check supabase/functions
deno check --frozen supabase/functions/proof-search/index.ts
deno check --frozen supabase/functions/embed-proof/index.ts
```

The [synthetic browser suite](docs/E2E.md) covers add/edit/search, private review,
encrypted recovery, and trusted-folder consent in an isolated local browser.
Read its setup and device-verification limits before running it.

The [everyday-access release notes](docs/EVERYDAY_ACCESS.md) describe note-first
capture, recently added sorting, source-context matching, recovery parts, and
the separate assistant/installation/native permission boundaries.

Native changes also need `swift test` and the checks in
[the companion guide](docs/COMPANION.md). Database changes need the isolated
two-owner integration tests in `.github/workflows/ci.yml`. Never point fixture
tests at production. [Report security problems privately](SECURITY.md).

Contributions should reduce the work of collecting and retrieving actual
evidence. Preserve source permission, private review, and user-initiated recall.
No public galleries, mood diagnosis, worth scores, invented meaning, hidden
account scanning, or mandatory multi-model orchestration.

[MIT License](LICENSE) · [Notices](NOTICE.md) ·
[Visual asset receipts](docs/VISUAL_ASSETS.md)
