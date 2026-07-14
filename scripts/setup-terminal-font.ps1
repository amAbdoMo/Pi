param(
  [string[]]$TerminalSettingsFiles,
  [string]$TerminalSettingsScript,
  [string[]]$WarpSettingsFiles,
  [string]$WarpSettingsScript,
  [string]$FontSourceDirectory,
  [string]$FontInstallDirectory,
  [string]$FontRegistryPath,
  [string]$FontVersionMarkerFile
)

$ErrorActionPreference = 'Stop'
$WarpSettingsFilesProvided = $PSBoundParameters.ContainsKey('WarpSettingsFiles')

$FontFamily = 'DejaVuSansM Nerd Font Mono'
$FontVersion = '3.4.0'
$FontArchiveUrl = "https://github.com/ryanoasis/nerd-fonts/releases/download/v$FontVersion/DejaVuSansMono.tar.xz"
$FontArchiveSha256 = '0e58ff9c1f9378922b7f324fdba953929d88d61b36aedd80ee43964567b226cc'
$FontFiles = @(
  'DejaVuSansMNerdFontMono-Regular.ttf',
  'DejaVuSansMNerdFontMono-Bold.ttf',
  'DejaVuSansMNerdFontMono-Oblique.ttf',
  'DejaVuSansMNerdFontMono-BoldOblique.ttf'
)
$FontRegistryNames = @{
  'DejaVuSansMNerdFontMono-Regular.ttf' = 'DejaVuSansM Nerd Font Mono (TrueType)'
  'DejaVuSansMNerdFontMono-Bold.ttf' = 'DejaVuSansM Nerd Font Mono Bold (TrueType)'
  'DejaVuSansMNerdFontMono-Oblique.ttf' = 'DejaVuSansM Nerd Font Mono Oblique (TrueType)'
  'DejaVuSansMNerdFontMono-BoldOblique.ttf' = 'DejaVuSansM Nerd Font Mono Bold Oblique (TrueType)'
}

if (-not $FontInstallDirectory) {
  $FontInstallDirectory = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
}
if (-not $FontRegistryPath) {
  $FontRegistryPath = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
}
if (-not $FontVersionMarkerFile) {
  $FontVersionMarkerFile = Join-Path $FontInstallDirectory '.pi-workbench-dejavusansm-nfm-version'
}
if (-not $TerminalSettingsScript) {
  $TerminalSettingsScript = Join-Path $PSScriptRoot 'set-terminal-font.mjs'
}
if (-not $WarpSettingsScript) {
  $WarpSettingsScript = Join-Path $PSScriptRoot 'set-warp-settings.mjs'
}

