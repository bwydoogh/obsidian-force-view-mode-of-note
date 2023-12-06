import {
  WorkspaceLeaf,
  Plugin,
  MarkdownView,
  App,
  TFile,
  TFolder,
  PluginSettingTab,
  Setting,
  debounce,
} from "obsidian";

interface ViewModeByFrontmatterSettings {
  debounceTimeout: number;
  ignoreOpenFiles: boolean;
  ignoreForceViewAll: boolean;
  folders: {folder: string, viewMode: string}[];
}

const DEFAULT_SETTINGS: ViewModeByFrontmatterSettings = {
  debounceTimeout: 300,
  ignoreOpenFiles: false,
  ignoreForceViewAll: false,
  folders: [{folder: '', viewMode: ''}]
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

      let state = leaf.getViewState();

      // check if in a declared folder
      let folderModeState: {source: boolean, mode: string} | null = null;

      for (const folderMode of this.settings.folders) {
        if (folderMode.folder !== '' && folderMode.viewMode) {
          const folder = this.app.vault.getAbstractFileByPath(folderMode.folder);
          if (folder instanceof TFolder) {
            if (view.file.parent === folder || view.file.parent.path.startsWith(folder.path)) {
              if (!state.state) { // just to be on the safe side
                continue
              }
                
              const [key, mode] = folderMode.viewMode.split(':').map((s) => s.trim());
              
              if (key === "default") {
                folderModeState = null; // ensures that no state is set
                continue
              } else if (!["live", "preview", "source"].includes(mode)) {
                continue
              }

              folderModeState = {...state.state}

              folderModeState.mode = mode

              switch (key) {
                case this.OBSIDIAN_EDITING_MODE_KEY: {
                  if (mode == "live") {
                    folderModeState.source = false
                    folderModeState.mode = 'source'
                  } else {
                    folderModeState.source = true
                  }
                  break;
                }
                case this.OBSIDIAN_UI_MODE_KEY: 
                  folderModeState.source = false
                  break;
              }

            }
          } else {
            console.warn(`ForceViewMode: Folder ${folderMode.folder} does not exist or is not a folder.`);
           }
        }
      }

      if (folderModeState) {
        if (state.state.mode !== folderModeState.mode || 
          state.state.source !== folderModeState.source) {
          state.state.mode = folderModeState.mode;
          state.state.source = folderModeState.source;

          await leaf.setViewState(state);
        }

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
        await leaf.setViewState(state);

        if (true == this.settings.ignoreOpenFiles) {
          this.openedFiles = resetOpenedNotes(this.app);
        }

        return;
      }

      const defaultViewMode = this.app.vault.config.defaultViewMode
        ? this.app.vault.config.defaultViewMode
        : "source";

      const defaultEditingModeIsLivePreview = this.app.vault.config.livePreview === undefined ? true : this.app.vault.config.livePreview;

      if (!this.settings.ignoreForceViewAll) {
        let state = leaf.getViewState();

        if (view.getMode() !== defaultViewMode) {
          state.state.mode = defaultViewMode;
        }

        state.state.source = defaultEditingModeIsLivePreview ? false : true;

        await leaf.setViewState(state);

        this.openedFiles = resetOpenedNotes(this.app);
      }

      return;
    };

    // "active-leaf-change": open note, navigate to note -> will check whether
    // the view mode needs to be set; default view mode setting is ignored.
    this.registerEvent(
      this.app.workspace.on(
        "active-leaf-change",
        this.settings.debounceTimeout === 0
          ? readViewModeFromFrontmatterAndToggle
          : debounce(
              readViewModeFromFrontmatterAndToggle,
              this.settings.debounceTimeout
            )
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

    const createHeader = (text: string) => containerEl.createEl("h2", { text });

    const desc = document.createDocumentFragment();
    desc.append(
      "Changing the view mode can be done through the key ",
      desc.createEl("code", { text: "obsidianUIMode" }),
      ", which can have the value ",
      desc.createEl("code", { text: "source" }),
      " or ",
      desc.createEl("code", { text: "preview" }),
      ".",
      desc.createEl("br"),
      "Changing the editing mode happens by declaring the key ",
      desc.createEl("code", { text: "obsidianEditingMode" }),
      "; it takes ",
      desc.createEl("code", { text: "live" }),
      " or ",
      desc.createEl("code", { text: "source" }),
      " as value."
    );

    new Setting(this.containerEl).setDesc(desc);

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

    new Setting(containerEl)
        .setName("Debounce timeout in milliseconds")
        .setDesc(`Debounce timeout is the time in milliseconds after which the view mode is set. Set "0" to disable debouncing (default value is "300"). If you experience issues with the plugin, try increasing this value.`)
        .addText((cb) => {
            cb.setValue(String(this.plugin.settings.debounceTimeout)).onChange(async (value) => {
                this.plugin.settings.debounceTimeout = Number(value);

                await this.plugin.saveSettings();
            });
        });

    createHeader("Folders")

    const folderDesc = document.createDocumentFragment();
    folderDesc.append(
        "Specify a view mode for notes in a given folder.",
        folderDesc.createEl("br"),
        "Note that this will force the view mode on all the notes in the folder, even if they have a different view mode set in their frontmatter.",
        folderDesc.createEl("br"),
        "Precedence is from bottom (highest) to top (lowest), so if you have child folders specified, make sure to put them below their parent folder."
    );

    new Setting(this.containerEl).setDesc(folderDesc);

    new Setting(this.containerEl)
      .setDesc("Add new folder")
      .addButton((button) => {
        button
          .setTooltip("Add another folder to the list")
          .setButtonText("+")
          .setCta()
          .onClick(async () => {
            this.plugin.settings.folders.push({
              folder: "",
              viewMode: "",
            });
            await this.plugin.saveSettings();
            this.display();
          });
      });


    this.plugin.settings.folders.forEach(
      (folderMode, index) => {
        const div = containerEl.createEl("div");
        div.addClass("force-view-mode-div")
        div.addClass("force-view-mode-folder")

        const s = new Setting(this.containerEl)
          .addSearch((cb) => {
            cb.setPlaceholder("Example: folder1/templates")
              .setValue(folderMode.folder)
              .onChange(async (newFolder) => {
                if (
                  newFolder &&
                  this.plugin.settings.folders.some(
                    (e) => e.folder == newFolder
                  )
                ) {
                  console.error("ForceViewMode: This folder already has a template associated with", newFolder);

                  return;
                }

                this.plugin.settings.folders[
                  index
                ].folder = newFolder;

                await this.plugin.saveSettings();
              });
          })
          .addDropdown(cb => {
            const modes = [
              "default",
              "obsidianUIMode: preview",
              "obsidianUIMode: source",
              "obsidianEditingMode: live",
              "obsidianEditingMode: source",
            ]

            modes.forEach(mode => {
              cb.addOption(mode, mode);
            });

            cb.setValue(folderMode.viewMode || "default")
              .onChange(async (value) => {
                this.plugin.settings.folders[
                  index
                ].viewMode = value;

                await this.plugin.saveSettings();
              });
          })
          .addExtraButton((cb) => {
            cb.setIcon("cross")
              .setTooltip("Delete")
              .onClick(async () => {
                this.plugin.settings.folders.splice(
                  index,
                  1
                );

                await this.plugin.saveSettings();
                
                this.display();
              });
          });
        
        s.infoEl.remove();

        div.appendChild(containerEl.lastChild as Node);
      }
    );
  }
}
