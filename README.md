# KOReader Highlights Importer (Obsidian)

Import KOReader highlights and notes into Obsidian as tidy, per-book Markdown files. Local-only: reads KOReader-exported JSON from a folder you choose and writes notes into your vault.

## What it does
- Reads KOReader JSON exports (clipboard-style `entries/files` or classic `{ book, highlights }`).
- Creates or updates one note per book, idempotently (skips if unchanged).
- Extracts notes attached to highlights, plus `#tags` and `[[links]]` inside those notes.
- Adds color → tags based on a configurable map; tags render as `#tag` in the meta line.
- Lets you choose highlight ordering (by page or by creation time).
- Desktop-only; no network usage.

## Build & install
1) Install deps: `npm install`
2) Build: `npm run build` (outputs `main.js` at repo root)
3) Copy `main.js` + `manifest.json` to your vault folder:
   `<Vault>/.obsidian/plugins/koreader-to-obsidian/`
4) Enable the plugin in Obsidian settings.

## Configure (Settings → KOReader Sync)
- **Local source folder**: Absolute path to KOReader JSON exports (e.g., your clipboard export folder).
- **Target folder in vault**: Where generated Markdown should be written.
- **One note per book**: Toggle to keep a single note per book.
- **Highlight order**: `Page` or `Time` (re-run import after changing to re-order existing notes; warning shown in UI).
- **Apply color → tags**: Add tags per highlight color.
- **Color → Tags map**: Edit/add rows to map KOReader colors to tags (enter tags without `#`; they render as `#tag`).

## Commands (Command Palette)
- **Import KOReader highlights**: Runs the import and writes/updates notes.
- **Preview (dry run) import**: Shows what would be created/updated/skipped without writing files.

## Example output
```markdown
---
title: "The Rust Cathedral"
author: "Ada Gearwright"
source: "KOReader"
updated: "2025-10-29"
tags: ["highlights", "reading", "hl/reference"]
koreader:
  import_source: "local"
  src_path: "/path/to/example.json"
  counts:
    highlights: 2
    notes: 1
---

# The Rust Cathedral - Ada Gearwright

## Highlight 1
*p.76, chapter: "Industrial Hymns" | 2024-09-22 | color:orange | #hl/reference*
> Every machine dreams of rust.

## Highlight 2
*p.80 | 2024-09-22 | color:green | #hl/reference*
> To build is to forget what once stood.
```
---

## Tips & notes
- Re-run the import after changing highlight order to regenerate existing notes with the new sorting.
- Tags inside notes (`#tag`) and wiki links (`[[Link]]`) are extracted and merged into the output; color tags come from your map.
- The importer is idempotent: if the generated content matches the existing file, it is skipped.***

## Future Optimizations
- Add a way to import/sync online from a cloud service like Dropbox or WebDAV.
- Add color blocks according to color option.
