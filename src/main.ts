// src/main.ts
import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginManifest
} from "obsidian";

import { KOReaderSyncSettings, KOSyncSettingTab, DEFAULT_SETTINGS } from "./settings";
import { importAll, type ImportSummary } from "./importer";

/**
 * Optional: define the type your importer returns so main.ts can show nice counts.
 * If you already export this from importer.ts, remove the duplicate here.
 */
// export type ImportSummary = {
//   created: number;
//   updated: number;
//   skipped: number;
//   errors: number;
//   source: "local" | "webdav" | "usb";
//   details?: Array<{ file: string; status: "created" | "updated" | "skipped" | "error"; reason?: string }>;
// };

export default class KOReaderSyncPlugin extends Plugin {
  settings: KOReaderSyncSettings;
  statusBar: any | null = null;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload() {
    // 1) Load settings
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // 2) Setting tab
    this.addSettingTab(new KOSyncSettingTab(this.app, this));

    // 3) Status bar
    this.statusBar = this.addStatusBarItem();
    this.setStatus("KO-Sync ready");

    // 4) Commands
    this.addCommand({
      id: "ko-sync-import",
      name: "Import KOReader highlights",
      callback: async () => {
        await this.runImport({ dryRun: false });
      }
    });

    this.addCommand({
      id: "ko-sync-preview",
      name: "Preview (dry run) import",
      callback: async () => {
        await this.runImport({ dryRun: true });
      }
    });

    // 5) Optional ribbon icon
    this.addRibbonIcon("highlighter", "KO-Sync: Import now", async () => {
      await this.runImport({ dryRun: false });
    });

    // 6) Optional: watch mode (file system changes in vault only).
    // If you later implement a local "inbox" folder inside the vault (e.g., _inbox/koreader),
    // you can register a file system event here to auto-trigger imports.
    // this.registerEvent(this.app.vault.on("create", file => { ... }));
  }

  onunload() {
    this.setStatus("KO-Sync unloaded");
  }

  /** Persist plugin settings */
  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Small helper to show status bar messages */
  private setStatus(text: string) {
    if (this.statusBar) this.statusBar.setText(text);
  }

  /** Centralized import runner with UI + errors */
  private async runImport(opts: { dryRun: boolean }) {
    const mode = opts.dryRun ? "dry-run" : "import";
    this.setStatus(`KO-Sync ${mode} running…`);
    let summary: ImportSummary | null = null;

    try {
      summary = await importAll(this.app, this.settings, { dryRun: opts.dryRun });

      // Status + Notice
      const msg = `KO-Sync ${opts.dryRun ? "(preview)" : ""}: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped${summary.errors ? `, ${summary.errors} errors` : ""}`;
      new Notice(msg, 6000);
      this.setStatus(msg);

      // If dry-run, show a preview modal with the file list
      if (opts.dryRun) {
        new PreviewModal(this.app, summary).open();
      }
    } catch (e: any) {
      console.error("[KO-Sync] Import failed:", e);
      new Notice("KO-Sync: import failed — see console", 8000);
      this.setStatus("KO-Sync error: import failed");
    }
  }
}

/** Simple preview modal for dry runs */
class PreviewModal extends Modal {
  summary: ImportSummary;

  constructor(app: App, summary: ImportSummary) {
    super(app);
    this.summary = summary;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "KO-Sync Preview" });

    const top = contentEl.createEl("p");
    top.setText(
      `Would create ${this.summary.created}, update ${this.summary.updated}, skip ${this.summary.skipped}.` +
      (this.summary.errors ? ` ${this.summary.errors} errors detected.` : "")
    );

    if (this.summary.details?.length) {
      const list = contentEl.createEl("ul");
      for (const d of this.summary.details) {
        const li = list.createEl("li");
        li.setText(`${d.status.toUpperCase()}: ${d.file}${d.reason ? ` — ${d.reason}` : ""}`);
      }
    } else {
      contentEl.createEl("p", { text: "No per-file details available." });
    }

    const hint = contentEl.createEl("p", { cls: "mod-warning" });
    hint.setText("Close this preview and run “Import KOReader highlights” to apply changes.");
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
