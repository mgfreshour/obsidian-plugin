import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vaultPath = path.resolve(__dirname, '..', 'test-vault');

const platform = process.platform;

// Obsidian tracks known vaults in its config. The obsidian:// URI scheme only
// works for vaults already registered there. Detect whether this vault has been
// opened before by checking Obsidian's global config.
function isVaultKnown() {
  let configPath;
  if (platform === 'darwin') {
    configPath = path.join(
      process.env.HOME, 'Library', 'Application Support', 'obsidian', 'obsidian.json',
    );
  } else if (platform === 'win32') {
    configPath = path.join(process.env.APPDATA, 'obsidian', 'obsidian.json');
  } else {
    configPath = path.join(process.env.HOME, '.config', 'obsidian', 'obsidian.json');
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const vaults = config.vaults || {};
    return Object.values(vaults).some((v) => v.path === vaultPath);
  } catch {
    return false;
  }
}

try {
  if (isVaultKnown()) {
    // Vault is registered — open it directly via URI
    if (platform === 'darwin') {
      execSync(`open "obsidian://open?path=${encodeURIComponent(vaultPath)}"`);
    } else if (platform === 'win32') {
      execSync(`start "" "obsidian://open?path=${encodeURIComponent(vaultPath)}"`);
    } else {
      execSync(`xdg-open "obsidian://open?path=${encodeURIComponent(vaultPath)}"`);
    }
    console.log(`Opened Obsidian with vault: ${vaultPath}`);
  } else {
    // First run — just launch Obsidian and tell the user to open the vault
    if (platform === 'darwin') {
      execSync('open -a Obsidian');
    } else if (platform === 'win32') {
      execSync('start "" "Obsidian"');
    } else {
      execSync('obsidian &');
    }
    console.log('Obsidian launched.');
    console.log(`\nThis vault hasn't been opened in Obsidian yet.`);
    console.log('To register it, use the Obsidian vault picker:');
    console.log(`  1. Click "Open" next to "Open folder as vault"`);
    console.log(`  2. Select: ${vaultPath}`);
    console.log(`  3. Enable the plugin in Settings > Community plugins`);
    console.log('\nOn subsequent runs, the vault will open automatically.');
  }
} catch (error) {
  console.error('Failed to open Obsidian. Is it installed?');
  console.error(`You can open the vault manually: ${vaultPath}`);
  process.exit(1);
}
