# Obsidian Plugin - Codebase Context

## Project Overview

An Obsidian community plugin that integrates with OmniFocus 4 on macOS. It fetches
tasks from OmniFocus via AppleScript and displays them inline in markdown code blocks.
Supports inbox, project, and tag sources with fuzzy substring matching.

- **Plugin ID**: `obsidian-plugin` (set in `manifest.json`)
- **Version**: 0.1.0
- **Min Obsidian version**: 0.15.0
- **Mobile support**: Yes (`isDesktopOnly: false`)
- **Runtime dependencies**: None (only devDependencies)
- **License**: MIT

## Repository Structure

```
obsidian-plugin/
├── main.ts                         # Plugin entry point (extends Plugin class)
├── src/
│   ├── omnifocus.ts                # OmniFocus AppleScript integration
│   ├── omnifocus.test.ts           # Unit tests for omnifocus.ts
│   └── settings.ts                 # Plugin settings interface & UI tab
├── styles.css                      # Plugin stylesheet
├── manifest.json                   # Obsidian plugin manifest (id, version, etc.)
├── versions.json                   # Release version tracking (empty)
├── package.json                    # npm config, scripts, devDependencies
├── tsconfig.json                   # TypeScript strict-mode config
├── esbuild.config.mjs              # Bundler: entry=main.ts → main.js (CJS)
├── jest.config.js                  # Jest + ts-jest test config
├── .eslintrc.json                  # ESLint + @typescript-eslint rules
├── .eslintignore                   # Excludes node_modules, main.js, test-vault, dist
├── .gitignore                      # Excludes .env, node_modules, main.js, test-vault, etc.
├── CLAUDE.md                       # AI assistant instructions & codebase context
├── AGENTS.md                       # Symlink → CLAUDE.md
├── README.md                       # Project readme
├── docs/
│   └── omnifocus-applescript.md    # OmniFocus AppleScript + Node.js reference
└── scripts/
    ├── generate-test-vault.mjs     # Creates a test Obsidian vault with plugin installed
    └── test-omnifocus.ts           # CLI integration test for OmniFocus functions
```

## OmniFocus Integration (`src/omnifocus.ts`)

Communicates with OmniFocus 4 via `osascript` (AppleScript). See
[docs/omnifocus-applescript.md](docs/omnifocus-applescript.md) for the full
AppleScript reference, gotchas, and performance notes.

Key exports:
- **`TaskSource`** — discriminated union: `inbox`, `project: <name>`, `tag: <name>`
- **`parseSource(input)`** — parses code-block body into a `TaskSource`
- **`resolveName(query, candidates, entityLabel)`** — fuzzy substring matching
  with exact → single substring → ambiguous → no match error flow
- **`fetchTasks(source)`** — resolves name, builds AppleScript, runs osascript
- **`fetchProjectNames()` / `fetchTagNames()`** — list all projects/tags
- **`sourceLabel(source)`** — human-readable label for display

## Entry Point: main.ts

Exports a default class extending `Plugin`. Key functionality:
- **Settings** — sync interval, persisted via `loadData`/`saveData`
- **Command palette** — "Fetch OmniFocus Inbox" command
- **Ribbon icon** — "Sync OmniFocus Inbox" button
- **Auto-sync interval** — configurable periodic inbox sync
- **Code block processor** — `omnifocus` fenced code blocks render inline task
  lists with sync buttons. Parses source, fetches tasks, displays errors.
- **`syncInbox()`** — fetches inbox and writes to a markdown file

Key Obsidian lifecycle hooks:
- **`onload()`** — called when the plugin is enabled. Register commands, views,
  settings tabs, ribbon icons, and event listeners here.
- **`onunload()`** — called when the plugin is disabled. Clean up all resources
  (intervals, event listeners, DOM mutations, registered views).

## Build System

### esbuild (esbuild.config.mjs)

- **Entry**: `main.ts` → **Output**: `main.js` (CommonJS, ES2018 target)
- **External** (provided by Obsidian at runtime): `obsidian`, `electron`,
  `@codemirror/*`, `@lezer/*`, all Node.js built-ins
- **Dev mode** (`npm run dev`): watch mode, inline source maps
- **Production** (`npm run build`): `tsc --noEmit` type check, then single rebuild, no source maps, tree-shaken
- Adds a banner comment to the output file

### TypeScript (tsconfig.json)

- `strict: true` (includes `strictNullChecks`, `noImplicitAny`, etc.)
- Target: ES6, Module: ESNext, Resolution: Node
- Includes all `**/*.ts`, excludes `node_modules` and `test-vault`

### npm Scripts

| Script              | Command                                       | Purpose                          |
|---------------------|-----------------------------------------------|----------------------------------|
| `npm run dev`       | `node esbuild.config.mjs`                     | Watch mode with source maps      |
| `npm run build`     | `tsc --noEmit && node esbuild.config.mjs --production` | Type check + production bundle |
| `npm test`          | `jest`                                        | Run unit tests                   |
| `npm run lint`      | `eslint . --ext .ts`                          | Lint TypeScript files            |
| `npm run lint:fix`  | `eslint . --ext .ts --fix`                    | Auto-fix lint issues             |
| `npm run generate-vault` | `node scripts/generate-test-vault.mjs`   | Create test vault for manual QA  |
| `npm run launch`  | `npm run build && npm run generate-vault && node scripts/launch-obsidian.mjs` | Build, generate vault, open Obsidian |

