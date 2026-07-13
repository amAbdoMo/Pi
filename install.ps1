$ErrorActionPreference = 'Stop'

$PiPackages = @(
  'git:github.com/amAbdoMo/Pi',
  'npm:@hypabolic/pi-hypa',
  'npm:context-mode',
  'npm:pi-mcp-adapter'
)
$ConfigScriptUrl = 'https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/apply-config.mjs'
$ConfigScriptFile = Join-Path ([System.IO.Path]::GetTempPath()) "amabdomo-pi-config-$([guid]::NewGuid()).mjs"

try {
  Invoke-WebRequest -UseBasicParsing -Uri $ConfigScriptUrl -OutFile $ConfigScriptFile
  node $ConfigScriptFile

  foreach ($Package in $PiPackages) {
    pi install $Package
  }
  pi update --extensions

  node $ConfigScriptFile
} finally {
  Remove-Item $ConfigScriptFile -Force -ErrorAction SilentlyContinue
}

Write-Host 'Done. Restart Pi with: pi'
