// src/importer.ts
import { App, TFile, normalizePath } from "obsidian";
import * as fs from "fs/promises";
import * as path from "path";
import { KOReaderSyncSettings } from "./settings";
import { renderBookMarkdown } from "./templating";
import { extractFromNote } from "./noteParsing";
import { normalizeColor, tagsForColor, mergeTags } from "./colorTagging";

// ---------- Public API ----------

export type ImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  source: "local" | "webdav" | "usb";
  details: Array<{
    file: string; // vault-relative markdown path
    status: "created" | "updated" | "skipped" | "error";
    reason?: string; // error or skip reason
    srcJson?: string; // source json path (for debugging)
  }>;
};

export async function importAll(
  app: App,
  settings: KOReaderSyncSettings,
  opts: { dryRun: boolean }
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    created: 0, updated: 0, skipped: 0, errors: 0,
    source: settings.sourceType,
    details: []
  };

  try {
    const sources = await listJsonSources(settings);
    for (const s of sources) {
      try {
        const data = await readKOReaderJson(settings, s);
        const books = normalizeKOReaderJsonMany(data);

        for (const b of books) {
          const enriched = enrichBook(b, settings);
          const outName = fileNameForBook(settings, enriched);
          const md = renderMarkdownForBook(enriched, settings, s.remotePath ?? s.localPath ?? "");

          const status = await createOrUpdate(app, outName, md, opts.dryRun);
          summary[status] += 1 as any; // increments created/updated/skipped
          summary.details.push({
            file: outName,
            status,
            srcJson: s.remotePath ?? s.localPath ?? undefined,
            reason: status === "skipped" ? "No changes" : undefined
          });
        }
      } catch (e: any) {
        summary.errors++;
        summary.details.push({
          file: "(unknown)",
          status: "error",
          reason: e?.message ?? String(e)
        });
        console.error("[KO-Sync] Source failed:", s, e);
      }
    }
  } catch (e: any) {
    summary.errors++;
    summary.details.push({
      file: "(batch)",
      status: "error",
      reason: e?.message ?? String(e)
    });
    console.error("[KO-Sync] Batch failed:", e);
  }

  return summary;
}

// ---------- Models & Normalization ----------

type KOHighlight = {
  text: string;
  note?: string;
  color?: string;
  page?: number;
  location?: string; // normalized to string
  created?: string;
};

type KOJson = {
  book?: {
    title?: string;
    author?: string | string[];
    authors?: string[];
    uid?: string;
  };
  highlights?: KOHighlight[];
  entries?: Array<{
    text: string;
    time?: number;
    color?: string;
    sort?: string;
    drawer?: string;
    page?: number;
    chapter?: string;
    note?: string;
    book?: string;
    author?: string;
    location?: string | number;
  }>;
  files?: Array<{ file: string; title?: string; author?: string } >;
};

// Internal normalized model used by our renderer
type KOBook = {
  title: string;
  author: string;
  uid?: string;
  highlights: Array<
    KOHighlight & {
      _id: string;        // stable id (hash of book + location + text)
      _color?: string | null;    // normalized color
      _colorTags?: string[];
      _tagsFromNote?: string[];
      _linksFromNote?: string[];
    }
  >;
  _counts: { highlights: number; notes: number };
};

