#!/usr/bin/env bash
set -euo pipefail

PI_PACKAGES=(
  "git:github.com/amAbdoMo/Pi"
  "npm:@hypabolic/pi-hypa"
  "npm:context-mode"
  "npm:pi-mcp-adapter"
)

for package in "${PI_PACKAGES[@]}"; do
  pi install "$package"
done

SETTINGS_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"
mkdir -p "$SETTINGS_DIR"

node <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');

const requiredPackages = [
  'git:github.com/amAbdoMo/Pi',
  'npm:@hypabolic/pi-hypa',
  'npm:context-mode',
  'npm:pi-mcp-adapter',
];

const file = path.join(process.env.PI_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent'), 'settings.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

function isLegacyLocalPiPackage(packageSpec) {
  if (typeof packageSpec !== 'string') return false;
  return /(^|[\\/])Projects[\\/]Pi$/i.test(packageSpec.replace(/\\\\/g, '\\'));
}

settings.theme = 'hypr-waves';
settings.packages = Array.from(new Set([
  ...(Array.isArray(settings.packages) ? settings.packages.filter((packageSpec) => !isLegacyLocalPiPackage(packageSpec)) : []),
  ...requiredPackages,
]));
settings.defaultProvider ??= 'openai-codex';
settings.defaultModel ??= 'gpt-5.5';
settings.hideThinkingBlock ??= true;
settings.defaultThinkingLevel ??= 'xhigh';
settings.editorPaddingX ??= 0;
settings.terminal = { ...(settings.terminal || {}), showTerminalProgress: true };
settings.steeringMode ??= 'one-at-a-time';
settings.quietStartup ??= true;
settings.enableInstallTelemetry ??= false;
settings.doubleEscapeAction ??= 'tree';
settings.treeFilterMode ??= 'no-tools';
settings.warnings = { ...(settings.warnings || {}), anthropicExtraUsage: true };

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log(`Updated ${file}`);

const keybindingsFile = path.join(path.dirname(file), 'keybindings.json');
let keybindings = {};
try { keybindings = JSON.parse(fs.readFileSync(keybindingsFile, 'utf8')); } catch {}
keybindings['tui.input.copy'] = ['ctrl+c'];
keybindings['app.clear'] = [];
keybindings['app.clipboard.pasteImage'] = [];
fs.writeFileSync(keybindingsFile, JSON.stringify(keybindings, null, 2) + '\n');
console.log(`Updated ${keybindingsFile}`);
NODE

echo "Done. Start Pi with: pi"
