/**
 * Extract #tags and [[wiki links]] from a KOReader note string.
 * - Tags: Unicode-aware, letters/numbers/_/-, ignoring leading whitespace.
 * - Wiki links: supports aliases like [[Page Title|Alias]] → "Page Title".
 */

export type NoteParseResult = {
  tags: Set<string>;
  links: Set<string>;
};

export function extractFromNote(note?: string | null): NoteParseResult {
  const tags = new Set<string>();
  const links = new Set<string>();

  if (!note || !note.trim()) return { tags, links };

  // #tags — allow unicode letters/numbers, underscore and hyphen
  // Uses Unicode property escapes; ensure tsconfig "target": ES2020+ and Node supports it.
  const tagRe = /(^|\s)#([\p{L}\p{N}_-]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(note)) !== null) {
    const raw = m[2]?.trim();
    if (!raw) continue;
    // Prevent accidental trailing punctuation (#tag,) → #tag
    const clean = raw.replace(/[.,;:!?]+$/, "");
    if (clean) tags.add(clean);
  }

  // [[Wiki Links]] — capture before "|alias" if present
  const linkRe = /\[\[([^[\]|]+)(?:\|[^[\]]+)?\]\]/g;
  while ((m = linkRe.exec(note)) !== null) {
    const target = m[1]?.trim();
    if (target) links.add(target);
  }

  return { tags, links };
}