function normalizeKOReaderJsonMany(raw: KOJson): KOBook[] {
  // Classic schema path
  if (raw.highlights && (raw.book || raw.highlights.length)) {
    const title = (raw.book?.title ?? "Unknown").trim();
    const authorArr = Array.isArray(raw.book?.authors)
      ? raw.book?.authors
      : (Array.isArray(raw.book?.author) ? (raw.book!.author as string[]) : undefined);
    const authorStr = authorArr ? authorArr.join(", ") : String(raw.book?.author ?? "Unknown");
    const author = authorStr.trim() || "Unknown";
    const uid = raw.book?.uid;

    const highlights = (raw.highlights ?? []).map((h) => ({
      text: h.text ?? "",
      note: h.note,
      color: h.color,
      page: h.page,
      location: typeof (h as any).location === "number" ? String((h as any).location) : ((h as any).location ?? ""),
      created: h.created,
    }));

    const withIds = highlights.map((h) => ({
      ...h,
      _id: stableHighlightId(uid ?? `${author}:${title}`, h.location ?? "", h.text ?? ""),
    }));

    return [
      {
        title,
        author,
        uid,
        highlights: withIds,
        _counts: {
          highlights: withIds.length,
          notes: withIds.filter((hh) => !!hh.note?.trim()).length,
        },
      },
    ];
  }

  // KOReader clipboard-like path
  if (Array.isArray(raw.entries) && raw.entries.length) {
    const fileMetaByTitle = new Map<string, { title?: string; author?: string }>();
    (raw.files ?? []).forEach((f) => {
      if (f.title) fileMetaByTitle.set(f.title, { title: f.title, author: f.author });
    });

    const groups = new Map<string, { title: string; author: string; items: any[] }>();
    for (const e of raw.entries) {
      const title = (e.book ?? "Unknown").trim();
      const inferredAuthor = e.author ?? fileMetaByTitle.get(title)?.author ?? "Unknown";
      const author = String(inferredAuthor).trim() || "Unknown";
      const key = `${title}@@${author}`;
      let g = groups.get(key);
      if (!g) { g = { title, author, items: [] }; groups.set(key, g); }
      g.items.push(e);
    }

    const books: KOBook[] = [];
    for (const { title, author, items } of groups.values()) {
      const highlights = items.map((e: any) => ({
        text: e.text ?? "",
        note: e.note ?? undefined,
        color: e.color,
        page: e.page,
        location: typeof e.location === "number" ? String(e.location) : (e.location ?? ""),
        created: typeof e.time === "number" ? new Date(e.time * 1000).toISOString() : undefined,
      }));

      const withIds = highlights.map((h) => ({
        ...h,
        _id: stableHighlightId(`${author}:${title}`, h.location ?? "", h.text ?? ""),
      }));

      books.push({
        title,
        author,
        highlights: withIds,
        _counts: { highlights: withIds.length, notes: withIds.filter((hh) => !!hh.note?.trim()).length },
      });
    }
    return books;
  }

  return [{ title: "Unknown", author: "Unknown", highlights: [], _counts: { highlights: 0, notes: 0 } }];
}

// ---------- Enrichment (colors, tags, links) ----------

function enrichBook(book: KOBook, settings: KOReaderSyncSettings): KOBook {
  const enriched = { ...book, highlights: [...book.highlights] };
  for (let i = 0; i < enriched.highlights.length; i++) {
    const h = enriched.highlights[i];
    const _color = normalizeColor(h.color);
    const _colorTags = settings.applyColorTags ? tagsForColor(_color, settings.colorMap) : [];
    const { tags, links } = extractFromNote(h.note);

    enriched.highlights[i] = {
      ...h,
      _color,
      _colorTags,
      _tagsFromNote: Array.from(tags),
      _linksFromNote: Array.from(links)
    };
  }
  return enriched;
}

// ---------- Rendering ----------

function renderMarkdownForBook(book: KOBook, settings: KOReaderSyncSettings, srcPath: string): string {
  // Aggregate tags for frontmatter
  const baseTags = ["reading", "highlights"];
  const collectedNoteTags = new Set<string>();
  const perHighlightColorTags: string[][] = [];

  for (const h of book.highlights) {
    (h._tagsFromNote ?? []).forEach(t => collectedNoteTags.add(t));
    perHighlightColorTags.push(h._colorTags ?? []);
  }

  const allColorTags = perHighlightColorTags.flat();
  const yamlTags = mergeTags(baseTags, [...Array.from(collectedNoteTags), ...allColorTags]);

  // Pass a richer shape to templating if you want, or just call your existing renderBookMarkdown
  // Here, we assume renderBookMarkdown reads highlight._color, _colorTags, etc. if present.
  const md = renderBookMarkdown({
    title: book.title,
    author: book.author,
    highlights: book.highlights,
    yaml: {
      title: book.title,
      author: book.author,
      source: "KOReader",
      updated: new Date().toISOString().slice(0, 10),
      tags: yamlTags,
      koreader: {
        import_source: settings.sourceType,
        src_path: srcPath,
        counts: book._counts
      }
    }
  });

  return md;
}

