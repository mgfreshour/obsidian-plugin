# Obsidian Plugin - Codebase Context

## Project Overview

This is a **starter template** for an Obsidian community plugin. It contains a fully
configured build toolchain, test framework, and linting setup, but the plugin itself has
no functionality yet — `main.ts` is a skeleton with TODO placeholders. Everything is
ready for feature development.

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
├── styles.css                      # Plugin stylesheet (empty)
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
└── scripts/
    └── generate-test-vault.mjs     # Creates a test Obsidian vault with plugin installed
```

**Planned directories** (not yet created):
- `src/` — feature modules organized by concern
- `__tests__/` — unit tests (or co-located `*.test.ts` / `*.spec.ts` files)

## Entry Point: main.ts

The sole source file. Exports a default class extending `Plugin`:

```typescript
import { Plugin } from 'obsidian';

export default class ObsidianPlugin extends Plugin {
  async onload() {
    // TODO: Load settings
    // TODO: Add commands
    // TODO: Add UI elements
  }
  onunload() {
    // cleanup
  }
}
```

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

## Testing

- **Framework**: Jest 29 with ts-jest
- **Test patterns**: `__tests__/**/*.ts` and `**/*.{spec,test}.ts`
- **Environment**: Node
- **Coverage**: collected from all `.ts` files (excluding `.d.ts`)
- **No tests exist yet** — infrastructure is ready

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
- Generates sample markdown files (Welcome.md, Sample Note.md)
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
