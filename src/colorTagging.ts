export function normalizeColor(c?: string): string | null {
  if (!c) return null;
  return c.trim().toLowerCase();
}

export function tagsForColor(
  color: string | null,
  map: Record<string, string[]>
): string[] {
  if (!color) return [];
  const tags = map[color] ?? map[color.replace(/\s+/g, "")] ?? [];
  return Array.from(new Set(tags)); // dedupe
}

// Merge into an existing tag set (frontmatter or per-highlight)
export function mergeTags(existing: Iterable<string>, extra: Iterable<string>): string[] {
  const s = new Set(existing);
  for (const t of extra) if (t) s.add(t);
  return Array.from(s).sort();
}