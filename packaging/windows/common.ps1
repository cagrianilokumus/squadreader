# Shared by install.ps1, sqreaderctl.ps1 and uninstall.ps1. Dot-source it.
# ASCII only: Windows PowerShell 5.1 reads a BOM-less script as ANSI.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$SqrRoot     = $PSScriptRoot
$SqrPython   = Join-Path $SqrRoot "python\python.exe"
$SqrSettings = Join-Path $SqrRoot "install.json"
$SqrState    = Join-Path $SqrRoot "state"
$SqrStopFile = Join-Path $SqrState "sqreader.stop"
$SqrLog      = Join-Path $SqrRoot "logs\sqreader.log"
$script:SqrPassword = ""     # install.ps1 sets it when -UserPassword is used

function Write-Sqr([string]$msg)  { Write-Host "[sqreader] $msg" }
function Write-SqrWarn([string]$msg) { Write-Host "[sqreader] WARNING: $msg" -ForegroundColor Yellow }

function Test-SqrAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-SqrSettings {
    if (-not (Test-Path $SqrSettings)) {
        throw "not installed here (no install.json in $SqrRoot). Run install.ps1 first."
    }
    return Get-Content $SqrSettings -Raw | ConvertFrom-Json
}

function Invoke-SqrCli([string[]]$CliArgs) {
    # Run the packaged CLI in the install folder, as the current user, and
    # return its exit code. Its output goes to the console, NOT into the
    # return value (PowerShell would otherwise mix the two). Stderr is
    # informational here; 'Continue' keeps PS 5.1 from turning it into errors.
    $ErrorActionPreference = "Continue"
    Push-Location $SqrRoot
    try {
        & $SqrPython -m sqreader.cli @CliArgs | Out-Host
        return $LASTEXITCODE
    } finally { Pop-Location }
}

function Test-SqrServiceAccount([string]$user) {
    return $user -match '^(NT AUTHORITY\\)?(SYSTEM|LOCAL SERVICE|NETWORK SERVICE)$'
}

function Register-SqrTask {
    # One scheduled task, run as the account that runs the game server.
    #   S4U          : "run whether the user is logged on or not", no stored
    #                  password; enough, since the reader needs only local access
    #   ServiceAccount: SYSTEM / LOCAL SERVICE / NETWORK SERVICE
    #   Password     : when S4U is not allowed for that account
    #   Interactive  : only while that user is logged on (testing without admin)
    param(
        [Parameter(Mandatory)] [string]$TaskName,
        [Parameter(Mandatory)] $Action,
        $Trigger = $null,
        [Parameter(Mandatory)] $Settings,
        [Parameter(Mandatory)] [string]$User,
        [string]$Password = "",
        [string]$RunLevel = "Limited",
        [switch]$Interactive
    )
    $common = @{ TaskName = $TaskName; Action = $Action; Settings = $Settings; Force = $true }
    if ($Trigger) { $common.Trigger = $Trigger }
    if ($Password) {
        Register-ScheduledTask @common -User $User -Password $Password -RunLevel $RunLevel | Out-Null
        return
    }
    if ($Interactive) {
        $p = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel $RunLevel
    } elseif (Test-SqrServiceAccount $User) {
        $p = New-ScheduledTaskPrincipal -UserId $User -LogonType ServiceAccount -RunLevel $RunLevel
    } else {
        $p = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel $RunLevel
    }
    Register-ScheduledTask @common -Principal $p | Out-Null
}

function Wait-SqrTaskIdle([string]$TaskName, [int]$TimeoutSec) {
    # True once the task has run and is no longer running.
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if (-not $t) { return $true }
        $info = Get-ScheduledTaskInfo -TaskName $TaskName
        # 267011 = has not run yet, 267009 = running
        if ($t.State -ne "Running" -and $info.LastTaskResult -ne 267011 -and $info.LastTaskResult -ne 267009) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Invoke-SqrAsTaskUser {
    # Run one CLI command AS the service account, through a throwaway task,
    # and return its output. This is the honest test of what the reader will
    # be able to do: same account, same privileges, same folder.
    param(
        [Parameter(Mandatory)] $Cfg,
        [Parameter(Mandatory)] [string]$CliArgs,
        [string]$RunLevel = "",
        [int]$TimeoutSec = 300
    )
    if (-not $RunLevel) { $RunLevel = $Cfg.RunLevel }
    $name = "$($Cfg.TaskName)-oneshot"
    $out = Join-Path $SqrState "oneshot-output.txt"
    Remove-Item $out -ErrorAction SilentlyContinue
    $cmd = "/c `"`"$SqrPython`" -m sqreader.cli $CliArgs > `"$out`" 2>&1`""
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" `
        -Argument $cmd -WorkingDirectory $SqrRoot
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-SqrTask -TaskName $name -Action $action -Trigger $null -Settings $settings `
        -User $Cfg.User -Password $script:SqrPassword -RunLevel $RunLevel `
        -Interactive:([bool]$Cfg.Interactive)
    try {
        Start-ScheduledTask -TaskName $name
        if (-not (Wait-SqrTaskIdle $name $TimeoutSec)) {
            Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
            throw "'$CliArgs' as $($Cfg.User) did not finish within $TimeoutSec s"
        }
    } finally {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $out)) { return "" }
    return Get-Content $out -Raw
}

function Stop-SqrReader {
    # Clean stop: the stop file makes serve close its recording and exit, then
    # the supervisor exits. Only if that does not happen in time is the task
    # ended (TerminateProcess; the job object takes every child with it).
    param([Parameter(Mandatory)] $Cfg, [int]$TimeoutSec = 90)
    $t = Get-ScheduledTask -TaskName $Cfg.TaskName -ErrorAction SilentlyContinue
    if (-not $t -or $t.State -ne "Running") { return "not running" }
    Set-Content -Path $SqrStopFile -Value "stop" -Encoding Ascii
    if (Wait-SqrTaskIdle $Cfg.TaskName $TimeoutSec) { return "stopped cleanly" }
    Stop-ScheduledTask -TaskName $Cfg.TaskName
    Remove-Item $SqrStopFile -ErrorAction SilentlyContinue
    return "did not stop within $TimeoutSec s; task ended"
}

function Get-SqrLogSize {
    if (Test-Path $SqrLog) { return (Get-Item $SqrLog).Length }
    return 0
}

function Get-SqrLogSince([long]$Offset) {
    # What the log gained after $Offset bytes: lets a caller look only at
    # what THIS start wrote, not at an older run's lines still in the file.
    if (-not (Test-Path $SqrLog)) { return "" }
    $fs = [IO.File]::Open($SqrLog, "Open", "Read", "ReadWrite, Delete")
    try {
        if ($fs.Length -lt $Offset) { $Offset = 0 }      # rotated meanwhile
        [void]$fs.Seek($Offset, "Begin")
        $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
        return $sr.ReadToEnd()
    } finally { $fs.Dispose() }
}

function Get-SqrLogTail([int]$Lines = 20) {
    if (-not (Test-Path $SqrLog)) { return @() }
    # The log is UTF-8 without a BOM, which PS 5.1 would read as ANSI.
    return Get-Content $SqrLog -Tail $Lines -Encoding UTF8
}
