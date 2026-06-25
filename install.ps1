$ErrorActionPreference = 'Stop'

$PiPackages = @(
  'git:github.com/amAbdoMo/Pi',
  'npm:@hypabolic/pi-hypa',
  'npm:context-mode',
  'npm:pi-mcp-adapter'
)

foreach ($Package in $PiPackages) {
  pi install $Package
}

node -e @'
const fs = require('fs');
const os = require('os');
const path = require('path');

const requiredPackages = [
  'git:github.com/amAbdoMo/Pi',
  'npm:@hypabolic/pi-hypa',
  'npm:context-mode',
  'npm:pi-mcp-adapter',
];

const settingsDir = process.env.PI_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
const settingsFile = path.join(settingsDir, 'settings.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch {}

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

fs.mkdirSync(settingsDir, { recursive: true });
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
console.log(`Updated ${settingsFile}`);

const keybindingsFile = path.join(settingsDir, 'keybindings.json');
let keybindings = {};
try { keybindings = JSON.parse(fs.readFileSync(keybindingsFile, 'utf8')); } catch {}
keybindings['tui.input.copy'] = ['ctrl+c'];
keybindings['app.clear'] = [];
keybindings['app.clipboard.pasteImage'] = [];
fs.writeFileSync(keybindingsFile, JSON.stringify(keybindings, null, 2) + '\n');
console.log(`Updated ${keybindingsFile}`);
'@

Write-Host 'Done. Start Pi with: pi'
