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
  files: {filePattern: string; viewMode: string}[];
}

const DEFAULT_SETTINGS: ViewModeByFrontmatterSettings = {
  debounceTimeout: 300,
  ignoreOpenFiles: false,
  ignoreForceViewAll: false,
  folders: [{folder: '', viewMode: ''}],
  files: [{filePattern: '', viewMode: ''}],
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

      // check if in a declared folder or file
      let folderOrFileModeState: {source: boolean, mode: string} | null = null;

      const setFolderOrFileModeState = (viewMode: string): void => {
        const [key, mode] = viewMode.split(":").map((s) => s.trim());

        if (key === "default") {
          folderOrFileModeState = null; // ensures that no state is set
          return;
        } else if (!["live", "preview", "source"].includes(mode)) {
          return;
        }

        folderOrFileModeState = { ...state.state };

        folderOrFileModeState.mode = mode;

        switch (key) {
          case this.OBSIDIAN_EDITING_MODE_KEY: {
            if (mode == "live") {
              folderOrFileModeState.source = false;
              folderOrFileModeState.mode = "source";
            } else {
              folderOrFileModeState.source = true;
            }
            break;
          }
          case this.OBSIDIAN_UI_MODE_KEY:
            folderOrFileModeState.source = false;
            break;
        }
      };

      for (const folderMode of this.settings.folders) {
        if (folderMode.folder !== '' && folderMode.viewMode) {
          const folder = this.app.vault.getAbstractFileByPath(folderMode.folder);
          if (folder instanceof TFolder) {
            if (view.file.parent === folder || view.file.parent.path.startsWith(folder.path)) {
              if (!state.state) { // just to be on the safe side
                continue
              }

              setFolderOrFileModeState(folderMode.viewMode);
            }
          } else {
            console.warn(`ForceViewMode: Folder ${folderMode.folder} does not exist or is not a folder.`);
           }
        }
      }

      for (const { filePattern, viewMode } of this.settings.files) {
        if (!filePattern || !viewMode) {
          continue;
        }

        if (!state.state) {
          // just to be on the safe side
          continue;
        }

        if (!view.file.basename.match(filePattern)) {
          continue;
        }

        setFolderOrFileModeState(viewMode);
      }

      if (folderOrFileModeState) {
        if (state.state.mode !== folderOrFileModeState.mode || 
          state.state.source !== folderOrFileModeState.source) {
          state.state.mode = folderOrFileModeState.mode;
          state.state.source = folderOrFileModeState.source;

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

    const modes = [
      "default",
      "obsidianUIMode: preview",
      "obsidianUIMode: source",
      "obsidianEditingMode: live",
      "obsidianEditingMode: source",
    ]

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
 
    createHeader("Files");

    const filesDesc = document.createDocumentFragment();
    filesDesc.append(
      "Specify a view mode for notes with specific patterns (regular expression; example \" - All$\" for all notes ending with \" - All\" or \"1900-01\" for all daily notes starting with \"1900-01\"",
      filesDesc.createEl("br"),
      "Note that this will force the view mode, even if it have a different view mode set in its frontmatter.",
      filesDesc.createEl("br"),
      "Precedence is from bottom (highest) to top (lowest).",
      filesDesc.createEl("br"),
      "Notice that configuring a file pattern will override the folder configuration for the same file."
    );

    new Setting(this.containerEl).setDesc(filesDesc);

    new Setting(this.containerEl)
      .setDesc("Add new file")
      .addButton((button) => {
        button
          .setTooltip("Add another file to the list")
          .setButtonText("+")
          .setCta()
          .onClick(async () => {
            this.plugin.settings.files.push({
              filePattern: "",
              viewMode: "",
            });
            await this.plugin.saveSettings();
            this.display();
          });
      });

    this.plugin.settings.files.forEach((file, index) => {
      const div = containerEl.createEl("div");
      div.addClass("force-view-mode-div");
      div.addClass("force-view-mode-folder");

      const s = new Setting(this.containerEl)
        .addSearch((cb) => {
          cb.setPlaceholder(`Example: " - All$" or "1900-01")`)
            .setValue(file.filePattern)
            .onChange(async (value) => {
              if (
                value &&
                this.plugin.settings.files.some((e) => e.filePattern == value)
              ) {
                console.error("ForceViewMode: Pattern already exists", value);

                return;
              }

              this.plugin.settings.files[index].filePattern = value;

              await this.plugin.saveSettings();
            });
        })
        .addDropdown((cb) => {
          modes.forEach((mode) => {
            cb.addOption(mode, mode);
          });

          cb.setValue(file.viewMode || "default").onChange(async (value) => {
            this.plugin.settings.files[index].viewMode = value;

            await this.plugin.saveSettings();
          });
        })
        .addExtraButton((cb) => {
          cb.setIcon("cross")
            .setTooltip("Delete")
            .onClick(async () => {
              this.plugin.settings.files.splice(index, 1);

              await this.plugin.saveSettings();

              this.display();
            });
        });

      s.infoEl.remove();

      div.appendChild(containerEl.lastChild as Node);
    });
  }
}
