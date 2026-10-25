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
  requireApiVersion,
  SettingDefinitionItem,
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

  openedFiles: string[];

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

      // only touch the view state when it actually changes; every call to
      // setViewState rebuilds the view, which undoes what other plugins did
      // to the tab (e.g. its title or icon)
      const setViewStateIfChanged = async (mode: string, source: boolean) => {
        if (state.state.mode === mode && state.state.source === source) {
          return;
        }

        state.state.mode = mode;
        state.state.source = source;

        await leaf.setViewState(state);
      };

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

      const defaultEditingModeIsLivePreview = this.app.vault.config.livePreview === undefined ? true : this.app.vault.config.livePreview;

      // editing mode to use when only the view mode is forced: the one declared
      // in frontmatter, otherwise the Obsidian default
      const editingModeIsSource = ["source", "live"].includes(fileDeclaredEditingMode)
        ? fileDeclaredEditingMode == "source"
        : !defaultEditingModeIsLivePreview;

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
            folderOrFileModeState.source = editingModeIsSource;
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
        await setViewStateIfChanged(folderOrFileModeState.mode, folderOrFileModeState.source);

        return;
      }

      if (fileDeclaredUIMode || fileDeclaredEditingMode) {
        const fileDeclaredUIModeIsValid = ["source", "preview", "live"].includes(fileDeclaredUIMode);
        const mode = fileDeclaredUIModeIsValid
          ? fileDeclaredUIMode
          : state.state.mode;
        // when the view mode is forced, fall back to the Obsidian default
        // editing mode instead of whatever the leaf happened to be in
        const source = fileDeclaredUIModeIsValid
          ? editingModeIsSource
          : ["source", "live"].includes(fileDeclaredEditingMode)
            ? fileDeclaredEditingMode == "source"
            : state.state.source;

        await setViewStateIfChanged(mode, source);

        if (true == this.settings.ignoreOpenFiles) {
          this.openedFiles = resetOpenedNotes(this.app);
        }

        return;
      }

      const defaultViewMode = this.app.vault.config.defaultViewMode
        ? this.app.vault.config.defaultViewMode
        : "source";

      if (!this.settings.ignoreForceViewAll) {
        await setViewStateIfChanged(defaultViewMode, !defaultEditingModeIsLivePreview);

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

  onunload() {
    this.openedFiles = [];
  }
}

function alreadyOpen(currFile: TFile, openedFiles: string[]): boolean {
  const leavesWithSameNote: string[] = [];

  if (currFile == null) {
    return false;
  }

  openedFiles.forEach((openedFile: string) => {
    if (openedFile == currFile.basename) {
      leavesWithSameNote.push(openedFile);
    }
  });

  return leavesWithSameNote.length != 0;
}

function resetOpenedNotes(app: App): string[] {
  let openedFiles: string[] = [];

  app.workspace.iterateAllLeaves((leaf) => {
    let view = leaf.view instanceof MarkdownView ? leaf.view : null;

    if (null === view) {
      return;
    }

    openedFiles.push(leaf.view?.file?.basename);
  });

  return openedFiles;
}

// the key is the stored value, the label what is shown in the dropdown
const VIEW_MODES: Record<string, string> = {
  "default": "default",
  "obsidianUIMode: preview": "obsidianUIMode: preview (reading view)",
  "obsidianUIMode: source": "obsidianUIMode: source (editing view)",
  "obsidianEditingMode: live": "obsidianEditingMode: live (live preview)",
  "obsidianEditingMode: source": "obsidianEditingMode: source (source mode)",
};

const IGNORE_OPEN_FILES = {
  name: "Ignore opened files",
  desc: "Never change the view mode on a note which was already open.",
};

const IGNORE_FORCE_VIEW_ALL = {
  name: "Ignore force view when not in frontmatter",
  desc: "Never change the view mode on a note that was opened from another one in a certain view mode",
};

const DEBOUNCE_TIMEOUT = {
  name: "Debounce timeout in milliseconds",
  desc: `Debounce timeout is the time in milliseconds after which the view mode is set. Set "0" to disable debouncing (default value is "300"). If you experience issues with the plugin, try increasing this value.`,
};

function keysDescription(): DocumentFragment {
  return createFragment((desc) => {
    desc.append(
      "Changing the view mode can be done through the key ",
      desc.createEl("code", { text: "obsidianUIMode" }),
      ", which can have the value ",
      desc.createEl("code", { text: "source" }),
      " (editing view) or ",
      desc.createEl("code", { text: "preview" }),
      " (reading view).",
      desc.createEl("br"),
      "Changing the editing mode happens by declaring the key ",
      desc.createEl("code", { text: "obsidianEditingMode" }),
      "; it takes ",
      desc.createEl("code", { text: "live" }),
      " (live preview) or ",
      desc.createEl("code", { text: "source" }),
      " (source mode) as value."
    );
  });
}

