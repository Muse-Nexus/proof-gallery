# Notices

## Project origin

Proof Gallery is a standalone adaptation of the Proof Gallery feature authored
by Mark D. Matthews for ChorOS. The original author and rights holder authorized
this extraction and publication under the repository's MIT License. The new
repository contains no private Git history, production configuration, or
personal evidence.

## Bundled decorative visuals

The public landing page bundles two presentation-only visuals. The interface
labels both **Not saved Proof**; neither asset is part of any Proof item,
backup, provenance record, embedding, or search result.

- `paper-collage-unsplash.webp` is adapted from “Colorful paper cutouts form an
  abstract collage” by [Jan L.](https://unsplash.com/@janlbhj), downloaded under
  the [Unsplash License](https://unsplash.com/license). The original work is at
  <https://unsplash.com/photos/colorful-paper-cutouts-form-an-abstract-collage-rUJP-3aLpBE>.
- `evidence-desk-ai.webp` is an original decorative image created for this
  project with OpenAI's built-in image generation tool on 2026-08-29. The tool
  did not expose its underlying model identifier or version.

Source receipts, transformations, SHA-256 hashes, and the exact AI prompt are
recorded in [docs/VISUAL_ASSETS.md](docs/VISUAL_ASSETS.md).

## Bundled runtime dependencies

Built frontend distributions include MIT-licensed runtime code from:

- React, React DOM, and Scheduler — Copyright (c) Meta Platforms, Inc. and
  affiliates.
- Supabase JavaScript libraries — Copyright (c) 2020 Supabase.

The following MIT terms apply to those bundled dependencies:

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Development-only dependencies are not distributed with the built application.
Their exact versions are recorded in `bun.lock` and `deno.lock`; installed
packages retain their own license files.
