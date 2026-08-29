param(
  [string]$SourceRoot,
  [string]$WorkbenchPackage = 'git:github.com/amAbdoMo/Pi@v0.13.0',
  [string]$ContextModePackage = 'npm:context-mode@1.0.169',
  [switch]$SkipFfmpeg,
  [switch]$SkipTerminal
)

$ErrorActionPreference = 'Stop'
$RepositoryRawBase = 'https://raw.githubusercontent.com/amAbdoMo/Pi/v0.13.0'
$PiPackages = @($WorkbenchPackage, $ContextModePackage)
$DownloadedFiles = @()
$PreviousWorkbenchPackageSpec = $env:PI_WORKBENCH_PACKAGE_SPEC

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
  $env:PI_WORKBENCH_PACKAGE_SPEC = $WorkbenchPackage
  if ($SourceRoot) {
    $SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
  }

  $ConfigScriptFile = Resolve-SetupAsset 'scripts/apply-config.mjs'
  $RetirementScriptFile = Resolve-SetupAsset 'scripts/retire-packages.mjs'
  $DependencyRefreshScriptFile = Resolve-SetupAsset 'scripts/refresh-managed-dependencies.mjs'
  $FfmpegSetupScriptFile = Resolve-SetupAsset 'scripts/setup-ffmpeg.mjs'
  $BrowserSetupScriptFile = Resolve-SetupAsset 'scripts/setup-browser-mcp.mjs'
  $BrowserSupervisorFile = Resolve-SetupAsset 'scripts/browser/pi-browser-mcp.ps1'
  $BrowserIdleWatcherFile = Resolve-SetupAsset 'scripts/browser/pi-browser-idle-close.ps1'
  $SystemPolicyFile = Resolve-SetupAsset 'APPEND_SYSTEM.md'
  $FontSetupScriptFile = Resolve-SetupAsset 'scripts/setup-terminal-font.ps1'
  $TerminalSettingsScriptFile = Resolve-SetupAsset 'scripts/set-terminal-font.mjs'
  $WarpSettingsScriptFile = Resolve-SetupAsset 'scripts/set-warp-settings.mjs'

  Invoke-CheckedNative -Command 'node' -Arguments @($RetirementScriptFile)
  Invoke-CheckedNative -Command 'node' -Arguments @($ConfigScriptFile, '--system-policy', $SystemPolicyFile)

  foreach ($Package in $PiPackages) {
    Invoke-CheckedNative -Command 'pi' -Arguments @('install', $Package)
  }
  Invoke-CheckedNative -Command 'node' -Arguments @($ConfigScriptFile, '--system-policy', $SystemPolicyFile)
  Invoke-CheckedNative -Command 'node' -Arguments @($DependencyRefreshScriptFile)
  Invoke-CheckedNative -Command 'node' -Arguments @(
    $BrowserSetupScriptFile,
    '--supervisor', $BrowserSupervisorFile,
    '--watcher', $BrowserIdleWatcherFile
  )

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

  if (-not $SkipTerminal) {
    & $FontSetupScriptFile -TerminalSettingsScript $TerminalSettingsScriptFile -WarpSettingsScript $WarpSettingsScriptFile
  }
} finally {
  $env:PI_WORKBENCH_PACKAGE_SPEC = $PreviousWorkbenchPackageSpec
  foreach ($DownloadedFile in $DownloadedFiles) {
    Remove-Item $DownloadedFile -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'Done. Restart Pi with: pi'
