import { Plugin } from "obsidian";

export default class ObsidianPlugin extends Plugin {
	async onload() {
		console.log("Loading Obsidian Plugin");

		// TODO: Load settings
		// TODO: Add commands
		// TODO: Add UI elements
	}

	onunload() {
		console.log("Unloading Obsidian Plugin");
	}
}
