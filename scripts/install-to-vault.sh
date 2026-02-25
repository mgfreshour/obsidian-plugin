#!/usr/bin/env bash
#
# Install the SF-Work-Tracking plugin to an existing Obsidian vault.
#
# Usage: ./scripts/install-to-vault.sh <vault-path>
#    or: pnpm run install-to-vault -- <vault-path>
#
# The vault path should be the root directory of your Obsidian vault
# (the folder that contains .obsidian/).
#
# This script:
# 1. Builds the plugin (pnpm run build) if main.js is missing
# 2. Creates .obsidian/plugins/sf-work-tracking/ in the vault
# 3. Copies manifest.json, main.js, and styles.css
# 4. Adds the plugin to community-plugins.json (enables it)
#

set -e

PLUGIN_ID="sf-work-tracking"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  echo "Usage: pnpm run install-to-vault -- <vault-path>"
  echo ""
  echo "Example: pnpm run install-to-vault -- ~/Documents/MyVault"
  exit 1
}

[[ -z "$1" ]] && usage

if ! VAULT_PATH="$(cd "$ROOT_DIR" && cd "$1" 2>/dev/null && pwd)"; then
  echo "Error: Vault path does not exist: $1"
  exit 1
fi

# Build if needed
if [[ ! -f "$ROOT_DIR/main.js" ]]; then
  echo "main.js not found. Building plugin..."
  (cd "$ROOT_DIR" && pnpm run build) || { echo "Build failed. Run 'pnpm run build' manually and try again."; exit 1; }
fi

OBSIDIAN_DIR="$VAULT_PATH/.obsidian"
PLUGINS_DIR="$OBSIDIAN_DIR/plugins"
PLUGIN_DIR="$PLUGINS_DIR/$PLUGIN_ID"

mkdir -p "$PLUGIN_DIR"

cp "$ROOT_DIR/manifest.json" "$PLUGIN_DIR/manifest.json"
echo "Copied manifest.json"

cp "$ROOT_DIR/main.js" "$PLUGIN_DIR/main.js"
echo "Copied main.js"

[[ -f "$ROOT_DIR/styles.css" ]] && { cp "$ROOT_DIR/styles.css" "$PLUGIN_DIR/styles.css"; echo "Copied styles.css"; }

# Update community-plugins.json
COMMUNITY_PLUGINS="$OBSIDIAN_DIR/community-plugins.json"
if [[ ! -f "$COMMUNITY_PLUGINS" ]]; then
  echo "[\"$PLUGIN_ID\"]" > "$COMMUNITY_PLUGINS"
  echo "Enabled plugin in community-plugins.json"
else
  node -e "
    const fs = require('fs');
    const path = process.argv[1];
    let ids = [];
    try {
      ids = JSON.parse(fs.readFileSync(path, 'utf8'));
    } catch (_) {}
    if (!Array.isArray(ids)) ids = [];
    if (!ids.includes('$PLUGIN_ID')) {
      ids.push('$PLUGIN_ID');
      fs.writeFileSync(path, JSON.stringify(ids, null, 2));
      console.log('Enabled plugin in community-plugins.json');
    } else {
      console.log('Plugin already enabled in community-plugins.json');
    }
  " "$COMMUNITY_PLUGINS"
fi

echo ""
echo "✅ SF-Work-Tracking installed to: $PLUGIN_DIR"
echo ""
echo "Reload the vault in Obsidian (or restart Obsidian) to load the plugin."