## Testing

- **Framework**: Jest 29 with ts-jest
- **Test patterns**: `__tests__/**/*.ts` and `**/*.{spec,test}.ts`
- **Environment**: Node
- **Coverage**: collected from all `.ts` files (excluding `.d.ts`)
- Tests co-located with source: `src/omnifocus.test.ts`
- CLI integration test: `npx tsx scripts/test-omnifocus.ts`

## Linting

- ESLint with `@typescript-eslint` parser and recommended rules
- Key rule overrides:
  - `@typescript-eslint/no-unused-vars`: warn
  - `@typescript-eslint/no-explicit-any`: warn
  - `@typescript-eslint/ban-ts-comment`: off
  - `@typescript-eslint/no-empty-function`: off

## Test Vault Generator (scripts/generate-test-vault.mjs)

Creates a `test-vault/` directory that can be opened in Obsidian for manual testing:
- Reads plugin name from `package.json` (overridable via CLI arg)
- Creates `.obsidian/` config structure with the plugin registered
- Copies `manifest.json` and `main.js` into the vault's plugins directory
- Generates sample markdown files (Welcome.md, OmniFocus Tests.md)
- Requires `npm run build` first so `main.js` exists

## Key Obsidian APIs (for future development)

These are the primary APIs available via `this` inside the Plugin class:

| API                       | Purpose                                    |
|---------------------------|--------------------------------------------|
| `this.addCommand()`       | Register commands (palette, hotkeys)       |
| `this.addSettingTab()`    | Add a settings tab to the plugin settings  |
| `this.addRibbonIcon()`    | Add an icon to the left ribbon             |
| `this.registerView()`     | Register a custom view type                |
| `this.app.vault`          | Read/write/delete files and folders        |
| `this.app.metadataCache`  | Access parsed frontmatter, links, tags     |
| `this.app.workspace`      | Manage leaves, splits, and the active view |
| `this.loadData()`         | Load persisted plugin settings (data.json) |
| `this.saveData()`         | Save plugin settings to data.json          |

## Common Patterns for New Features

### Adding settings

1. Define a settings interface and defaults
2. Create a class extending `PluginSettingTab`
3. Call `this.addSettingTab(new MySettingTab(this.app, this))` in `onload()`
4. Use `this.loadData()` / `this.saveData()` for persistence

### Adding commands

```typescript
this.addCommand({
  id: 'my-command',
  name: 'Do something',
  callback: () => { /* ... */ },
});
```

### Adding views

1. Create a class extending `ItemView`
2. Call `this.registerView(VIEW_TYPE, (leaf) => new MyView(leaf))` in `onload()`
3. Activate with `this.app.workspace.getLeaf().setViewState({ type: VIEW_TYPE })`

---

# Obsidian Plugin Development Rules

## TypeScript Best Practices

- Use TypeScript strict mode features
- Prefer explicit types over `any`
- Use interfaces for object shapes
- Use enums for fixed sets of constants
- Leverage type inference where appropriate
- Use `readonly` for immutable properties
- Prefer `const` assertions for literal types

## Obsidian API Usage

- Always extend the `Plugin` class from `obsidian`
- Use `this.app` to access Obsidian's app instance
- Use `this.addCommand()` for commands
- Use `this.addSettingTab()` for settings UI
- Use `this.addRibbonIcon()` for ribbon icons
- Use `this.registerView()` for custom views
- Clean up resources in `onunload()`
- Use `this.app.vault` for file operations
- Use `this.app.metadataCache` for metadata operations
- Use `this.app.workspace` for UI operations

## Code Style

- Use 2 spaces for indentation
- Use single quotes for strings (unless double quotes are needed)
- Use semicolons
- Use trailing commas in multi-line objects/arrays
- Use meaningful variable and function names
- Keep functions focused and small
- Add JSDoc comments for public APIs

## File Organization

- `main.ts` is the entry point only; feature modules (settings, commands, views, etc.) belong in `src/`
- Organize related functionality into modules in `src/`
- Use `__tests__/` directories for test files
- Name test files with `.spec.ts` or `.test.ts` extensions
- Keep styles in `styles.css` or separate CSS files

## Testing Requirements

- Write unit tests for utility functions
- Mock Obsidian API objects in tests
- Test error handling paths
- Aim for meaningful test coverage
- Use descriptive test names

## Error Handling

- Use try-catch blocks for async operations
- Provide meaningful error messages
- Log errors appropriately
- Handle edge cases gracefully

## Performance

- Avoid unnecessary re-renders
- Use debouncing for frequent operations
- Cache expensive computations
- Clean up event listeners and timers

## Documentation

- Document public APIs with JSDoc
- Keep README.md up to date
- Document complex algorithms
- Include usage examples in comments

## Obsidian Plugin Development Guidelines

- Follow Obsidian's plugin development best practices
- Test plugins in both desktop and mobile (if applicable)
- Handle vault state changes gracefully
- Respect user settings and preferences
- Use Obsidian's built-in UI components when possible
- Follow Obsidian's design patterns and conventions

## References

- [Obsidian Plugin API Documentation](https://docs.obsidian.md/Plugins)
- [Obsidian Plugin Development Guide](https://docs.obsidian.md/Plugins/Getting+started)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [OmniFocus AppleScript + Node.js Reference](docs/omnifocus-applescript.md) — gotchas, working queries, performance notes
