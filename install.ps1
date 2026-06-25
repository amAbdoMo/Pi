$ErrorActionPreference = 'Stop'

pi install git:github.com/amAbdoMo/Pi

$settingsDir = if ($env:PI_AGENT_DIR) { $env:PI_AGENT_DIR } else { Join-Path $HOME '.pi\agent' }
$settingsFile = Join-Path $settingsDir 'settings.json'
New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

if (Test-Path $settingsFile) {
  $settings = Get-Content $settingsFile -Raw | ConvertFrom-Json -AsHashtable
} else {
  $settings = @{}
}

$settings['theme'] = 'hypr-waves'
if (-not $settings.ContainsKey('defaultProvider')) { $settings['defaultProvider'] = 'openai-codex' }
if (-not $settings.ContainsKey('defaultModel')) { $settings['defaultModel'] = 'gpt-5.5' }
if (-not $settings.ContainsKey('hideThinkingBlock')) { $settings['hideThinkingBlock'] = $true }
if (-not $settings.ContainsKey('defaultThinkingLevel')) { $settings['defaultThinkingLevel'] = 'xhigh' }
if (-not $settings.ContainsKey('editorPaddingX')) { $settings['editorPaddingX'] = 0 }
if (-not $settings.ContainsKey('terminal')) { $settings['terminal'] = @{} }
$settings['terminal']['showTerminalProgress'] = $true
if (-not $settings.ContainsKey('steeringMode')) { $settings['steeringMode'] = 'one-at-a-time' }
if (-not $settings.ContainsKey('quietStartup')) { $settings['quietStartup'] = $true }
if (-not $settings.ContainsKey('enableInstallTelemetry')) { $settings['enableInstallTelemetry'] = $false }
if (-not $settings.ContainsKey('doubleEscapeAction')) { $settings['doubleEscapeAction'] = 'tree' }
if (-not $settings.ContainsKey('treeFilterMode')) { $settings['treeFilterMode'] = 'no-tools' }
if (-not $settings.ContainsKey('warnings')) { $settings['warnings'] = @{} }
$settings['warnings']['anthropicExtraUsage'] = $true

$settings | ConvertTo-Json -Depth 10 | Set-Content -Path $settingsFile -Encoding UTF8
Write-Host "Updated $settingsFile"

$keybindingsFile = Join-Path $settingsDir 'keybindings.json'
if (Test-Path $keybindingsFile) {
  $keybindings = Get-Content $keybindingsFile -Raw | ConvertFrom-Json -AsHashtable
} else {
  $keybindings = @{}
}
$keybindings['tui.input.copy'] = @('ctrl+c')
$keybindings['app.clipboard.pasteImage'] = @('ctrl+v', 'alt+v')
$keybindings | ConvertTo-Json -Depth 10 | Set-Content -Path $keybindingsFile -Encoding UTF8
Write-Host "Updated $keybindingsFile"

Write-Host "Done. Start Pi with: pi"
