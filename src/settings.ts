import { App, PluginSettingTab, Setting, TextComponent, ButtonComponent, ToggleComponent, DropdownComponent } from "obsidian";
import KOReaderSyncPlugin from "./main";

export interface KOReaderSyncSettings {
  sourceType: "local";
  sourceFolder: string;

  targetFolder: string;
  oneNotePerBook: boolean;
  orderHighlightsBy: "page" | "time";

  colorMap: Record<string, string[]>;
  applyColorTags: boolean;
}

export const DEFAULT_SETTINGS: KOReaderSyncSettings = {
  sourceType: "local",
  sourceFolder: "/Volumes/KOBO/koreader/clipboard",

  targetFolder: "Reading/Highlights",
  oneNotePerBook: true,
  orderHighlightsBy: "page",

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

    // Local folder
    new Setting(containerEl)
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
      .setName("Highlight order")
      .setDesc("Sort highlights by page number or by creation time.")
      .addDropdown((dd: DropdownComponent) => {
        dd.addOption("page", "Page");
        dd.addOption("time", "Time");
        dd.setValue(this.plugin.settings.orderHighlightsBy);
        dd.onChange(async (v: string) => {
          this.plugin.settings.orderHighlightsBy = v as "page" | "time";
          await this.plugin.saveSettings();
        });
      });
    // Warning: changing order requires re-import
    containerEl.createEl("div", {
      cls: "mod-warning",
      text: "After changing highlight order, run the import again to regenerate notes with the new ordering."
    });

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
}
