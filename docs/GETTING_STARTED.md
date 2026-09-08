# Your first few minutes with Proof

Proof keeps things you want to find again: a message of care, a photo of time
together, evidence someone valued your work, or a moment you want to remember.
There is no target to hit, streak to maintain, or correct feeling to have.

## Start with one thing

Open the [gallery](https://proof-gallery-9jn.pages.dev/) and choose **Start in
this browser**. Use the same profile each time. Local evidence belongs to that
profile, not an account, and active storage is not encrypted. Nothing else is
required: no companion, cloud model, subscription, or API key.

Choose **Add Proof** and start with a short note or exact message. Keep the
words as written. Optional word-based suggestions can supply a title, category,
and tags from your note; these are organization aids, not an AI interpretation.
Edit any suggestion, or turn them off. Fields you edit—including tags you
remove—will not be replaced as you continue writing. Ambiguous wording leaves
the category for you to choose.

You can also select an individual image, or focus **Paste or drop evidence here**
and paste an image or plain text. Dropping one attachment there works too. Text
is appended to the note as pasted; a link is only text and is never downloaded.
The app does not inspect your clipboard in the background or intercept pasting
into other fields. Use **Photos & media** for a batch.

Open **Date, source & other details** when you know more. Dates, senders, people,
and sources are never guessed from a pasted message, link, or filename. Unknown
source details stay blank and source type stays **Other** until you choose it.
An image alone can be saved in browser-local mode with a title and category;
its filename can supply the title, not an event date or meaning.

The editor checks your selected attachment before enabling Save. Choosing a
different file replaces that pending choice; canceling the editor stops it.
While a save is running, fields stay locked so later edits cannot be lost.

For a batch, open **Photos & media**. Choose photos, screenshots, or short clips
on your Mac, PC, or phone. Each arrives in review. Write a short note if you
want, such as “Saw this tree while hiking with my sister. Cried.” The note stays
in your words; the app does not decide why you cried or what the image proves.
Save the note, choose a category, and save selected items into your gallery.

## Make the next addition easier

You can [install Proof](INSTALLATION.md) for an app icon and offline access to
the browser-local gallery after its public app files are prepared. Installation
does not sync, back up, or grant background access to anything. OS “Share to
Proof” is not enabled; use the explicit picker, paste, or drop instead.

Choose a dedicated screenshot or photo-export folder in the **folder source**
and start checking. New media arrives in review by default while the gallery is
open and visible. Or select **Allow automatic saving from this folder**, choose
the category and optional tags for its media, and confirm. This permits existing
and future supported files directly in that folder to become saved Proof without
per-item review. Only use it for a folder whose contents you want in the gallery.
The app preserves the media; it does not decide what a photo means.

Folder access depends on your browser; the normal media picker remains
available. Keep the folder small: only its immediate files are checked.
Your trusted folder and approval are remembered in this browser. It can resume
on return when permission is still granted. **Pause** stays paused across reloads;
**Forget** removes its approval and connection, not saved items. Ordinary review
connections still end on reload. Nothing collects while closed.
See [automatic sources](AUTOMATIC_SOURCES.md).

For Apple Photos directly, the optional [Mac companion](COMPANION.md) offers
Recent Photos or an album/date range. Favorites are not required. Its public
source is a preview, and a notarized local candidate exists, but there is no
public Mac binary or completed clean-account acceptance yet. Start with browser
selection unless you are building the native companion yourself. See the
[current platform and release status](RELEASE_STATUS.md).

## Find something you saved

Search when you want evidence. Try words from a message, a person's name you
added, or a project. Search prompts help you begin, but local text matching
does not understand every paraphrase. Optional meaning search is described in
the [README](../README.md).

Category and tag filters narrow saved Proof. Clear them to see the collection.
Pending review never appears as saved evidence.

**Read as a story** brings selected moments together with their full notes,
dates, and sources. Unknown dates remain separate. The reading does not create
a new fact or tell you how to feel.

## Keep a recovery copy

Choose **Back up**, enter a strong passphrase, and download the encrypted
`.proof` file. Saved Proof, pending media, and saved notes are included. Keep
the file privately and the passphrase separately. You can store it manually in
a local, Drive, or Dropbox folder. Never paste the backup passphrase, a native
assistant token, or private evidence into a chat, issue, repository, or support
message.

Test **Restore** in a separate browser profile before depending on a backup.
Wrong passphrases or conflicts leave the collection unchanged. An old archive
can restore an item you deleted after making that backup.

## Give the tool to someone

Share the [website](https://proof-gallery-9jn.pages.dev/) or
[repository](https://github.com/Muse-Nexus/proof-gallery), not your backup.
Say: “Open the site, choose **Start in this browser**, add one note or selected
photo, then make an encrypted backup.” Their gallery starts separately in their
browser. You do not need to create an account for them, handle their files, or
send them your passphrase. They can also [run their own copy](SELF_HOSTING.md)
without a subscription.

The public website currently serves the reviewed `6bdd308` release. A future
feature is available only after another release or when you run that checkout
locally. Native Mac distribution is a separate release step; check
[release status](RELEASE_STATUS.md) before describing it as downloadable.
