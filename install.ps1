$ErrorActionPreference = 'Stop'

$PiPackages = @(
  'git:github.com/amAbdoMo/Pi',
  'npm:@hypabolic/pi-hypa',
  'npm:context-mode'
)
$ConfigScriptUrl = 'https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/apply-config.mjs'
$FontSetupScriptUrl = 'https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/setup-terminal-font.ps1'
$TerminalSettingsScriptUrl = 'https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/set-terminal-font.mjs'
$WarpSettingsScriptUrl = 'https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/set-warp-settings.mjs'
$ConfigScriptFile = Join-Path ([System.IO.Path]::GetTempPath()) "pi-workbench-config-$([guid]::NewGuid()).mjs"
$FontSetupScriptFile = Join-Path ([System.IO.Path]::GetTempPath()) "pi-workbench-font-$([guid]::NewGuid()).ps1"
$TerminalSettingsScriptFile = Join-Path ([System.IO.Path]::GetTempPath()) "pi-workbench-terminal-$([guid]::NewGuid()).mjs"
$WarpSettingsScriptFile = Join-Path ([System.IO.Path]::GetTempPath()) "pi-workbench-warp-$([guid]::NewGuid()).mjs"

try {
  Invoke-WebRequest -UseBasicParsing -Uri $ConfigScriptUrl -OutFile $ConfigScriptFile
  Invoke-WebRequest -UseBasicParsing -Uri $FontSetupScriptUrl -OutFile $FontSetupScriptFile
  Invoke-WebRequest -UseBasicParsing -Uri $TerminalSettingsScriptUrl -OutFile $TerminalSettingsScriptFile
  Invoke-WebRequest -UseBasicParsing -Uri $WarpSettingsScriptUrl -OutFile $WarpSettingsScriptFile
  node $ConfigScriptFile

  foreach ($Package in $PiPackages) {
    pi install $Package
  }
  pi update --extensions

  node $ConfigScriptFile
  & $FontSetupScriptFile -TerminalSettingsScript $TerminalSettingsScriptFile -WarpSettingsScript $WarpSettingsScriptFile
} finally {
  Remove-Item $ConfigScriptFile -Force -ErrorAction SilentlyContinue
  Remove-Item $FontSetupScriptFile -Force -ErrorAction SilentlyContinue
  Remove-Item $TerminalSettingsScriptFile -Force -ErrorAction SilentlyContinue
  Remove-Item $WarpSettingsScriptFile -Force -ErrorAction SilentlyContinue
}

Write-Host 'Done. Restart Pi with: pi'
