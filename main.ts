import {
  WorkspaceLeaf,
  Plugin,
  MarkdownView,
  App,
  TFile,
  PluginSettingTab,
  Setting,
  EventRef,
  debounce,
} from "obsidian";

interface ViewModeByFrontmatterSettings {
  ignoreOpenFiles: boolean;
  ignoreForceViewAll: boolean;
}

const DEFAULT_SETTINGS: ViewModeByFrontmatterSettings = {
  ignoreOpenFiles: false,
  ignoreForceViewAll: false,
};

export default class ViewModeByFrontmatterPlugin extends Plugin {
  settings: ViewModeByFrontmatterSettings;

  OBSIDIAN_UI_MODE_KEY = "obsidianUIMode";
  OBSIDIAN_EDITING_MODE_KEY = "obsidianEditingMode";

  openedFiles: String[];

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new ViewModeByFrontmatterSettingTab(this.app, this));

    this.openedFiles = resetOpenedNotes(this.app);

    const readViewModeFromFrontmatterAndToggle = async (
      leaf: WorkspaceLeaf
    ) => {
      let view = leaf.view instanceof MarkdownView ? leaf.view : null;

      if (null === view) {
        if (true == this.settings.ignoreOpenFiles) {
          this.openedFiles = resetOpenedNotes(this.app);
        }

        return;
      }

      // if setting is true, nothing to do if this was an open note
      if (
        true == this.settings.ignoreOpenFiles &&
        alreadyOpen(view.file, this.openedFiles)
      ) {
        this.openedFiles = resetOpenedNotes(this.app);

        return;
      }

      // ... get frontmatter data and search for a key indicating the desired view mode
      // and when the given key is present ... set it to the declared mode
      const fileCache = this.app.metadataCache.getFileCache(view.file);
      const fileDeclaredUIMode =
        fileCache !== null && fileCache.frontmatter
          ? fileCache.frontmatter[this.OBSIDIAN_UI_MODE_KEY]
          : null;
      const fileDeclaredEditingMode =
        fileCache !== null && fileCache.frontmatter
          ? fileCache.frontmatter[this.OBSIDIAN_EDITING_MODE_KEY]
          : null;

      let state = leaf.getViewState();

      if (fileDeclaredUIMode) {
        if (
          ["source", "preview", "live"].includes(fileDeclaredUIMode) &&
          view.getMode() !== fileDeclaredUIMode
        ) {
          state.state.mode = fileDeclaredUIMode;
        }
      }

      if (fileDeclaredEditingMode) {
        const shouldBeSourceMode = fileDeclaredEditingMode == 'source';
        if (
          ["source", "live"].includes(fileDeclaredEditingMode)
        ) {
          state.state.source = shouldBeSourceMode;
        }
      }

      if (fileDeclaredUIMode || fileDeclaredEditingMode) {
        leaf.setViewState(state);

        if (true == this.settings.ignoreOpenFiles) {
          this.openedFiles = resetOpenedNotes(this.app);
        }

        return;
      }

      const defaultViewMode = this.app.vault.config.defaultViewMode
        ? this.app.vault.config.defaultViewMode
        : "source";

      const defaultEditingModeIsLivePreview = this.app.vault.config.livePreview;

      if (!this.settings.ignoreForceViewAll) {
        let state = leaf.getViewState();

        if (view.getMode() !== defaultViewMode) {
          state.state.mode = defaultViewMode;
        }

        state.state.source = defaultEditingModeIsLivePreview ? false : true;

        leaf.setViewState(state);

        this.openedFiles = resetOpenedNotes(this.app);
      }

      return;
    };

    // "active-leaf-change": open note, navigate to note -> will check whether
    // the view mode needs to be set; default view mode setting is ignored.
    this.registerEvent(
      this.app.workspace.on(
        "active-leaf-change",
        debounce(readViewModeFromFrontmatterAndToggle, 300)
      )
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async onunload() {
    this.openedFiles = [];
  }
}

function alreadyOpen(currFile: TFile, openedFiles: String[]): boolean {
  const leavesWithSameNote: String[] = [];

  if (currFile == null) {
    return false;
  }

  openedFiles.forEach((openedFile: String) => {
    if (openedFile == currFile.basename) {
      leavesWithSameNote.push(openedFile);
    }
  });

  return leavesWithSameNote.length != 0;
}

function resetOpenedNotes(app: App): String[] {
  let openedFiles: String[] = [];

  app.workspace.iterateAllLeaves((leaf) => {
    let view = leaf.view instanceof MarkdownView ? leaf.view : null;

    if (null === view) {
      return;
    }

    openedFiles.push(leaf.view?.file?.basename);
  });

  return openedFiles;
}

class ViewModeByFrontmatterSettingTab extends PluginSettingTab {
  plugin: ViewModeByFrontmatterPlugin;

  constructor(app: App, plugin: ViewModeByFrontmatterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("Ignore opened files")
      .setDesc("Never change the view mode on a note which was already open.")
      .addToggle((checkbox) =>
        checkbox
          .setValue(this.plugin.settings.ignoreOpenFiles)
          .onChange(async (value) => {
            this.plugin.settings.ignoreOpenFiles = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Ignore force view when not in frontmatter")
      .setDesc(
        "Never change the view mode on a note that was opened from another one in a certain view mode"
      )
      .addToggle((checkbox) => {
        checkbox
          .setValue(this.plugin.settings.ignoreForceViewAll)
          .onChange(async (value) => {
            this.plugin.settings.ignoreForceViewAll = value;
            await this.plugin.saveSettings();
          });
      });
  }
}
