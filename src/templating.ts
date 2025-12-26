/**
 * Render a complete Markdown file for a book with YAML frontmatter and
 * per-highlight sections. Compatible with importer.ts call.
 */

type HighlightIn = {
  text: string;
  note?: string;
  color?: string;
  page?: number;
  location?: string;
  created?: string;
  chapter?: string;
  // Enriched fields (optional)
  _id?: string;
  _color?: string | null;
  _colorTags?: string[];
  _tagsFromNote?: string[];
  _linksFromNote?: string[];
};

type YAMLInput = {
  title?: string;
  author?: string;
  source?: string;
  updated?: string;          // YYYY-MM-DD suggested
  tags?: string[];
  koreader?: Record<string, unknown>;
};

type RenderInput = {
  title: string;
  author: string;
  highlights: HighlightIn[];
  yaml?: YAMLInput;
};

export function renderBookMarkdown(input: RenderInput): string {
  const { title, author } = input;

  // Build YAML frontmatter
  const yaml = buildYamlFrontmatter({
    title: input.yaml?.title ?? title,
    author: input.yaml?.author ?? author,
    source: input.yaml?.source ?? "KOReader",
    updated: input.yaml?.updated ?? todayISO(),
    tags: dedupeSort([...(input.yaml?.tags ?? [])]),
    koreader: input.yaml?.koreader ?? {},
  });

  // Document header
  const headerLines = [
    `# ${safeInline(title)} - ${safeInline(author)}`,
    "",
  ];

  // Render highlights
  const blocks: string[] = [];
  input.highlights.forEach((h, i) => {
    blocks.push(renderHighlightBlock(h, i));
  });

  // Assemble file
  const body = blocks.join("\n\n---\n\n");
  return `${yaml}\n${headerLines.join("\n")}${body ? body + "\n" : ""}`;
}

/* -------------------- Highlight block -------------------- */

function renderHighlightBlock(h: HighlightIn, index: number): string {
   // Show color in metadata, not in the heading
  const label = "";
  const tagString = h._colorTags?.length
    ? h._colorTags.map((t) => t.replace(/^#/, "")).map((t) => `#${t}`).join(" ")
    : null;

  const pageChapter =
    h.page != null
      ? `p.${h.page}${h.chapter ? `, chapter: "${safeInline(h.chapter)}"` : ""}`
      : h.chapter
      ? `chapter: "${safeInline(h.chapter)}"`
      : null;

  const metaBits = [
    pageChapter,
    h.location ? `loc ${h.location}` : null,
    h.created ? isoDate(h.created) : null,
    h._color ? `color:${h._color}` : null,
    tagString,
  ]
    .filter(Boolean)
    .join(" | ");

  const lines: string[] = [];
  lines.push(`## Highlight ${index + 1}${label}`);
  if (metaBits) lines.push(`*${metaBits}*`, "");

  // Quote block
  const text = (h.text ?? "").trim();
  if (text) {
    lines.push(blockQuote(text));
  } else {
    lines.push("> "); // keep structure even if empty
  }

  // Optional note
  const note = (h.note ?? "").trim();
  if (note) {
    lines.push("", `**Note:** ${note}`);
  }

  return lines.join("\n");
}

/* -------------------- YAML frontmatter -------------------- */

function buildYamlFrontmatter(obj: YAMLInput): string {
  const rows: string[] = ["---"];

  if (obj.title != null) rows.push(`title: "${yamlEscape(obj.title)}"`);
  if (obj.author != null) rows.push(`author: "${yamlEscape(obj.author)}"`);
  if (obj.source != null) rows.push(`source: ${yamlScalar(obj.source)}`);
  if (obj.updated != null) rows.push(`updated: ${yamlScalar(obj.updated)}`);

  if (obj.tags && obj.tags.length) {
    rows.push(`tags: [${obj.tags.map(yamlScalar).join(", ")}]`);
  }

  if (obj.koreader && Object.keys(obj.koreader).length) {
    rows.push("koreader:");
    rows.push(...indentYamlLines(serialiseYamlBlock(obj.koreader), 2));
  }

  rows.push("---", "");
  return rows.join("\n");
}

// Minimal YAML serialization used in frontmatter
function serialiseYamlBlock(value: unknown): string[] {
  if (value == null) return ["null"];
  if (Array.isArray(value)) {
    if (value.length === 0) return ["[]"];
    return ["[" + value.map(yamlScalar).join(", ") + "]"];
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return [yamlScalar(value)];
    case "object": {
      const obj = value as Record<string, unknown>;
      const lines: string[] = [];
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === "object" && !Array.isArray(v)) {
          lines.push(`${k}:`);
          lines.push(...indentYamlLines(serialiseYamlBlock(v), 2));
        } else {
          lines.push(`${k}: ${yamlScalar(v as any)}`);
        }
      }
      return lines;
    }
    default:
      return [yamlScalar(String(value))];
  }
}

function yamlScalar(v: string | number | boolean): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `"${yamlEscape(v)}"`;
}

function yamlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function indentYamlLines(lines: string[], spaces = 2): string[] {
  const pad = " ".repeat(spaces);
  return lines.map((l) => (l.length ? pad + l : l));
}

/* -------------------- Helpers -------------------- */

function blockQuote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");
}

function isoDate(s: string): string {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeInline(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function dedupeSort(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}
