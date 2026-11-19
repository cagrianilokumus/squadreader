<#
.SYNOPSIS
  Manage an installed sqreader: status, start, stop, restart, diagnose,
  doctor, logs. diagnose and doctor run as the reader's own account.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\sqreaderctl.ps1 status
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\sqreaderctl.ps1 diagnose
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("status", "start", "stop", "restart", "diagnose", "doctor", "logs")]
    [string]$Command,
    [int]$Lines = 40
)

. (Join-Path $PSScriptRoot "common.ps1")
$cfg = Read-SqrSettings

function Show-Status {
    $t = Get-ScheduledTask -TaskName $cfg.TaskName -ErrorAction SilentlyContinue
    if (-not $t) { Write-SqrWarn "task $($cfg.TaskName) is not registered"; return }
    $info = Get-ScheduledTaskInfo -TaskName $cfg.TaskName
    Write-Sqr ("task {0}: {1} (last start {2}, runs as {3}, {4})" -f `
        $cfg.TaskName, $t.State, $info.LastRunTime, $cfg.User, $cfg.RunLevel)
    $log = Join-Path $SqrRoot "logs\sqreader.log"
    $ret = $null
    if (Test-Path $log) {
        $ret = Select-String -Path $log -Pattern "\[retention\]" -ErrorAction SilentlyContinue |
            Select-Object -Last 1
    }
    if ($ret) { Write-Sqr "retention (daily, inside the reader): $($ret.Line)" }
    else { Write-Sqr "retention (daily, inside the reader): no run in the current log yet" }
    $rec = Join-Path $SqrRoot "recordings"
    if (Test-Path $rec) {
        $files = @(Get-ChildItem $rec -Filter *.sqrx -File -ErrorAction SilentlyContinue)
        $bytes = 0
        foreach ($f in $files) { $bytes += $f.Length }
        Write-Sqr ("recordings: {0} files, {1:N2} GB" -f $files.Count, ($bytes / 1GB))
    }
    Write-Sqr "viewer on this machine: http://127.0.0.1:$($cfg.HttpPort)/"
    Write-Sqr "last log lines (logs\sqreader.log):"
    Get-SqrLogTail 12 | ForEach-Object { Write-Host "    $_" }
}

function Start-Reader {
    $t = Get-ScheduledTask -TaskName $cfg.TaskName -ErrorAction SilentlyContinue
    if (-not $t) { throw "task $($cfg.TaskName) is not registered; run install.ps1" }
    if ($t.State -eq "Running") { Write-Sqr "already running"; return }
    Remove-Item $SqrStopFile -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $cfg.TaskName
    Write-Sqr "started"
}

switch ($Command) {
    "status"   { Show-Status }
    "start"    { Start-Reader }
    "stop"     { Write-Sqr (Stop-SqrReader -Cfg $cfg) }
    "restart"  { Write-Sqr (Stop-SqrReader -Cfg $cfg); Start-Reader }
    "logs"     { Get-SqrLogTail $Lines | ForEach-Object { Write-Host $_ } }
    { $_ -in @("diagnose", "doctor") } {
        # Both read the game, so both run AS the service account: what they
        # report is then exactly what the reader itself can see.
        if ($cfg.LogonType -eq "Password") {
            $sec = Read-Host -AsSecureString "password of $($cfg.User)"
            $script:SqrPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
        }
        $cli = $(if ($Command -eq "diagnose") { "diagnose --deep" } else { "doctor" })
        Write-Sqr "running '$cli' as $($cfg.User) (up to a minute)"
        $report = Invoke-SqrAsTaskUser -Cfg $cfg -CliArgs $cli
        $out = Join-Path $SqrRoot "$Command-latest.txt"
        [IO.File]::WriteAllText($out, $report, (New-Object Text.UTF8Encoding $false))
        Write-Host $report
        Write-Sqr "saved to $Command-latest.txt"
    }
}
