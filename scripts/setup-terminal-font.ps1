param(
  [string[]]$TerminalSettingsFiles,
  [string]$TerminalSettingsScript,
  [string]$FontSourceDirectory,
  [string]$FontInstallDirectory,
  [string]$FontRegistryPath,
  [string]$FontVersionMarkerFile
)

$ErrorActionPreference = 'Stop'

$FontFamily = 'CaskaydiaMono NFM'
$FontVersion = '3.4.0'
$FontArchiveUrl = "https://github.com/ryanoasis/nerd-fonts/releases/download/v$FontVersion/CascadiaMono.tar.xz"
$FontArchiveSha256 = '7c22db8c8460ef62abffbb6d5c7b212507de0798a4a762fa2a005a8bc4c90fc6'
$FontFiles = @(
  'CaskaydiaMonoNerdFontMono-Regular.ttf',
  'CaskaydiaMonoNerdFontMono-Bold.ttf',
  'CaskaydiaMonoNerdFontMono-Italic.ttf',
  'CaskaydiaMonoNerdFontMono-BoldItalic.ttf'
)
$FontRegistryNames = @{
  'CaskaydiaMonoNerdFontMono-Regular.ttf' = 'CaskaydiaMono NFM (TrueType)'
  'CaskaydiaMonoNerdFontMono-Bold.ttf' = 'CaskaydiaMono NFM Bold (TrueType)'
  'CaskaydiaMonoNerdFontMono-Italic.ttf' = 'CaskaydiaMono NFM Italic (TrueType)'
  'CaskaydiaMonoNerdFontMono-BoldItalic.ttf' = 'CaskaydiaMono NFM Bold Italic (TrueType)'
}

if (-not $FontInstallDirectory) {
  $FontInstallDirectory = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
}
if (-not $FontRegistryPath) {
  $FontRegistryPath = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
}
if (-not $FontVersionMarkerFile) {
  $FontVersionMarkerFile = Join-Path $FontInstallDirectory '.amabdomo-caskaydiamono-nfm-version'
}
if (-not $TerminalSettingsScript) {
  $TerminalSettingsScript = Join-Path $PSScriptRoot 'set-terminal-font.mjs'
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
  return Join-Path $FontInstallDirectory "amabdomo-$FontVersion-$FontFile"
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
  }

  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($FontVersionMarkerFile, $FontVersion, $utf8WithoutBom)
}

function Set-WindowsTerminalFont([string[]]$SettingsFiles) {
  if (-not (Test-Path $TerminalSettingsScript)) {
    throw "Terminal settings helper not found: $TerminalSettingsScript"
  }
  $existingSettingsFiles = @($SettingsFiles | Select-Object -Unique | Where-Object { Test-Path $_ })
  if ($existingSettingsFiles.Count -eq 0) {
    Write-Warning 'No Windows Terminal settings files were found. The Nerd Font was installed but must be selected manually.'
    return
  }

  & node $TerminalSettingsScript $FontFamily @existingSettingsFiles
  if ($LASTEXITCODE -ne 0) { throw 'Could not configure Windows Terminal settings.' }
}

if ($env:OS -ne 'Windows_NT') {
  Write-Host 'Skipping Windows Terminal Nerd Font setup on this operating system.'
  exit 0
}

$temporaryDirectory = $null
try {
  if (-not (Test-NerdFontInstalled) -or $FontSourceDirectory) {
    if (-not $FontSourceDirectory) {
      $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "amabdomo-pi-font-$([guid]::NewGuid())"
      New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
      $archiveFile = Join-Path $temporaryDirectory 'CascadiaMono.tar.xz'
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
  Set-WindowsTerminalFont $TerminalSettingsFiles
  Write-Host "Installed $FontFamily $FontVersion. Close every Windows Terminal window and reopen it."
} finally {
  if ($temporaryDirectory) { Remove-Item $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue }
}
