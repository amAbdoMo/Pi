$ErrorActionPreference = 'Stop'

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -ne $Expected) { throw "$Message. Expected '$Expected', got '$Actual'." }
}

$repositoryRoot = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "pi-font-test-$([guid]::NewGuid())"
$fontSourceDirectory = Join-Path $testRoot 'source'
$fontInstallDirectory = Join-Path $testRoot 'installed'
$settingsFile = Join-Path $testRoot 'settings.json'
$warpSettingsFile = Join-Path $testRoot 'warp-settings.toml'
$versionMarker = Join-Path $fontInstallDirectory 'version'
$registryPath = "HKCU:\Software\amAbdoMo\PiFontTests\$([guid]::NewGuid())"
$fontFiles = @(
  'DejaVuSansMNerdFontMono-Regular.ttf',
  'DejaVuSansMNerdFontMono-Bold.ttf',
  'DejaVuSansMNerdFontMono-Oblique.ttf',
  'DejaVuSansMNerdFontMono-BoldOblique.ttf'
)
$registryNames = @(
  'DejaVuSansM Nerd Font Mono (TrueType)',
  'DejaVuSansM Nerd Font Mono Bold (TrueType)',
  'DejaVuSansM Nerd Font Mono Oblique (TrueType)',
  'DejaVuSansM Nerd Font Mono Bold Oblique (TrueType)'
)

try {
  New-Item -ItemType Directory -Path $fontSourceDirectory -Force | Out-Null
  foreach ($fontFile in $fontFiles) {
    [System.IO.File]::WriteAllText((Join-Path $fontSourceDirectory $fontFile), "test font: $fontFile")
  }
  [System.IO.File]::WriteAllText($settingsFile, @'
{
  // Valid Windows Terminal JSONC
  "defaultProfile": "pwsh",
  "profiles": {
    "defaults": { "opacity": 90, },
    "list": [{ "name": "PowerShell" }],
  },
}
'@)
  [System.IO.File]::WriteAllText($warpSettingsFile, @'
[appearance.text]
font_size = 16.0

[terminal.input]
input_box_type_setting = "universal"
'@)

  $setupArguments = @{
    TerminalSettingsFiles = @($settingsFile)
    TerminalSettingsScript = (Join-Path $repositoryRoot 'scripts\set-terminal-font.mjs')
    WarpSettingsFiles = @($warpSettingsFile)
    WarpSettingsScript = (Join-Path $repositoryRoot 'scripts\set-warp-settings.mjs')
    FontSourceDirectory = $fontSourceDirectory
    FontInstallDirectory = $fontInstallDirectory
    FontRegistryPath = $registryPath
    FontVersionMarkerFile = $versionMarker
  }
  & (Join-Path $repositoryRoot 'scripts\setup-terminal-font.ps1') @setupArguments

  Assert-Equal (Get-Content -Raw $versionMarker) '3.4.0' 'Version marker was not written'
  for ($index = 0; $index -lt $fontFiles.Count; $index++) {
    $installedFontPath = Join-Path $fontInstallDirectory "amabdomo-3.4.0-$($fontFiles[$index])"
    if (-not (Test-Path $installedFontPath)) { throw "Missing installed font: $installedFontPath" }
    Assert-Equal (Get-ItemPropertyValue -Path $registryPath -Name $registryNames[$index]) $installedFontPath "Incorrect registry path for $($registryNames[$index])"
  }

  $configuredSettings = Get-Content -Raw $settingsFile | ConvertFrom-Json
  Assert-Equal $configuredSettings.defaultProfile 'pwsh' 'Default profile was not preserved'
  Assert-Equal $configuredSettings.profiles.defaults.opacity 90 'Profile defaults were not preserved'
  Assert-Equal $configuredSettings.profiles.defaults.font.face 'DejaVuSansM Nerd Font Mono' 'Nerd Font was not configured'
  Assert-Equal $configuredSettings.profiles.defaults.font.features.curs 1 'Arabic cursive positioning was not enabled'
  Assert-Equal $configuredSettings.profiles.defaults.font.features.rlig 1 'Required ligatures were not enabled'
  Assert-Equal $configuredSettings.profiles.defaults.font.features.liga 1 'Standard ligatures were not enabled'
  if (-not (Test-Path "$settingsFile.amabdomo-pi-backup")) { throw 'Windows Terminal settings backup was not created' }

  $configuredWarpSettings = Get-Content -Raw $warpSettingsFile
  if ($configuredWarpSettings -notmatch 'font_name = "DejaVuSansM Nerd Font Mono"') { throw 'Warp Nerd Font was not configured' }
  if ($configuredWarpSettings -notmatch 'input_box_type_setting = "classic"') { throw 'Warp classic input was not configured' }
  if (-not (Test-Path "$warpSettingsFile.amabdomo-pi-backup")) { throw 'Warp settings backup was not created' }

  Remove-Item $fontSourceDirectory -Recurse -Force
  $setupArguments.Remove('FontSourceDirectory')
  & (Join-Path $repositoryRoot 'scripts\setup-terminal-font.ps1') @setupArguments
  Write-Host 'Windows Nerd Font setup tests passed.'
} finally {
  Remove-Item $registryPath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
