## Obsidian force note view mode

This plug-in allows you to indicate through front matter that a note should always be opened in a certain view mode. This is done through the key `obsidianUIMode`, which can have the value `source` or `preview`.

The key `obsidianEditingMode` takes `live` or `source`: it changes the editing mode.

Add below snippet (front matter) to your note ...
```
---
obsidianUIMode: source
obsidianEditingModel: live
---
```
... and this will force the note to open in "live preview" edit mode.


Similar, ... add below snippet to your note ...
```
---
obsidianUIMode: preview
---
```
... and this will always open the note in a reading (/ preview) mode.

This plug-in also ensures that a note is always opened in the configured default mode (suppose the Obsidian setting has "preview" as default mode but the pane is currently in "source" mode, then opening a new note in that same pane will open in "preview" mode).
