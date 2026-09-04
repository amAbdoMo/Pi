[CmdletBinding()]
param(
    [ValidateSet('Install', 'Uninstall', 'Status')]
    [string]$Action = 'Install'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'Pi Harness automatic startup is supported only on Windows.'
}

$taskName = 'Pi Harness'
$managedDescription = 'Managed by Pi Workbench: starts the loopback-only Pi Harness at user sign-in.'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$launcherPath = Join-Path $PSScriptRoot 'pi-harness-background.mjs'
$supervisorPath = Join-Path $PSScriptRoot 'run-pi-harness-background.ps1'
$windowlessLauncherPath = Join-Path $PSScriptRoot 'run-pi-harness-hidden.vbs'
$scriptHostPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$agentDirectory = if ($env:PI_CODING_AGENT_DIR) { $env:PI_CODING_AGENT_DIR } else { Join-Path $HOME '.pi\agent' }
$pidPath = Join-Path $agentDirectory 'browser-locks\pi-harness-background.pid'

function Get-ManagedTask {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $task -and $task.Description -ne $managedDescription) {
        throw "A scheduled task named '$taskName' already exists and is not managed by Pi Workbench."
    }
    return $task
}

function Get-ManagedProcess {
    $recordedPid = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue
    $processId = 0
    if (-not $recordedPid -or -not [int]::TryParse($recordedPid, [ref]$processId)) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    $isOwnedNode = $null -ne $process `
        -and $process.Name -eq 'node.exe' `
        -and $process.CommandLine.IndexOf($launcherPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($isOwnedNode) { return $process }
    return $null
}

function Stop-ManagedProcess {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    $process = Get-ManagedProcess
    if ($null -ne $process) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

switch ($Action) {
    'Install' {
        $powerShellPath = (Get-Process -Id $PID).Path
        foreach ($requiredPath in @($launcherPath, $supervisorPath, $windowlessLauncherPath, $scriptHostPath)) {
            if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
                throw "Pi Harness background launcher is missing: $requiredPath"
            }
        }
        foreach ($startupPath in @($powerShellPath, $supervisorPath, $windowlessLauncherPath, $scriptHostPath)) {
            if ($startupPath.Contains('"')) {
                throw 'Pi Harness startup paths contain unsupported quote characters.'
            }
        }

        $existingTask = Get-ManagedTask
        if ($null -ne $existingTask) { Stop-ManagedProcess }
        $taskAction = New-ScheduledTaskAction `
            -Execute $scriptHostPath `
            -Argument ('"{0}" "{1}" "{2}"' -f $windowlessLauncherPath, $powerShellPath, $supervisorPath) `
            -WorkingDirectory $repositoryRoot
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
        $principal = New-ScheduledTaskPrincipal `
            -UserId $currentUser `
            -LogonType Interactive `
            -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -Hidden `
            -MultipleInstances IgnoreNew `
            -RestartCount 3 `
            -RestartInterval (New-TimeSpan -Minutes 1) `
            -StartWhenAvailable
        $task = New-ScheduledTask `
            -Action $taskAction `
            -Description $managedDescription `
            -Principal $principal `
            -Settings $settings `
            -Trigger $trigger

        Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
        Start-ScheduledTask -TaskName $taskName
        Write-Output "Pi Harness automatic startup is installed and starting now."
    }
    'Uninstall' {
        $task = Get-ManagedTask
        if ($null -eq $task) {
            Write-Output 'Pi Harness automatic startup is not installed.'
            break
        }
        Stop-ManagedProcess
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Output 'Pi Harness automatic startup was removed.'
    }
    'Status' {
        $task = Get-ManagedTask
        if ($null -eq $task) {
            Write-Output 'Pi Harness automatic startup is not installed.'
            break
        }
        $process = Get-ManagedProcess
        if ($null -ne $process) {
            Write-Output "Pi Harness automatic startup: Running; process: $($process.ProcessId); task state: $($task.State)"
        }
        else {
            $info = Get-ScheduledTaskInfo -TaskName $taskName
            Write-Output "Pi Harness automatic startup: $($task.State); last result: $($info.LastTaskResult)"
        }
    }
}
