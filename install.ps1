param(
  [string]$SourceRoot,
  [switch]$SkipFfmpeg
)

$ErrorActionPreference = 'Stop'
$RepositoryRawBase = 'https://raw.githubusercontent.com/amAbdoMo/Pi/main'
$PiPackages = @(
  'git:github.com/amAbdoMo/Pi',
  'npm:context-mode'
)
$DownloadedFiles = @()

function Invoke-CheckedNative {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
  }
}

function Resolve-SetupAsset {
  param([Parameter(Mandatory = $true)][string]$RelativePath)

  if ($SourceRoot) {
    $Candidate = Join-Path $SourceRoot $RelativePath
    if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
      throw "Missing setup asset: $Candidate"
    }
    return (Resolve-Path -LiteralPath $Candidate).Path
  }

  $Extension = [System.IO.Path]::GetExtension($RelativePath)
  $TemporaryFile = Join-Path ([System.IO.Path]::GetTempPath()) "pi-workbench-$([guid]::NewGuid())$Extension"
  $script:DownloadedFiles += $TemporaryFile
  Invoke-WebRequest -UseBasicParsing -Uri "$RepositoryRawBase/$RelativePath" -OutFile $TemporaryFile
  return $TemporaryFile
}

try {
  if ($SourceRoot) {
    $SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
  }

  $ConfigScriptFile = Resolve-SetupAsset 'scripts/apply-config.mjs'
  $RetirementScriptFile = Resolve-SetupAsset 'scripts/retire-packages.mjs'
  $DependencyRefreshScriptFile = Resolve-SetupAsset 'scripts/refresh-managed-dependencies.mjs'
  $FfmpegSetupScriptFile = Resolve-SetupAsset 'scripts/setup-ffmpeg.mjs'
  $SystemPolicyFile = Resolve-SetupAsset 'APPEND_SYSTEM.md'
  $FontSetupScriptFile = Resolve-SetupAsset 'scripts/setup-terminal-font.ps1'
  $TerminalSettingsScriptFile = Resolve-SetupAsset 'scripts/set-terminal-font.mjs'
  $WarpSettingsScriptFile = Resolve-SetupAsset 'scripts/set-warp-settings.mjs'

  Invoke-CheckedNative -Command 'node' -Arguments @($RetirementScriptFile)
  Invoke-CheckedNative -Command 'node' -Arguments @($ConfigScriptFile, '--system-policy', $SystemPolicyFile)

  foreach ($Package in $PiPackages) {
    Invoke-CheckedNative -Command 'pi' -Arguments @('install', $Package)
  }
  Invoke-CheckedNative -Command 'pi' -Arguments @('update', '--extensions')
  Invoke-CheckedNative -Command 'node' -Arguments @($ConfigScriptFile, '--system-policy', $SystemPolicyFile)
  Invoke-CheckedNative -Command 'node' -Arguments @($DependencyRefreshScriptFile)

  if (-not $SkipFfmpeg) {
    try {
      & node $FfmpegSetupScriptFile
      if ($LASTEXITCODE -ne 0) {
        Write-Warning 'FFmpeg setup was not completed; video inspection will remain unavailable until FFmpeg is installed.'
      }
    } catch {
      Write-Warning "FFmpeg setup was not completed: $($_.Exception.Message)"
    }
  }

  & $FontSetupScriptFile -TerminalSettingsScript $TerminalSettingsScriptFile -WarpSettingsScript $WarpSettingsScriptFile
} finally {
  foreach ($DownloadedFile in $DownloadedFiles) {
    Remove-Item $DownloadedFile -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'Done. Restart Pi with: pi'
