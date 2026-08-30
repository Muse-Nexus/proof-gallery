# Decorative visual assets

## Purpose-first social preview: `public/og-purpose.png`

- Built-in image generation; one request, inspected for exact text.
- Size: 1731 × 909. SHA-256:
  `caa3e194f23093ecd210db135cea0f1ff346b950bda6aa8185cba92dd425fe13`.
- Empty paper frames are decorative, not evidence. No private input images or
  personal content were used. This replaces the earlier receipts-focused
  social metadata; the prior asset is retained, not overwritten.

Exact generation prompt:

```text
Use case: ads-marketing
Asset type: a single finished landscape social-preview image for the free, private Proof Gallery, approximately 1200x630 pixels, 1.91:1 aspect ratio.
Primary request: a calm, image-forward editorial composition that suggests a welcoming place to remember concrete love, care, belonging and accomplishment. This is not a productivity archive.
Scene/backdrop: warm cream matte paper with subtle tactile grain.
Subject: an artful arrangement of abstract, empty paper frames and softly layered paper shapes only. Keep the frames plainly abstract and empty, with no photographs or evidence inside.
Style/medium: refined contemporary paper-collage editorial design with soft natural shadows and generous breathing room.
Color palette: warm cream, muted terracotta, sage and soft lavender, with dark warm charcoal lettering.
Composition/framing: wide landscape, clear visual hierarchy, balanced abstract paper arrangement, generous safe margins around the headline and subline, no clipping.
Typography: refined light-to-medium-weight sans-serif, clean and highly legible, not bold or chunky. Set the main headline large and the subline smaller, with exact spelling and punctuation.
Text (verbatim, exactly once each): "Proof Gallery" and "Evidence that you matter."
Constraints: only these two text lines. No people, invented photos, messages, receipts, identifiable events, personal evidence, screens, UI controls, productivity motifs, badges, clinical claims, optimism slogans, logos or watermarks. All imagery must be obviously decorative abstract paper artwork, never represented as someone's memories or saved Proof.
```

## Existing landing decoration

Decorative visuals make the public landing page warmer. They are not evidence,
are not attached to Proof items, and never enter item data, backups, provenance,
embeddings, or search. The UI labels every bundled decorative image **Not saved
Proof**. Inside the gallery, an image renders only when the item has both a
stored attachment path and its resolved private/local URL.

Both assets are bundled under `public/visuals/`. The running app makes no
automatic Unsplash or image-generation asset/API request and sends no evidence,
names, search text, or photos to either provider. The credited Unsplash links
navigate there only when a user chooses them.

## `paper-collage-unsplash.webp`

- Creator: Jan L. (`@janlbhj`)
- Work: “Colorful paper cutouts form an abstract collage”
- Source: <https://unsplash.com/photos/colorful-paper-cutouts-form-an-abstract-collage-rUJP-3aLpBE>
- Creator profile: <https://unsplash.com/@janlbhj>
- License: [Unsplash License](https://unsplash.com/license)
- Downloaded and transformed: 2026-08-29
- Local transformation: center-cropped and resized to 900 × 1200 WebP at
  quality 84; no semantic content was added.
- SHA-256: `c68239ac19ff1ec2ca1fa149f36bc0e694c13048e1d1f8b3d8ebed75f0ebab2e`

## `evidence-desk-ai.webp`

- Created: 2026-08-29 with OpenAI's built-in image generation tool. The tool
  did not expose an underlying model identifier or version.
- Local transformation: converted from the generated 1536 × 1024 PNG to WebP
  at quality 86; composition and content were not changed.
- SHA-256: `f0ac276d835f105df9c94297a1a1cb10323c1c111f0f4c043db8aa7d4bdaef8d`
- Final prompt:

> Use case: stylized-concept. Asset type: decorative landing-page hero
> illustration. Primary request: Create one original, polished editorial
> cut-paper still life titled conceptually “The Evidence Desk,” but render
> absolutely no title or text. Arrange layered blank photo frames, rounded blank
> paper cards, one small abstract flower or starburst accent, and a few soft
> torn-tape shapes on a warm cream ground. The scene must feel generic and
> atmospheric, never like evidence of a specific event. Scene/backdrop: Minimal
> warm cream paper surface with subtle tactile grain; no literal desk objects
> beyond the specified paper elements. Subject: A compact, art-directed cluster
> of overlapping empty frames and blank cards with tasteful geometric cut-paper
> accents. Style/medium: Premium handcrafted paper-collage illustration; softly
> dimensional cut paper, rounded friendly shapes, clean editorial clarity,
> gentle imperfections, tactile fibers, refined modern composition. Warm and
> playful emotional quality while remaining wholly original and not imitating
> any existing brand, proprietary characters, logo, palette, or layout.
> Composition/framing: Landscape 3:2. Weight the composition strongly to the
> right-hand 55–60% of the canvas. Preserve generous calm breathing room across
> the left 40–45% for landing-page copy. Slightly elevated top-down view. Keep
> the focal cluster fully inside the safe area, with open margins and no
> edge-cropped key object. Lighting/mood: Soft diffuse studio light, gentle
> layered paper shadows, warm reassuring mood, crisp visual hierarchy,
> restrained depth. Color palette: Marigold, coral, plum, cream, muted sky blue,
> and leaf green, balanced with cream as the dominant field.
> Materials/textures: Matte construction paper, subtle paper grain and fibers,
> softly torn tape edges, delicate realistic contact shadows; no glossy plastic
> or photoreal objects. Text: none. Every card face and frame interior must
> remain completely blank and abstract, with no pictures, symbols, handwriting,
> typography, labels, or marks. Constraints: Exactly one cohesive hero
> illustration; generic decorative still life only; polished at landing-page
> production quality; no watermark. Avoid: people, faces, hands, silhouettes,
> pets, animals, brands, logos, readable text, letters, numbers, names, dates,
> messages, receipts, awards, certificates, trophies, medals, seals, signatures,
> interface screenshots, browser or phone UI, documents, autobiographical
> claims, event-specific clues, recognizable copyrighted characters, clutter,
> photoreal evidence, or anything that could be mistaken for proof of a real
> event.
