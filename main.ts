import { WorkspaceLeaf, Plugin, MarkdownView } from 'obsidian';

export default class ViewModeByFrontmatterPlugin extends Plugin {
	OBSIDIAN_UI_MODE_KEY = 'obsidianUIMode';

	async onload() {
		const readViewModeFromFrontmatterAndToggle = async (leaf: WorkspaceLeaf) => {
			let view = leaf.view instanceof MarkdownView ? leaf.view : null;

			if (null === view) {
				return;
			}

			// ... get frontmatter data and search for a key indicating the desired view mode
			// and when the given key is present ... set it to the declared mode
			const fileCache = this.app.metadataCache.getFileCache(view.file);
			const fileDeclaredUIMode = fileCache !== null && fileCache.frontmatter ? fileCache.frontmatter[this.OBSIDIAN_UI_MODE_KEY] : null;

			if (null !== fileDeclaredUIMode) {
				if (['source', 'preview', 'live'].includes(fileDeclaredUIMode)
					&& view.getMode() !== fileDeclaredUIMode) {
					let state = leaf.getViewState();

					state.state.mode = fileDeclaredUIMode;

					leaf.setViewState(state);
				}

				return;
			}

			const defaultViewMode = this.app.vault.config.defaultViewMode ? this.app.vault.config.defaultViewMode : 'source';

			if (view.getMode() !== defaultViewMode) {
				let state = leaf.getViewState();

				state.state.mode = defaultViewMode;

				leaf.setViewState(state);
			}
		};

		// "active-leaf-change": open note, navigate to note -> will check whether
		// the view mode needs to be set; default view mode setting is ignored.
		this.registerEvent(this.app.workspace.on("active-leaf-change", readViewModeFromFrontmatterAndToggle));
	}
}
