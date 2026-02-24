# Obsidian Plugin

An Obsidian plugin skeleton with full development tooling.

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

## Development Setup

### Development Build (Watch Mode)
```bash
npm run dev
```
This will watch for changes and rebuild automatically.

### Production Build
```bash
npm run build
```
This performs a TypeScript type check and creates an optimized production build.

### Testing
```bash
npm test
```
Runs Jest tests. Place test files in `__tests__/` directories or name them with `.spec.ts` or `.test.ts` extensions.

### Linting
```bash
npm run lint
```
Runs ESLint to check code quality.

```bash
npm run lint:fix
```
Runs ESLint and automatically fixes issues where possible.

### Generate Test Vault
```bash
npm run generate-vault
```
Generates a test Obsidian vault in the `test-vault/` directory. This vault includes:
- Basic Obsidian configuration
- The plugin installed and enabled
- Sample markdown files for testing

To use the test vault:
1. Open Obsidian
2. Open vault from folder: `test-vault/`
3. Enable the plugin in Settings > Community plugins

## Project Structure

```
obsidian-plugin/
├── .cursorrules          # Cursor IDE rules for this project
├── .gitignore           # Git ignore patterns
├── .eslintrc.json       # ESLint configuration
├── .eslintignore        # ESLint ignore patterns
├── package.json         # npm package configuration
├── tsconfig.json        # TypeScript configuration
├── jest.config.js       # Jest test configuration
├── esbuild.config.mjs   # esbuild bundler configuration
├── manifest.json        # Obsidian plugin manifest
├── versions.json        # Plugin version information
├── main.ts             # Main plugin entry point
├── styles.css          # Plugin styles
├── README.md           # This file
├── scripts/
│   └── generate-test-vault.mjs  # Script to generate test vault
└── src/                # Source code directory (for future organization)
```

## Development Workflow

1. **Make changes** to `main.ts` or other source files
2. **Run `npm run dev`** to start watch mode
3. **Test in Obsidian** by opening the test vault
4. **Write tests** in `__tests__/` directories
5. **Run `npm test`** to verify tests pass
6. **Run `npm run lint`** to check code quality
7. **Build for production** with `npm run build`

## Contributing

1. Create a feature branch
2. Make your changes
3. Write tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Ensure linting passes (`npm run lint`)
6. Submit a pull request

## Resources

- [Obsidian Plugin API Documentation](https://docs.obsidian.md/Plugins)
- [Obsidian Plugin Development Guide](https://docs.obsidian.md/Plugins/Getting+started)

## License

MIT
