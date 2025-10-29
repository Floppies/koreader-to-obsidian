import { App, PluginSettingTab, Setting, TextComponent, ButtonComponent, DropdownComponent, ToggleComponent } from "obsidian";
import KOReaderSyncPlugin from "./main";

export interface KOReaderSyncSettings {
  sourceType: "local" | "webdav";
  sourceFolder: string;
  webdav?: { url: string; username: string; password: string; basePath: string };

  targetFolder: string;
  oneNotePerBook: boolean;

  colorMap: Record<string, string[]>;
  applyColorTags: boolean;
}

export const DEFAULT_SETTINGS: KOReaderSyncSettings = {
  sourceType: "local",
  sourceFolder: "/Volumes/KOBO/koreader/clipboard",
  webdav: { url: "", username: "", password: "", basePath: "/koreader/clipboard" },

  targetFolder: "Reading/Highlights",
  oneNotePerBook: true,

  colorMap: {
    yellow: ["hl/insight"],
    blue:   ["hl/reference"],
    pink:   ["hl/quote"],
    green:  ["hl/todo"],
  },
  applyColorTags: true,
};

export class KOSyncSettingTab extends PluginSettingTab {
  plugin: KOReaderSyncPlugin;
  constructor(app: App, plugin: KOReaderSyncPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "KOReader Sync" });

    // Source type
    new Setting(containerEl)
      .setName("Source type")
      .setDesc("Where to read KOReader JSON files from.")
      .addDropdown((dd: DropdownComponent) => {
        dd.addOption("local", "Local folder");
        dd.addOption("webdav", "WebDAV");
        dd.setValue(this.plugin.settings.sourceType);
        dd.onChange(async (v) => {
          this.plugin.settings.sourceType = v as any;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    // Local folder (visible when sourceType = local)
    const localWrap = containerEl.createDiv();
    localWrap.toggle(this.plugin.settings.sourceType === "local");
    new Setting(localWrap)
      .setName("Local source folder")
      .setDesc("Absolute path to KOReader JSON exports (e.g., clipboard folder).")
      .addText((t: TextComponent) => {
        t.setPlaceholder("C:/path/to/koreader/clipboard")
          .setValue(this.plugin.settings.sourceFolder)
          .onChange(async (v) => {
            this.plugin.settings.sourceFolder = v.trim();
            await this.plugin.saveSettings();
          });
      });

    // WebDAV settings (visible when sourceType = webdav)
    const wdWrap = containerEl.createDiv();
    wdWrap.toggle(this.plugin.settings.sourceType === "webdav");
    new Setting(wdWrap)
      .setName("WebDAV URL")
      .addText((t) => t.setPlaceholder("https://example.com/remote.php/dav/files/you/")
        .setValue(this.plugin.settings.webdav?.url ?? "")
        .onChange(async (v) => { this.ensureWebDAV(); this.plugin.settings.webdav!.url = v; await this.plugin.saveSettings(); }));
    new Setting(wdWrap)
      .setName("Username")
      .addText((t) => t.setValue(this.plugin.settings.webdav?.username ?? "")
        .onChange(async (v) => { this.ensureWebDAV(); this.plugin.settings.webdav!.username = v; await this.plugin.saveSettings(); }));
    new Setting(wdWrap)
      .setName("Password")
      .addText((t) => { t.inputEl.type = "password"; t.setValue(this.plugin.settings.webdav?.password ?? "").onChange(async (v) => { this.ensureWebDAV(); this.plugin.settings.webdav!.password = v; await this.plugin.saveSettings(); }); });
    new Setting(wdWrap)
      .setName("Base path")
      .setDesc("Remote directory containing JSON exports (e.g., /koreader/clipboard)")
      .addText((t) => t.setValue(this.plugin.settings.webdav?.basePath ?? "")
        .onChange(async (v) => { this.ensureWebDAV(); this.plugin.settings.webdav!.basePath = v; await this.plugin.saveSettings(); }));

    // Target folder in vault
    new Setting(containerEl)
      .setName("Target folder in vault")
      .setDesc("Where to save generated Markdown (vault-relative path).")
      .addText((t) => t.setPlaceholder("Reading/Highlights")
        .setValue(this.plugin.settings.targetFolder)
        .onChange(async (v) => { this.plugin.settings.targetFolder = v.trim(); await this.plugin.saveSettings(); }));

    // Toggles
    new Setting(containerEl)
      .setName("One note per book")
      .addToggle((tg: ToggleComponent) => tg.setValue(this.plugin.settings.oneNotePerBook)
        .onChange(async (v) => { this.plugin.settings.oneNotePerBook = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Apply color → tags")
      .setDesc("Add tags based on highlight color using the map below.")
      .addToggle((tg: ToggleComponent) => tg.setValue(this.plugin.settings.applyColorTags)
        .onChange(async (v) => { this.plugin.settings.applyColorTags = v; await this.plugin.saveSettings(); }));

    // Color → Tags map editor
    containerEl.createEl("h3", { text: "Color → Tags map" });
    const table = containerEl.createEl("div", { cls: "ko-color-table" });

    const renderRows = () => {
      table.empty();

      const header = table.createEl("div", { cls: "ko-row ko-header" });
      header.createEl("div", { text: "Color (name)", cls: "ko-cell ko-col-color" });
      header.createEl("div", { text: "Tags (comma-separated)", cls: "ko-cell ko-col-tags" });
      header.createEl("div", { text: "", cls: "ko-cell ko-col-actions" });

      const entries = Object.entries(this.plugin.settings.colorMap);
      entries.forEach(([color, tags]) => {
        const row = table.createEl("div", { cls: "ko-row" });

        const colorCell = row.createEl("div", { cls: "ko-cell ko-col-color" });
        const colorInput = new TextComponent(colorCell);
        colorInput.setPlaceholder("yellow").setValue(color);

        const tagsCell = row.createEl("div", { cls: "ko-cell ko-col-tags" });
        const tagsInput = new TextComponent(tagsCell);
        tagsInput.setPlaceholder("hl/idea, reading, quote").setValue(tags.join(", "));

        const actions = row.createEl("div", { cls: "ko-cell ko-col-actions" });
        new ButtonComponent(actions)
          .setButtonText("Save")
          .onClick(async () => {
            const newColor = colorInput.getValue().trim().toLowerCase();
            const list = tagsInput.getValue().split(",").map(s => s.trim()).filter(Boolean);
            if (!newColor) return;
            const map = { ...this.plugin.settings.colorMap };
            if (newColor !== color) delete map[color];
            map[newColor] = Array.from(new Set(list));
            this.plugin.settings.colorMap = map;
            await this.plugin.saveSettings();
            renderRows();
          });

        new ButtonComponent(actions)
          .setButtonText("Delete")
          .setCta()
          .onClick(async () => {
            const map = { ...this.plugin.settings.colorMap };
            delete map[color];
            this.plugin.settings.colorMap = map;
            await this.plugin.saveSettings();
            renderRows();
          });
      });

      const addRow = table.createEl("div", { cls: "ko-row" });
      const addColorCell = addRow.createEl("div", { cls: "ko-cell ko-col-color" });
      const addColorInput = new TextComponent(addColorCell).setPlaceholder("new color…");

      const addTagsCell = addRow.createEl("div", { cls: "ko-cell ko-col-tags" });
      const addTagsInput = new TextComponent(addTagsCell).setPlaceholder("tag1, tag2");

      const addActions = addRow.createEl("div", { cls: "ko-cell ko-col-actions" });
      new ButtonComponent(addActions)
        .setButtonText("Add")
        .onClick(async () => {
          const c = addColorInput.getValue().trim().toLowerCase();
          const list = addTagsInput.getValue().split(",").map(s => s.trim()).filter(Boolean);
          if (!c || list.length === 0) return;
          const map = { ...this.plugin.settings.colorMap };
          map[c] = Array.from(new Set([...(map[c] ?? []), ...list]));
          this.plugin.settings.colorMap = map;
          await this.plugin.saveSettings();
          addColorInput.setValue("");
          addTagsInput.setValue("");
          renderRows();
        });
    };

    renderRows();

    const style = document.createElement("style");
    style.textContent = `
      .ko-color-table { display: grid; gap: 6px; }
      .ko-row { display: grid; grid-template-columns: 180px 1fr 160px; gap: 8px; align-items: center; }
      .ko-header { font-weight: 600; opacity: .8; }
      .ko-cell input { width: 100%; }
    `;
    containerEl.appendChild(style);
  }

  private ensureWebDAV() {
    if (!this.plugin.settings.webdav) {
      this.plugin.settings.webdav = { url: "", username: "", password: "", basePath: "/" };
    }
  }
}

