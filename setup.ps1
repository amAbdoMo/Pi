param(
  [ValidateSet('diagnose', 'install', 'verify', 'rollback')]
  [string]$Command = 'install',
  [switch]$SkipFfmpeg,
  [switch]$SkipTerminal,
  [switch]$Json,
  [string]$Checkpoint
)

$ErrorActionPreference = 'Stop'
$Arguments = @((Join-Path $PSScriptRoot 'scripts/install-cli.mjs'), $Command)
if ($SkipFfmpeg) { $Arguments += '--skip-ffmpeg' }
if ($SkipTerminal) { $Arguments += '--skip-terminal' }
if ($Json) { $Arguments += '--json' }
if ($Checkpoint) { $Arguments += @('--checkpoint', $Checkpoint) }

& node @Arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