// ---------- Output path ----------

function fileNameForBook(settings: KOReaderSyncSettings, book: KOBook): string {
  const safeAuthor = safeSlug(book.author);
  const safeTitle = safeSlug(book.title);
  const file = `${safeAuthor} - ${safeTitle}.md`;
  const out = normalizePath(path.posix.join(settings.targetFolder, file));
  return out;
}

// ---------- Create/Update/Skip (idempotent) ----------

async function createOrUpdate(app: App, vaultPath: string, content: string, dryRun: boolean):
  Promise<"created" | "updated" | "skipped"> {

  const existing = app.vault.getAbstractFileByPath(vaultPath) as TFile | null;

  if (!existing) {
    if (dryRun) return "created";
    await ensureFolder(app, vaultPath);
    await app.vault.create(vaultPath, content);
    return "created";
  }

  // Compare contents — if identical, skip
  const current = await app.vault.read(existing);
  if (normalizeEOL(current) === normalizeEOL(content)) {
    return "skipped";
  }

  if (dryRun) return "updated";
  await app.vault.modify(existing, content);
  return "updated";
}

async function ensureFolder(app: App, fullPath: string) {
  const dir = fullPath.split("/").slice(0, -1).join("/");
  if (!dir) return;
  // createFolder is idempotent
  // @ts-ignore createFolder exists on vault adapter
  await app.vault.adapter?.mkdir?.(dir);
}

// ---------- Sources (Local / WebDAV) ----------

type JsonSource = { localPath?: string; remotePath?: string; kind: "local" | "webdav" };

async function listJsonSources(settings: KOReaderSyncSettings): Promise<JsonSource[]> {
  if (settings.sourceType === "local") {
    const entries = await fs.readdir(settings.sourceFolder, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith(".json"))
      .map(e => ({ localPath: path.join(settings.sourceFolder, e.name), kind: "local" as const }));
  }

  if (settings.sourceType === "webdav") {
    const client = await getWebDAV(settings);
    const base = settings.webdav?.basePath || "/";
    const entries = await client.getDirectoryContents(base);
    return (entries as any[])
      .filter(e => e.type === "file" && e.basename?.endsWith(".json"))
      .map(e => ({ remotePath: posixJoin(base, e.basename), kind: "webdav" as const }));
  }

  // Future: "usb" could be treated as local with a mount path
  return [];
}

async function readKOReaderJson(settings: KOReaderSyncSettings, src: JsonSource): Promise<KOJson> {
  if (src.kind === "local" && src.localPath) {
    const raw = await fs.readFile(src.localPath, "utf8");
    return JSON.parse(raw);
  }
  if (src.kind === "webdav" && src.remotePath) {
    const client = await getWebDAV(settings);
    const raw = await client.getFileContents(src.remotePath, { format: "text" });
    return JSON.parse(raw as string);
  }
  throw new Error("Unsupported source");
}

type WebDAVClient = any;
let _dav: WebDAVClient | null = null;
async function getWebDAV(settings: KOReaderSyncSettings): Promise<WebDAVClient> {
  if (_dav) return _dav;
  const url = settings.webdav?.url ?? "";
  const username = settings.webdav?.username ?? "";
  const password = settings.webdav?.password ?? "";
  if (!url || !username) throw new Error("WebDAV not configured");
  const mod: any = await import("webdav");
  const createClient = mod.createClient as (u: string, opts: { username: string; password: string }) => WebDAVClient;
  _dav = createClient(url, { username, password });
  return _dav;
}

// ---------- Utils ----------

function stableHighlightId(bookKey: string, location: string, text: string): string {
  return hash32(`${bookKey}::${location}::${text}`);
}

function safeSlug(s: string): string {
  return s
    .replace(/[\\\/:*?"<>|]/g, " ")     // remove illegal filename chars
    .replace(/\s+/g, " ")               // collapse spaces
    .trim()
    .slice(0, 120);                      // avoid ultra-long filenames
}

function normalizeEOL(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
}

// Tiny 32-bit FNV-1a hash (deterministic, fast)
function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// POSIX join for WebDAV paths
function posixJoin(a: string, b: string) {
  if (a.endsWith("/")) return a + b;
  return a + "/" + b;
}
