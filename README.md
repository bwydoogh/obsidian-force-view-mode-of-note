## Obsidian force note view mode

This plug-in allows you to indicate through front matter that a note should always be opened in a certain view mode or editing mode. 

### Installation

From within Obsidian:

1. Open **Settings → Community plugins** and turn off **Restricted mode** if it is on.
2. Select **Browse**, search for "Force note view mode" and select **Install**.
3. Select **Enable**.

Manually:

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/bwydoogh/obsidian-force-view-mode-of-note/releases/latest).
2. Copy them to `<your vault>/.obsidian/plugins/obsidian-view-mode-by-frontmatter/`.
3. Reload Obsidian and enable **Force note view mode** under **Settings → Community plugins**.

The plug-in requires Obsidian 1.1.0 or later. Release assets come with [artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations); verify a download with `gh attestation verify main.js --repo bwydoogh/obsidian-force-view-mode-of-note`.

### Usage

#### Front matter

Changing the **view mode** can be done through the key `obsidianUIMode`, which can have the value `source` (editing view) or `preview` (reading view). Changing the **editing mode** happens by declaring the key `obsidianEditingMode`; it takes `live` (live preview) or `source` (source mode) as value.

| You want                      | Front matter                                         |
| ----------------------------- | ---------------------------------------------------- |
| Reading view                  | `obsidianUIMode: preview`                            |
| Editing view, live preview    | `obsidianUIMode: source` + `obsidianEditingMode: live`   |
| Editing view, source mode     | `obsidianUIMode: source` + `obsidianEditingMode: source` |

When only `obsidianUIMode: preview` is set (in front matter or through a folder or file rule), switching to editing uses the `obsidianEditingMode` of the note if it has one, and Obsidian's default editing mode otherwise.

Example: add below snippet (front matter) to your note ...
```
---
obsidianUIMode: source
obsidianEditingMode: live
---
```
... and this will force the note to open in "live preview" edit mode.


Similar, ... add below snippet to your note ...
```
---
obsidianUIMode: preview
---
```
... and this will always open the note in reading view (Obsidian calls this mode `preview` internally).

#### Folder and file rules

Under **Settings → Force note view mode** you can force a mode without touching the notes themselves:

- **Folders**: every note in the folder (and its subfolders) opens in the chosen mode.
- **Files**: every note whose name matches a regular expression opens in the chosen mode, for example ` - All$` for notes ending in " - All" or `1900-01` for daily notes starting with "1900-01".

Rules take precedence over front matter, and file rules take precedence over folder rules. Within a list, a lower rule wins over a higher one, so put child folders below their parent folder. Choose `default` to leave the matching notes alone.

#### Other settings

- **Ignore opened files**: never change the mode of a note that was already open.
- **Ignore force view when not in frontmatter**: only change the mode of notes that declare one, or that match a rule.
- **Debounce timeout in milliseconds**: how long to wait before setting the mode (300 by default, 0 turns debouncing off). Increase it if the mode does not stick.

#### Default mode

This plug-in also ensures that a note is always opened in the configured default mode (suppose the Obsidian setting has "preview" as default mode but the pane is currently in "source" mode, then opening a new note in that same pane will open in "preview" mode).
