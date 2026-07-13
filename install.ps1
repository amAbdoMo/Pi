$ErrorActionPreference = 'Stop'

$PiPackages = @(
  'git:github.com/amAbdoMo/Pi',
  'npm:@hypabolic/pi-hypa',
  'npm:context-mode',
  'npm:pi-mcp-adapter'
)
$ConfigScriptUrl = 'https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/apply-config.mjs'
$FontSetupScriptUrl = 'https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/setup-terminal-font.ps1'
$TerminalSettingsScriptUrl = 'https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/set-terminal-font.mjs'
$ConfigScriptFile = Join-Path ([System.IO.Path]::GetTempPath()) "amabdomo-pi-config-$([guid]::NewGuid()).mjs"
$FontSetupScriptFile = Join-Path ([System.IO.Path]::GetTempPath()) "amabdomo-pi-font-$([guid]::NewGuid()).ps1"
$TerminalSettingsScriptFile = Join-Path ([System.IO.Path]::GetTempPath()) "amabdomo-pi-terminal-$([guid]::NewGuid()).mjs"

try {
  Invoke-WebRequest -UseBasicParsing -Uri $ConfigScriptUrl -OutFile $ConfigScriptFile
  Invoke-WebRequest -UseBasicParsing -Uri $FontSetupScriptUrl -OutFile $FontSetupScriptFile
  Invoke-WebRequest -UseBasicParsing -Uri $TerminalSettingsScriptUrl -OutFile $TerminalSettingsScriptFile
  node $ConfigScriptFile

  foreach ($Package in $PiPackages) {
    pi install $Package
  }
  pi update --extensions

  node $ConfigScriptFile
  & $FontSetupScriptFile -TerminalSettingsScript $TerminalSettingsScriptFile
} finally {
  Remove-Item $ConfigScriptFile -Force -ErrorAction SilentlyContinue
  Remove-Item $FontSetupScriptFile -Force -ErrorAction SilentlyContinue
  Remove-Item $TerminalSettingsScriptFile -Force -ErrorAction SilentlyContinue
}

Write-Host 'Done. Restart Pi with: pi'
