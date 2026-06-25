#!/usr/bin/env bash
set -euo pipefail

pi install git:github.com/amAbdoMo/Pi

SETTINGS_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"
mkdir -p "$SETTINGS_DIR"

node <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const file = path.join(process.env.PI_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent'), 'settings.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
settings.theme = 'hypr-waves';
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
NODE

echo "Done. Start Pi with: pi"