function Get-FileSha256([string]$FilePath) {
  $stream = [System.IO.File]::OpenRead($FilePath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Get-InstalledFontPath([string]$FontFile) {
  return Join-Path $FontInstallDirectory "pi-workbench-$FontVersion-$FontFile"
}

function Test-NerdFontInstalled {
  if (-not (Test-Path $FontVersionMarkerFile)) { return $false }
  if ((Get-Content -Raw $FontVersionMarkerFile).Trim() -ne $FontVersion) { return $false }

  foreach ($fontFile in $FontFiles) {
    $destinationPath = Get-InstalledFontPath $fontFile
    if (-not (Test-Path $destinationPath)) { return $false }
    $registeredPath = Get-ItemPropertyValue -Path $FontRegistryPath -Name $FontRegistryNames[$fontFile] -ErrorAction SilentlyContinue
    if ($registeredPath -ne $destinationPath) { return $false }
  }
  return $true
}

function Install-NerdFontFiles([string]$SourceDirectory) {
  New-Item -ItemType Directory -Force -Path $FontInstallDirectory | Out-Null
  New-Item -Force -Path $FontRegistryPath | Out-Null

  foreach ($fontFile in $FontFiles) {
    $sourcePath = Join-Path $SourceDirectory $fontFile
    if (-not (Test-Path $sourcePath)) { throw "Font archive is missing $fontFile" }

    $destinationPath = Get-InstalledFontPath $fontFile
    Copy-Item -Force -Path $sourcePath -Destination $destinationPath
    New-ItemProperty -Path $FontRegistryPath -Name $FontRegistryNames[$fontFile] -Value $destinationPath -PropertyType String -Force | Out-Null
    $legacyDestinationPath = Join-Path $FontInstallDirectory "amabdomo-$FontVersion-$fontFile"
    Remove-Item $legacyDestinationPath -Force -ErrorAction SilentlyContinue
  }

  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($FontVersionMarkerFile, $FontVersion, $utf8WithoutBom)
  Remove-Item (Join-Path $FontInstallDirectory '.amabdomo-dejavusansm-nfm-version') -Force -ErrorAction SilentlyContinue
}

function Set-WindowsTerminalFont([string[]]$SettingsFiles) {
  if (-not (Test-Path $TerminalSettingsScript)) {
    throw "Terminal settings helper not found: $TerminalSettingsScript"
  }
  $existingSettingsFiles = @($SettingsFiles | Select-Object -Unique | Where-Object { Test-Path $_ })
  if ($existingSettingsFiles.Count -eq 0) {
    Write-Warning 'No Windows Terminal settings files were found; skipping Windows Terminal configuration.'
    return
  }

  & node $TerminalSettingsScript $FontFamily @existingSettingsFiles
  if ($LASTEXITCODE -ne 0) { throw 'Could not configure Windows Terminal settings.' }
}

function Set-WarpTerminalSettings([string[]]$SettingsFiles) {
  $existingSettingsFiles = @($SettingsFiles | Select-Object -Unique | Where-Object { Test-Path $_ })
  if ($existingSettingsFiles.Count -eq 0) { return }
  if (-not (Test-Path $WarpSettingsScript)) {
    throw "Warp settings helper not found: $WarpSettingsScript"
  }

  & node $WarpSettingsScript $FontFamily @existingSettingsFiles
  if ($LASTEXITCODE -ne 0) { throw 'Could not configure Warp terminal settings.' }
}

if ($env:OS -ne 'Windows_NT') {
  Write-Host 'Skipping Windows Terminal Nerd Font setup on this operating system.'
  exit 0
}

$temporaryDirectory = $null
try {
  if (-not (Test-NerdFontInstalled) -or $FontSourceDirectory) {
    if (-not $FontSourceDirectory) {
      $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "pi-workbench-font-$([guid]::NewGuid())"
      New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
      $archiveFile = Join-Path $temporaryDirectory 'DejaVuSansMono.tar.xz'
      Invoke-WebRequest -UseBasicParsing -Uri $FontArchiveUrl -OutFile $archiveFile
      if ((Get-FileSha256 $archiveFile) -ne $FontArchiveSha256) {
        throw 'Downloaded Nerd Font archive failed SHA-256 verification.'
      }
      & "$env:SystemRoot\System32\tar.exe" -xf $archiveFile -C $temporaryDirectory
      if ($LASTEXITCODE -ne 0) { throw 'Could not extract the Nerd Font archive.' }
      $FontSourceDirectory = $temporaryDirectory
    }
    Install-NerdFontFiles $FontSourceDirectory
  }

  if (-not $TerminalSettingsFiles) {
    $TerminalSettingsFiles = @(
      (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json'),
      (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState\settings.json'),
      (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\settings.json')
    )
  }
  if (-not $WarpSettingsFilesProvided) {
    $WarpSettingsFiles = @(
      (Join-Path $env:LOCALAPPDATA 'warp\Warp\config\settings.toml')
    )
  }
  Set-WindowsTerminalFont $TerminalSettingsFiles
  Set-WarpTerminalSettings $WarpSettingsFiles
  Write-Host "Installed $FontFamily $FontVersion. Close every Windows Terminal and Warp window, then reopen your terminal."
} finally {
  if ($temporaryDirectory) { Remove-Item $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue }
}
