# Shared Playwright MCP supervisor for Pi sessions.
#
# Every Pi session gets its own Playwright MCP stdio process. Those processes
# attach to one persistent Edge instance through CDP, so they can create and
# select independent tabs while sharing the logged-in browser profile.

[CmdletBinding()]
param(
    [switch]$Isolated,
    [int]$DebugPort = 9222,
    [int]$StartupTimeoutSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$windowsDir = if ($env:SystemRoot) { $env:SystemRoot } else { 'C:\Windows' }
if (-not $env:WINDIR) { $env:WINDIR = $windowsDir }
if (-not $env:COMSPEC) { $env:COMSPEC = Join-Path $windowsDir 'System32\cmd.exe' }
if (-not (($env:PATHEXT -split ';') -contains '.CMD')) {
    $env:PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL'
}

$profileDir = Join-Path $env:USERPROFILE '.pi-browser-profile'
$outputDir = Join-Path $env:LOCALAPPDATA 'Temp\pi-verification-artifacts'
$lockDir = Join-Path $env:USERPROFILE '.pi\agent\mcp-output\browser-mcp-locks'
$watcherPath = Join-Path $PSScriptRoot 'pi-browser-idle-close.ps1'
$clientLock = Join-Path $lockDir "client-$PID.lock"
$startupMutexName = "Local\PiBrowserMcpStartup-$DebugPort"

function Test-DebugPort {
    param([int]$Port)

    $client = [Net.Sockets.TcpClient]::new()
    try {
        return $client.ConnectAsync('127.0.0.1', $Port).Wait(300) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Get-EdgeExecutable {
    $candidates = [Collections.Generic.List[string]]::new()
    $edgeCommand = Get-Command 'msedge.exe' -ErrorAction SilentlyContinue
    if ($edgeCommand -and $edgeCommand.Source) { $candidates.Add($edgeCommand.Source) }
    if (${env:ProgramFiles(x86)}) { $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')) }
    if ($env:ProgramFiles) { $candidates.Add((Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')) }
    if ($env:LOCALAPPDATA) { $candidates.Add((Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')) }

    foreach ($registryPath in @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe'
    )) {
        $registryEntry = Get-ItemProperty -Path $registryPath -ErrorAction SilentlyContinue
        $defaultValue = if ($registryEntry) { $registryEntry.PSObject.Properties['(default)'] } else { $null }
        if ($defaultValue -and $defaultValue.Value) { $candidates.Add([string]$defaultValue.Value) }
    }

    return $candidates |
        Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
        Select-Object -Unique -First 1
}

function Remove-StaleClientLocks {
    foreach ($file in Get-ChildItem -LiteralPath $lockDir -Filter 'client-*.lock' -File -ErrorAction SilentlyContinue) {
        $rawLock = [string](Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue)
        $parts = $rawLock.Trim() -split '\|', 2
        $ownerPid = 0
        $expectedStartTicks = 0L
        if ($parts.Count -ge 1) { [int]::TryParse($parts[0], [ref]$ownerPid) | Out-Null }
        if ($parts.Count -ge 2) { [long]::TryParse($parts[1], [ref]$expectedStartTicks) | Out-Null }
        $owner = if ($ownerPid) { Get-Process -Id $ownerPid -ErrorAction SilentlyContinue } else { $null }
        $startMatches = $owner -and $expectedStartTicks -and $owner.StartTime.ToUniversalTime().Ticks -eq $expectedStartTicks
        if (-not $startMatches) { Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue }
    }
}

function Start-IdleWatcher {
    if (-not (Test-Path -LiteralPath $watcherPath -PathType Leaf)) {
        throw "Browser idle watcher not found: $watcherPath"
    }

    $powerShell = (Get-Process -Id $PID).Path
    Start-Process -FilePath $powerShell -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', $watcherPath,
        '-DebugPort', $DebugPort
    ) | Out-Null
}

function Stop-StaleProfileBrowsers {
    $profileNeedle = [IO.Path]::GetFullPath($profileDir)
    $stale = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf($profileNeedle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $_.CommandLine.IndexOf("--remote-debugging-port=$DebugPort", [StringComparison]::OrdinalIgnoreCase) -lt 0
        }

    foreach ($process in $stale) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($stale) { Start-Sleep -Milliseconds 500 }
}

function Ensure-SharedBrowser {
    if (Test-DebugPort -Port $DebugPort) { return }

    Stop-StaleProfileBrowsers
    $edge = Get-EdgeExecutable
    if (-not $edge) { throw 'msedge.exe was not found in PATH, Program Files, the user profile, or App Paths.' }

    Start-Process -FilePath $edge -ArgumentList @(
        "--remote-debugging-port=$DebugPort",
        "--user-data-dir=$profileDir",
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate',
        'about:blank'
    ) | Out-Null

    $attempts = [Math]::Max(1, $StartupTimeoutSeconds * 5)
    for ($attempt = 0; $attempt -lt $attempts; $attempt++) {
        if (Test-DebugPort -Port $DebugPort) { return }
        Start-Sleep -Milliseconds 200
    }
    throw "Edge did not expose CDP port $DebugPort within $StartupTimeoutSeconds seconds."
}

function Invoke-WithStartupMutex {
    $mutex = [Threading.Mutex]::new($false, $startupMutexName)
    $acquired = $false
    try {
        try {
            $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($StartupTimeoutSeconds + 5))
        } catch [Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) { throw "Timed out waiting for shared browser startup lock on port $DebugPort." }
        Ensure-SharedBrowser
    } finally {
        if ($acquired) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

$exitCode = 1
try {
    New-Item -ItemType Directory -Force -Path $lockDir, $outputDir | Out-Null
    Remove-StaleClientLocks
    $self = Get-Process -Id $PID
    $lockValue = "$PID|$($self.StartTime.ToUniversalTime().Ticks)"
    Set-Content -LiteralPath $clientLock -Value $lockValue -Encoding Ascii
    Start-IdleWatcher
    Invoke-WithStartupMutex

    $npx = (Get-Command 'npx.cmd' -ErrorAction Stop).Source
    $mcpArgs = @(
        '-y', '@playwright/mcp@latest',
        "--cdp-endpoint=http://127.0.0.1:$DebugPort",
        '--caps=vision',
        "--output-dir=$outputDir"
    )
    if ($Isolated) { $mcpArgs += '--isolated' }

    $LASTEXITCODE = 0
    & $npx @mcpArgs
    $exitCode = [int]$LASTEXITCODE
} catch {
    [Console]::Error.WriteLine("Pi browser MCP supervisor failed: $($_.Exception.Message)")
    $exitCode = 1
} finally {
    Remove-Item -LiteralPath $clientLock -Force -ErrorAction SilentlyContinue
}

exit $exitCode
