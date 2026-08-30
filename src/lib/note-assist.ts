import { normalizeTags, type ProofCategory, type ProofItem } from "./proof";

// Small, transparent local rules, not an AI assessment of a person or event.
const STOP_WORDS = new Set("a an and are as at be been but by did do for from had has have i in is it its just like me my of on or our saw so some that the their them there these they this to was we were what when while with you your photo image screenshot memory note proof today yesterday really very then feel felt feeling good bad happy sad".split(" "));
const CATEGORY_CUES: readonly [ProofCategory, readonly string[]][] = [
  ["awards", ["award", "awarded", "prize"]],
  ["parenting", ["parenting", "my daughter", "my son", "my child"]],
  ["kindness_received", ["complimented me", "thanked me", "kind message"]],
  ["shipped", ["shipped", "published", "completed", "finished"]],
  ["money", ["payment", "paid", "receipt"]],
  ["creativity", ["painting", "drawing", "song", "poem", "music"]],
  ["competence", ["hired", "promoted", "trusted"]],
  ["recovery", ["recovery", "recovered"]],
  ["belonging", ["sister", "brother", "family", "friend", "friends", "together", "invited"]],
];
const NEGATION = /\b(no|not|never|without|cannot|[a-z]+n't|unpaid|rejected)\b/i;

export function noteWords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}]+/gu) ?? [])
    .filter(word => word.length >= 3 && word.length <= 40 && !STOP_WORDS.has(word)))].slice(0, 80);
}

export function suggestNoteOrganization(note: string): {
  title: string; category: ProofCategory | null; cue: string | null; tags: string[];
} {
  const sentences = note.toLowerCase().replace(/[’]/g, "'").split(/[.!?\n]+/);
  const matches = CATEGORY_CUES.flatMap(([category, cues]) => {
    const cue = cues.find(cue => sentences.some(sentence => !NEGATION.test(sentence) &&
      ` ${sentence.replace(/[^\p{L}' ]/gu, " ").replace(/\s+/g, " ")} `.includes(` ${cue} `)));
    return cue ? [{ category, cue }] : [];
  });
  // Conflicting cues require a person's choice, not a hidden priority order.
  const match = matches.length === 1 ? matches[0] : null;
  const title = note.trim().replace(/\s+/g, " ");
  return {
    title: title.length > 100 ? `${title.slice(0, 99)}…` : title,
    category: match?.category ?? null, cue: match?.cue ?? null,
    tags: normalizeTags(noteWords(note).slice(0, 6)),
  };
}

export type ConnectionSeed = { id: string; userId: string; evidenceText: string; tags: string[]; person: string | null; project: string | null };
export type RelatedProof = { item: ProofItem; sharedWords: string[] };

/** Already-loaded saved Proof only. Never queries another store or source. */
export function relatedSavedProof(seed: ConnectionSeed, saved: readonly ProofItem[]): RelatedProof[] {
  const words = new Set(noteWords([seed.evidenceText, ...seed.tags, seed.person, seed.project].filter(Boolean).join(" ")));
  if (!words.size) return [];
  return saved.filter(item => item.id !== seed.id && item.userId === seed.userId && item.visibility === "personal" && typeof item.evidenceText === "string")
    .map(item => ({ item, sharedWords: noteWords([item.evidenceText, ...item.tags, item.person, item.project].filter(Boolean).join(" ")).filter(word => words.has(word)) }))
    .filter(match => match.sharedWords.length > 0)
    .sort((a, b) => b.sharedWords.length - a.sharedWords.length || a.item.id.localeCompare(b.item.id))
    .slice(0, 6);
}

/** A derived reading order, never a generated or persisted autobiographical claim. */
export function storySequence(items: readonly ProofItem[], selectedIds: readonly string[], ownerId: string): ProofItem[] {
  const selected = new Set(selectedIds);
  return items.filter(item => selected.has(item.id) && item.userId === ownerId && item.visibility === "personal")
    .sort((a, b) => {
      if (!a.occurredOn) return b.occurredOn ? 1 : a.id.localeCompare(b.id);
      if (!b.occurredOn) return -1;
      return a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id);
    }).slice(0, 7);
}