function foldersDescription(): DocumentFragment {
  return createFragment((desc) => {
    desc.append(
      "Specify a view mode for notes in a given folder.",
      desc.createEl("br"),
      "Note that this will force the view mode on all the notes in the folder, even if they have a different view mode set in their frontmatter.",
      desc.createEl("br"),
      "Precedence is from bottom (highest) to top (lowest), so if you have child folders specified, make sure to put them below their parent folder."
    );
  });
}

function filesDescription(): DocumentFragment {
  return createFragment((desc) => {
    desc.append(
      "Specify a view mode for notes with specific patterns (regular expression; example \" - All$\" for all notes ending with \" - All\" or \"1900-01\" for all daily notes starting with \"1900-01\"",
      desc.createEl("br"),
      "Note that this will force the view mode, even if it have a different view mode set in its frontmatter.",
      desc.createEl("br"),
      "Precedence is from bottom (highest) to top (lowest).",
      desc.createEl("br"),
      "Notice that configuring a file pattern will override the folder configuration for the same file."
    );
  });
}

class ViewModeByFrontmatterSettingTab extends PluginSettingTab {
  plugin: ViewModeByFrontmatterPlugin;

  constructor(app: App, plugin: ViewModeByFrontmatterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Obsidian 1.13 and later build the tab from these definitions, which also
  // puts the settings in the settings search; older versions call display()
  getSettingDefinitions(): SettingDefinitionItem[] {
    const { folders, files } = this.plugin.settings;

    return [
      { name: "Front matter keys", desc: keysDescription() },
      { ...IGNORE_OPEN_FILES, control: { type: "toggle", key: "ignoreOpenFiles" } },
      { ...IGNORE_FORCE_VIEW_ALL, control: { type: "toggle", key: "ignoreForceViewAll" } },
      {
        ...DEBOUNCE_TIMEOUT,
        control: {
          type: "number",
          key: "debounceTimeout",
          min: 0,
          defaultValue: DEFAULT_SETTINGS.debounceTimeout,
        },
      },
      {
        type: "list",
        heading: "Folders",
        items: folders.map((folderMode, index) => ({
          name: folderMode.folder,
          searchable: false,
          render: (setting: Setting) => {
            this.addFolderControls(setting, index);
            setting.infoEl.remove();
            setting.settingEl.addClass("force-view-mode-rule");
          },
        })),
        addItem: {
          name: "Add folder",
          action: () => void this.addRule(folders, { folder: "", viewMode: "" }),
        },
        onDelete: (index) => void this.deleteRule(folders, index),
        onReorder: (from, to) => void this.moveRule(folders, from, to),
      },
      // a list header holds only its heading and add button, so the
      // explanation goes below the rules
      {
        type: "group",
        items: [{ name: "Folder rules", desc: foldersDescription() }],
      },
      {
        type: "list",
        heading: "Files",
        items: files.map((file, index) => ({
          name: file.filePattern,
          searchable: false,
          render: (setting: Setting) => {
            this.addFileControls(setting, index);
            setting.infoEl.remove();
            setting.settingEl.addClass("force-view-mode-rule");
          },
        })),
        addItem: {
          name: "Add file",
          action: () => void this.addRule(files, { filePattern: "", viewMode: "" }),
        },
        onDelete: (index) => void this.deleteRule(files, index),
        onReorder: (from, to) => void this.moveRule(files, from, to),
      },
      // a list header holds only its heading and add button, so the
      // explanation goes below the rules
      {
        type: "group",
        items: [{ name: "File rules", desc: filesDescription() }],
      },
    ];
  }

  display(): void {
    const { containerEl } = this;
    const { folders, files } = this.plugin.settings;

    containerEl.empty();

    new Setting(containerEl).setDesc(keysDescription());

    new Setting(containerEl)
      .setName(IGNORE_OPEN_FILES.name)
      .setDesc(IGNORE_OPEN_FILES.desc)
      .addToggle((checkbox) =>
        checkbox
          .setValue(this.plugin.settings.ignoreOpenFiles)
          .onChange(async (value) => {
            this.plugin.settings.ignoreOpenFiles = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName(IGNORE_FORCE_VIEW_ALL.name)
      .setDesc(IGNORE_FORCE_VIEW_ALL.desc)
      .addToggle((checkbox) => {
        checkbox
          .setValue(this.plugin.settings.ignoreForceViewAll)
          .onChange(async (value) => {
            this.plugin.settings.ignoreForceViewAll = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
        .setName(DEBOUNCE_TIMEOUT.name)
        .setDesc(DEBOUNCE_TIMEOUT.desc)
        .addText((cb) => {
            cb.setValue(String(this.plugin.settings.debounceTimeout)).onChange(async (value) => {
                this.plugin.settings.debounceTimeout = Number(value);

                await this.plugin.saveSettings();
            });
        });

    new Setting(containerEl).setName("Folders").setHeading();

    new Setting(containerEl).setDesc(foldersDescription());

    new Setting(containerEl)
      .setDesc("Add new folder")
      .addButton((button) => {
        button
          .setTooltip("Add another folder to the list")
          .setButtonText("+")
          .setCta()
          .onClick(() => this.addRule(folders, { folder: "", viewMode: "" }));
      });

    folders.forEach((_, index) => {
      const s = new Setting(
        containerEl.createDiv({ cls: ["force-view-mode-div", "force-view-mode-folder"] })
      );

      this.addFolderControls(s, index);
      s.addExtraButton((cb) => {
        cb.setIcon("cross")
          .setTooltip("Delete")
          .onClick(() => this.deleteRule(folders, index));
      });
      s.infoEl.remove();
    });

    new Setting(containerEl).setName("Files").setHeading();

    new Setting(containerEl).setDesc(filesDescription());

    new Setting(containerEl)
      .setDesc("Add new file")
      .addButton((button) => {
        button
          .setTooltip("Add another file to the list")
          .setButtonText("+")
          .setCta()
          .onClick(() => this.addRule(files, { filePattern: "", viewMode: "" }));
      });

    files.forEach((_, index) => {
      const s = new Setting(
        containerEl.createDiv({ cls: ["force-view-mode-div", "force-view-mode-folder"] })
      );

      this.addFileControls(s, index);
      s.addExtraButton((cb) => {
        cb.setIcon("cross")
          .setTooltip("Delete")
          .onClick(() => this.deleteRule(files, index));
      });
      s.infoEl.remove();
    });
  }

  private addFolderControls(setting: Setting, index: number): void {
    const { folders } = this.plugin.settings;

    setting
      .addSearch((cb) => {
        cb.setPlaceholder("Example: folder1/templates")
          .setValue(folders[index].folder)
          .onChange(async (newFolder) => {
            if (newFolder && folders.some((e) => e.folder == newFolder)) {
              console.error("ForceViewMode: This folder already has a template associated with", newFolder);

              return;
            }

            folders[index].folder = newFolder;

            await this.plugin.saveSettings();
          });
      })
      .addDropdown((cb) => {
        cb.addOptions(VIEW_MODES);

        cb.setValue(folders[index].viewMode || "default").onChange(async (value) => {
          folders[index].viewMode = value;

          await this.plugin.saveSettings();
        });
      });
  }

  private addFileControls(setting: Setting, index: number): void {
    const { files } = this.plugin.settings;

    setting
      .addSearch((cb) => {
        cb.setPlaceholder(`Example: " - All$" or "1900-01")`)
          .setValue(files[index].filePattern)
          .onChange(async (value) => {
            if (value && files.some((e) => e.filePattern == value)) {
              console.error("ForceViewMode: Pattern already exists", value);

              return;
            }

            files[index].filePattern = value;

            await this.plugin.saveSettings();
          });
      })
      .addDropdown((cb) => {
        cb.addOptions(VIEW_MODES);

        cb.setValue(files[index].viewMode || "default").onChange(async (value) => {
          files[index].viewMode = value;

          await this.plugin.saveSettings();
        });
      });
  }

  private async addRule<T>(rules: T[], rule: T): Promise<void> {
    rules.push(rule);
    await this.plugin.saveSettings();
    this.refresh();
  }

  private async deleteRule<T>(rules: T[], index: number): Promise<void> {
    rules.splice(index, 1);
    await this.plugin.saveSettings();
    this.refresh();
  }

  private async moveRule<T>(rules: T[], from: number, to: number): Promise<void> {
    rules.splice(to, 0, ...rules.splice(from, 1));
    await this.plugin.saveSettings();
    this.refresh();
  }

  // re-render after rules were added, removed or moved; Obsidian 1.13 and
  // later no longer call display() once getSettingDefinitions() is implemented
  private refresh(): void {
    if (requireApiVersion("1.13.0")) {
      this.update();
    } else {
      this.display();
    }
  }
}
