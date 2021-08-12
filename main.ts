import { WorkspaceLeaf, Plugin, TextFileView, ViewStateResult, RequestParam, Modal, App, request, MarkdownView } from 'obsidian';

export default class ViewModeByFrontmatterPlugin extends Plugin {
	OBSIDIAN_UI_MODE_KEY = 'obsidian_ui_mode';

	async onload() {
		const readViewModeFromFrontmatterAndToggle = async (leaf: WorkspaceLeaf) => {
			let view = leaf.view instanceof MarkdownView ? leaf.view : null;

			if (null === view) {
				return;
			}

			let state = view.getState();

			// ... get frontmatter data and search for a key indicating the desired view mode
			// and when the given key is present ... set it to the declared mode
			const fileCache = this.app.metadataCache.getFileCache(view.file);
			const fileDeclaredUIMode = fileCache !== null && fileCache.frontmatter ? fileCache.frontmatter[this.OBSIDIAN_UI_MODE_KEY] : null;

			if (null !== fileDeclaredUIMode) {
				if (['source', 'preview', 'live'].includes(fileDeclaredUIMode)
					&& state.mode !== fileDeclaredUIMode) {
					state.mode = fileDeclaredUIMode;
					view.setState(state, new ViewModeByFrontmatterViewStateResult());
				}

				return;
			}

			const defaultViewMode = this.app.vault.config.defaultViewMode ? this.app.vault.config.defaultViewMode : 'source';

			if (state.mode !== defaultViewMode) {
				state.mode = defaultViewMode;
				view.setState(state, new ViewModeByFrontmatterViewStateResult());
			}
		};

		// "active-leaf-change": open note, navigate to note -> will check whether
		// the view mode needs to be set; default view mode setting is ignored.
		this.registerEvent(this.app.workspace.on("active-leaf-change", readViewModeFromFrontmatterAndToggle));
	}
}

class ViewModeByFrontmatterViewStateResult implements ViewStateResult {
	// ...
}
