[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'Pi Harness background supervision is supported only on Windows.'
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$launcherPath = Join-Path $PSScriptRoot 'pi-harness-background.mjs'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$agentDirectory = if ($env:PI_CODING_AGENT_DIR) { $env:PI_CODING_AGENT_DIR } else { Join-Path $HOME '.pi\agent' }
$stateDirectory = Join-Path $agentDirectory 'browser-locks'
$pidPath = Join-Path $stateDirectory 'pi-harness-background.pid'

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "Pi Harness background launcher is missing: $launcherPath"
}
if ($nodePath.Contains('"') -or $launcherPath.Contains('"')) {
    throw 'Pi Harness background paths contain unsupported quote characters.'
}

$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $nodePath
$startInfo.Arguments = '"{0}"' -f $launcherPath
$startInfo.WorkingDirectory = $repositoryRoot
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $false
$startInfo.RedirectStandardOutput = $false
$startInfo.RedirectStandardError = $false

$process = [Diagnostics.Process]::new()
$process.StartInfo = $startInfo
if (-not $process.Start()) {
    throw 'Pi Harness background process did not start.'
}

New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding Ascii -NoNewline
try {
    $process.WaitForExit()
    exit $process.ExitCode
}
finally {
    $recordedPid = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue
    if ($recordedPid -eq [string]$process.Id) {
        Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    }
}
