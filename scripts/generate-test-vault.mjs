import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Get plugin id from manifest.json or use default
let pluginId = "sf-work-tracking";
try {
	const manifest = JSON.parse(
		fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8")
	);
	pluginId = manifest.id || pluginId;
} catch (error) {
	console.warn("Could not read manifest.json, using default plugin id");
}

// Allow override via command line argument
if (process.argv[2]) {
	pluginId = process.argv[2];
}

const testVaultDir = path.join(rootDir, "test-vault");
const obsidianDir = path.join(testVaultDir, ".obsidian");
const pluginsDir = path.join(obsidianDir, "plugins");
const pluginDir = path.join(pluginsDir, pluginId);

// Create directory structure
function ensureDir(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
		console.log(`Created directory: ${dirPath}`);
	}
}

try {
	// Create directories
	ensureDir(obsidianDir);
	ensureDir(pluginsDir);
	ensureDir(pluginDir);

	// Copy manifest.json
	const manifestSrc = path.join(rootDir, "manifest.json");
	const manifestDest = path.join(pluginDir, "manifest.json");
	if (fs.existsSync(manifestSrc)) {
		fs.copyFileSync(manifestSrc, manifestDest);
		console.log(`Copied manifest.json to ${manifestDest}`);
	} else {
		console.warn(`manifest.json not found at ${manifestSrc}`);
	}

	// Copy main.js (if it exists)
	const mainJsSrc = path.join(rootDir, "main.js");
	const mainJsDest = path.join(pluginDir, "main.js");
	if (fs.existsSync(mainJsSrc)) {
		fs.copyFileSync(mainJsSrc, mainJsDest);
		console.log(`Copied main.js to ${mainJsDest}`);
	} else {
		console.warn(`main.js not found at ${mainJsSrc}. Run 'pnpm build' first.`);
	}

	// Copy styles.css (if it exists)
	const stylesSrc = path.join(rootDir, "styles.css");
	const stylesDest = path.join(pluginDir, "styles.css");
	if (fs.existsSync(stylesSrc)) {
		fs.copyFileSync(stylesSrc, stylesDest);
		console.log(`Copied styles.css to ${stylesDest}`);
	}

	// Create .obsidian/app.json
	const appJsonPath = path.join(obsidianDir, "app.json");
	const appJson = {
		"legacyEditor": false,
		"livePreview": true
	};
	fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));
	console.log(`Created ${appJsonPath}`);

	// Create .obsidian/community-plugins.json
	const communityPluginsPath = path.join(obsidianDir, "community-plugins.json");
	const communityPlugins = [pluginId];
	fs.writeFileSync(communityPluginsPath, JSON.stringify(communityPlugins, null, 2));
	console.log(`Created ${communityPluginsPath}`);

	// Create .obsidian/core-plugins.json
	const corePluginsPath = path.join(obsidianDir, "core-plugins.json");
	const corePlugins = {
		"file-explorer": true,
		"global-search": true,
		"switcher": true,
		"graph": false,
		"backlink": true,
		"outgoing-link": false,
		"tag-pane": false,
		"page-preview": false,
		"daily-notes": false,
		"templates": false,
		"note-composer": false,
		"command-palette": true,
		"slash-command": false,
		"markdown-importer": false,
		"word-count": false,
		"open-with-default-app": false,
		"workspaces": false,
		"file-recovery": true
	};
	fs.writeFileSync(corePluginsPath, JSON.stringify(corePlugins, null, 2));
	console.log(`Created ${corePluginsPath}`);

	// Create sample markdown files
	const sampleFiles = [
		{
			name: "Welcome.md",
			content: `# Welcome to Obsidian

This is a test vault for developing and testing the ${pluginId} plugin.

## Getting Started

- Edit this file to test your plugin
- Create new notes to test various features
- Use the command palette (Cmd/Ctrl+P) to access plugin commands
\`\`\`gus
W-21276903
W-20680369
W-21337266

\`\`\`

`
		},
		{
			name: "OmniFocus Tests.md",
			content: `# OmniFocus Test Cases

## Inbox

\`\`\`omnifocus
inbox
\`\`\`

## Exact project name (has tasks)

\`\`\`omnifocus
project: ✍️ Team Organization Paper
\`\`\`

## Substring match (unique)

\`\`\`omnifocus
project: PlusCal
\`\`\`

## Substring match (ambiguous — multiple matches)

\`\`\`omnifocus
project: Team
\`\`\`

## No match

\`\`\`omnifocus
project: xyznonexistent
\`\`\`

## Tag (exact)

\`\`\`omnifocus
tag: @Work
\`\`\`

## Tag (substring)

\`\`\`omnifocus
tag: Work
\`\`\`

## Tag (no match)

\`\`\`omnifocus
tag: xyznonexistent
\`\`\`

## Empty source (usage hint)

\`\`\`omnifocus
\`\`\`
`
		}
	];

	for (const file of sampleFiles) {
		const filePath = path.join(testVaultDir, file.name);
		fs.writeFileSync(filePath, file.content);
		console.log(`Created sample file: ${filePath}`);
	}

	console.log(`\n✅ Test vault created successfully at: ${testVaultDir}`);
	console.log(`Plugin id: ${pluginId}`);
	console.log(`\nTo use this vault:`);
	console.log(`1. Open Obsidian`);
	console.log(`2. Open vault from folder: ${testVaultDir}`);
	console.log(`3. Enable the plugin in Settings > Community plugins`);
} catch (error) {
	console.error("Error generating test vault:", error);
	process.exit(1);
}
