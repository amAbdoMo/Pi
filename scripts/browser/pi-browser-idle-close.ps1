# Detached idle watcher for the shared Pi browser.
#
# A single watcher removes stale client locks and closes only the Edge process
# that owns the Pi browser profile after every MCP client has been gone for the
# full grace period.

[CmdletBinding()]
param(
    [int]$DebugPort = 9222,
    [int]$GraceSeconds = 60,
    [int]$PollSeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

$profileDir = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.pi-browser-profile'))
$lockDir = Join-Path $env:USERPROFILE '.pi\agent\mcp-output\browser-mcp-locks'
$watcherMutexName = "Local\PiBrowserIdleWatcher-$DebugPort"

function Get-LiveClientLocks {
    foreach ($file in Get-ChildItem -LiteralPath $lockDir -Filter 'client-*.lock' -File -ErrorAction SilentlyContinue) {
        $rawLock = [string](Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue)
        $parts = $rawLock.Trim() -split '\|', 2
        $ownerPid = 0
        $expectedStartTicks = 0L
        if ($parts.Count -ge 1) { [int]::TryParse($parts[0], [ref]$ownerPid) | Out-Null }
        if ($parts.Count -ge 2) { [long]::TryParse($parts[1], [ref]$expectedStartTicks) | Out-Null }

        $owner = if ($ownerPid) { Get-Process -Id $ownerPid -ErrorAction SilentlyContinue } else { $null }
        $startMatches = $owner -and $expectedStartTicks -and $owner.StartTime.ToUniversalTime().Ticks -eq $expectedStartTicks
        if ($startMatches) {
            $file
        } else {
            Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
        }
    }
}

function Stop-SharedBrowser {
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf($profileDir, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $_.CommandLine.IndexOf("--remote-debugging-port=$DebugPort", [StringComparison]::OrdinalIgnoreCase) -ge 0
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
$mutex = [Threading.Mutex]::new($false, $watcherMutexName)
$acquired = $false
try {
    try {
        $acquired = $mutex.WaitOne(0)
    } catch [Threading.AbandonedMutexException] {
        $acquired = $true
    }
    if (-not $acquired) { exit 0 }

    $idleSince = $null
    while ($true) {
        $liveCount = @(Get-LiveClientLocks).Count
        if ($liveCount -gt 0) {
            $idleSince = $null
        } elseif ($null -eq $idleSince) {
            $idleSince = [DateTime]::UtcNow
        } elseif (([DateTime]::UtcNow - $idleSince).TotalSeconds -ge $GraceSeconds) {
            Stop-SharedBrowser
            break
        }
        Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
    }
} finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}

exit 0
