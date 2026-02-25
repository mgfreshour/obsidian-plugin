# SF-Work-Tracking

OmniFocus and GUS (Salesforce) integrations for Obsidian. Renders tasks and work items inline in markdown code blocks.

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   pnpm install
   ```

## Development Setup

### Development Build (Watch Mode)
```bash
pnpm dev
```
This will watch for changes and rebuild automatically.

### Production Build
```bash
pnpm build
```
This performs a TypeScript type check and creates an optimized production build.

### Testing
```bash
pnpm test
```
Runs Jest tests. Place test files in `__tests__/` directories or name them with `.spec.ts` or `.test.ts` extensions.

### Linting
```bash
pnpm lint
```
Runs ESLint to check code quality.

```bash
pnpm lint:fix
```
Runs ESLint and automatically fixes issues where possible.

### Generate Test Vault
```bash
pnpm generate-vault
```
Generates a test Obsidian vault in the `test-vault/` directory. This vault includes:
- Basic Obsidian configuration
- The plugin installed and enabled
- Sample markdown files for testing

To use the test vault:
1. Open Obsidian
2. Open vault from folder: `test-vault/`
3. Enable the plugin in Settings > Community plugins

## Installing to a Vault

### Option 1: Install script (recommended)

```bash
pnpm build
pnpm run install-to-vault -- /path/to/your/vault
```

Example:
```bash
pnpm run install-to-vault -- ~/Documents/MyVault
```

The bash script copies `manifest.json`, `main.js`, and `styles.css` to `.obsidian/plugins/sf-work-tracking/` and enables the plugin. Reload the vault in Obsidian to load it.

### Option 2: Manual installation

1. **Build the plugin:**
   ```bash
   pnpm build
   ```

2. **Create** `<your-vault>/.obsidian/plugins/sf-work-tracking/`

3. **Copy** from the project root: `manifest.json`, `main.js`, `styles.css`

4. **Enable** the plugin in Obsidian: Settings → Community plugins → SF-Work-Tracking

5. **Reload** the vault if the plugin does not appear.

When you update the plugin, run `pnpm build` and `pnpm run install-to-vault -- <vault-path>` again (or copy the files manually).

## Project Structure

```
sf-work-tracking/
├── .cursorrules          # Cursor IDE rules for this project
├── .gitignore           # Git ignore patterns
├── .eslintrc.json       # ESLint configuration
├── .eslintignore        # ESLint ignore patterns
├── package.json         # pnpm package configuration
├── tsconfig.json        # TypeScript configuration
├── jest.config.js       # Jest test configuration
├── esbuild.config.mjs   # esbuild bundler configuration
├── manifest.json        # Obsidian plugin manifest
├── versions.json        # Plugin version information
├── main.ts             # Main plugin entry point
├── styles.css          # Plugin styles
├── README.md           # This file
├── scripts/
│   ├── generate-test-vault.mjs   # Generate test vault
│   └── install-to-vault.sh      # Install plugin to an existing vault
└── src/                # Source code directory (for future organization)
```

## Development Workflow

1. **Make changes** to `main.ts` or other source files
2. **Run `pnpm dev`** to start watch mode
3. **Test in Obsidian** by opening the test vault
4. **Write tests** in `__tests__/` directories
5. **Run `pnpm test`** to verify tests pass
6. **Run `pnpm lint`** to check code quality
7. **Build for production** with `pnpm build`

## Contributing

1. Create a feature branch
2. Make your changes
3. Write tests for new functionality
4. Ensure all tests pass (`pnpm test`)
5. Ensure linting passes (`pnpm lint`)
6. Submit a pull request

## Resources

- [Obsidian Plugin API Documentation](https://docs.obsidian.md/Plugins)
- [Obsidian Plugin Development Guide](https://docs.obsidian.md/Plugins/Getting+started)

## License

MIT
