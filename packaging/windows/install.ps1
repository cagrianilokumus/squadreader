<#
.SYNOPSIS
  Install sqreader beside a Squad dedicated server on this Windows machine.

.DESCRIPTION
  Installs in place: the folder this script sits in IS the installation.
  Nothing is copied elsewhere and nothing is installed system-wide; the
  only changes outside this folder are two scheduled tasks.

    1. checks the bundled Python runs (version + selftest)
    2. writes sqreader.config.json (which game server to read)
    3. finds the Windows account the game server runs as
    4. lets that account write recordings\, stats\, logs\, state\
    5. runs `diagnose --deep` AS that account, to prove it can read the game
    6. registers the task "sqreader-<ServerId>" (at boot, restarts on failure,
       below-normal priority, CPU capped) and "sqreader-<ServerId>-retention"
       (daily clean-up of old recordings)
    7. starts the reader and shows its first log lines

  Re-running it upgrades or reconfigures: the reader is stopped cleanly
  first, and recordings, stats, logs and enrolment are kept.

.PARAMETER SkipCheck
  Do not run diagnose as the service account first (e.g. the game server is
  down). Not recommended: that check is what proves the reader can work.

.PARAMETER SquadPort
  The game port of the Squad server to read (its Port= argument). Required:
  on a machine with several servers this is what picks the right one.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -SquadPort 11271 -ServerId bluefang
#>
param(
    [Parameter(Mandatory = $true)] [int]$SquadPort,
    [ValidatePattern('^[A-Za-z0-9_-]{1,32}$')] [string]$ServerId = "squad",
    [string]$User = "",
    [string]$UserPassword = "",
    [int]$HttpPort = 8081,
    [double]$CpuLimit = 50,
    [double]$RetentionMaxAgeDays = 90,
    [double]$RetentionMaxTotalGB = 50,
    [double]$RetentionMinFreeGB = 20,
    [string]$EnrollToken = "",
    [string]$CentralUrl = "https://squadreader.com",
    [switch]$Push,
    [switch]$NoStart,
    [switch]$SkipCheck,
    [switch]$CurrentUserInteractive
)

. (Join-Path $PSScriptRoot "common.ps1")
$script:SqrPassword = $UserPassword

function Invoke-Py([string]$code) {
    # A short Python snippet in the install folder (reads its config).
    $ErrorActionPreference = "Continue"
    Push-Location $SqrRoot
    try { return (& $SqrPython -c $code 2>$null) } finally { Pop-Location }
}

function Write-Utf8NoBom([string]$path, [string]$text) {
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))
}

Write-Sqr "installing from $SqrRoot"

# --- 0. preconditions -----------------------------------------------------------
if (-not $CurrentUserInteractive -and -not (Test-SqrAdmin)) {
    throw "run this from an elevated (Run as administrator) PowerShell: it registers scheduled tasks for another account"
}
if (-not (Test-Path $SqrPython)) { throw "python\python.exe missing: is this an unpacked sqreader package?" }
Get-ChildItem -Path $SqrRoot -Recurse -File | Unblock-File   # downloaded-zip marks

# --- 1. the bundled Python ---------------------------------------------------------
Write-Sqr "checking the bundled Python"
if ((Invoke-SqrCli @("version")) -ne 0) { throw "sqreader version failed" }
if ((Invoke-SqrCli @("selftest")) -ne 0) { throw "sqreader selftest failed" }

# --- 2. stop a previous install (upgrade / reconfigure) ------------------------------
$previous = $null
if (Test-Path $SqrSettings) {
    $previous = Read-SqrSettings
    Write-Sqr ("previous install found (task {0}): {1}" -f $previous.TaskName, (Stop-SqrReader -Cfg $previous))
}

# --- 3. configuration ------------------------------------------------------------------
$cfgPath = Join-Path $SqrRoot "sqreader.config.json"
$conf = [ordered]@{}
if (Test-Path $cfgPath) {
    $old = Get-Content $cfgPath -Raw | ConvertFrom-Json
    foreach ($p in $old.PSObject.Properties) { $conf[$p.Name] = $p.Value }
}
$conf["squad_port"] = $SquadPort
$conf["server_id"] = $ServerId
if ($Push -or $EnrollToken) {
    $conf["push_enabled"] = $true
    $conf["central_url"] = $CentralUrl
}
Write-Utf8NoBom $cfgPath (($conf | ConvertTo-Json -Depth 5) + "`n")
$readBack = Invoke-Py "from sqreader import config; print(config.get('squad_port'))"
if ("$readBack".Trim() -ne "$SquadPort") {
    throw "sqreader.config.json was written but reads back squad_port='$readBack', not $SquadPort"
}
Write-Sqr "config: squad_port=$SquadPort server_id=$ServerId"

# --- 4. which account runs the game ----------------------------------------------------
if (-not $User) {
    if ($CurrentUserInteractive) {
        $User = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    } else {
        $User = "$(Invoke-Py 'from sqreader import config, winproc; print(winproc.process_user(config.find_squad_server_pid()) or str())')".Trim()
        if (-not $User) {
            throw "could not find a Squad server on port $SquadPort or read its account. Start the server, or pass -User DOMAIN\name"
        }
    }
}
Write-Sqr "the reader will run as: $User"

# --- 5. the HTTP port --------------------------------------------------------------------
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $HttpPort)
try { $listener.Start(); $listener.Stop() }
catch { throw "127.0.0.1:$HttpPort is already in use on this machine; re-run with -HttpPort <free port>" }

# --- 6. folders and permissions --------------------------------------------------------------
$dataDirs = @("recordings", "stats", "logs", "state")
foreach ($d in $dataDirs) { New-Item -ItemType Directory -Force -Path (Join-Path $SqrRoot $d) | Out-Null }
if (-not $CurrentUserInteractive) {
    & icacls $SqrRoot /grant "${User}:(OI)(CI)RX" /Q | Out-Null
    foreach ($d in $dataDirs) {
        & icacls (Join-Path $SqrRoot $d) /grant "${User}:(OI)(CI)M" /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "icacls could not grant $User access to $d" }
    }
}

$cfg = [pscustomobject]@{
    TaskName      = "sqreader-$ServerId"
    RetentionTask = "sqreader-$ServerId-retention"
    ServerId      = $ServerId
    SquadPort     = $SquadPort
    User          = $User
    RunLevel      = "Limited"
    LogonType     = $(if ($UserPassword) { "Password" } elseif ($CurrentUserInteractive) { "Interactive" } elseif (Test-SqrServiceAccount $User) { "ServiceAccount" } else { "S4U" })
    Interactive   = [bool]$CurrentUserInteractive
    HttpPort      = $HttpPort
    CpuLimit      = $CpuLimit
    Push          = [bool]($Push -or $EnrollToken)
    Version       = "$(Invoke-Py 'import sqreader; print(sqreader.__version__)')".Trim()
    InstalledAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}

# --- 7. prove the account can read the game ------------------------------------------------
if ($SkipCheck) {
    Write-SqrWarn "-SkipCheck: not verifying that $User can read the game"
    $report = "skipped (-SkipCheck)"
} else {
Write-Sqr "checking, as $User, that the game can be read (diagnose --deep, up to a minute)"
$report = Invoke-SqrAsTaskUser -Cfg $cfg -CliArgs "diagnose --deep"
if ($report -match "\[FAIL\] open the game" -and -not (Test-SqrServiceAccount $User) -and -not $CurrentUserInteractive) {
    Write-SqrWarn "memory access was refused at normal integrity; retrying elevated (the game may run elevated)"
    $report = Invoke-SqrAsTaskUser -Cfg $cfg -CliArgs "diagnose --deep" -RunLevel "Highest"
    if ($report -notmatch "\[FAIL\] open the game") { $cfg.RunLevel = "Highest" }
}
Write-Utf8NoBom (Join-Path $SqrRoot "diagnose-install.txt") $report
if ($report -match "\[FAIL\]") {
    Write-Host $report
    throw "diagnose found a problem (above; saved to diagnose-install.txt). Nothing was registered."
}
Write-Sqr "diagnose: all checks passed (saved to diagnose-install.txt)"
}

# --- 8. optional enrolment ---------------------------------------------------------------------
if ($EnrollToken) {
    Write-Sqr "enrolling against $CentralUrl"
    if ((Invoke-SqrCli @("enroll", $EnrollToken, "--central-url", $CentralUrl)) -ne 0) { throw "enroll failed" }
    $creds = Join-Path $SqrRoot ".env.agent"
    & icacls $creds /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" "${User}:R" /Q | Out-Null
}

# --- 9. the scheduled tasks ------------------------------------------------------------------------
$serve = "serve --host 127.0.0.1 --port $HttpPort --hz 2 --recordings-dir recordings " +
         "--stats-db stats\player_stats.db --icons-dir icons --sqmaps-dir sqmaps " +
         "--frontend-dir frontend\dist"
if ($cfg.Push) { $serve += " --push" }
$supArgs = "-m sqreader.cli supervise --log-file logs\sqreader.log --stop-file state\sqreader.stop " +
           "--cpu-limit $CpuLimit -- $serve"
$action = New-ScheduledTaskAction -Execute $SqrPython -Argument $supArgs -WorkingDirectory $SqrRoot
if ($CurrentUserInteractive) {
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
} else {
    $trigger = New-ScheduledTaskTrigger -AtStartup
}
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew -StartWhenAvailable -Priority 7 `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-SqrTask -TaskName $cfg.TaskName -Action $action -Trigger $trigger -Settings $settings `
    -User $User -Password $UserPassword -RunLevel $cfg.RunLevel -Interactive:$CurrentUserInteractive
Write-Sqr "registered task $($cfg.TaskName) (runs at boot as $User, $($cfg.RunLevel))"

$ret = "/c `"`"$SqrPython`" -m sqreader.cli retention --recordings-dir recordings " +
       "--max-age-days $RetentionMaxAgeDays --max-total-gb $RetentionMaxTotalGB " +
       "--min-free-gb $RetentionMinFreeGB >> logs\retention.log 2>&1`""
$retAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument $ret -WorkingDirectory $SqrRoot
$retTrigger = New-ScheduledTaskTrigger -Daily -At "06:30"
$retSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -Priority 7 `
    -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-SqrTask -TaskName $cfg.RetentionTask -Action $retAction -Trigger $retTrigger -Settings $retSettings `
    -User $User -Password $UserPassword -RunLevel "Limited" -Interactive:$CurrentUserInteractive
Write-Sqr "registered task $($cfg.RetentionTask) (daily 06:30: older than $RetentionMaxAgeDays days, over $RetentionMaxTotalGB GB, or under $RetentionMinFreeGB GB free)"

Write-Utf8NoBom $SqrSettings (($cfg | ConvertTo-Json) + "`n")

# --- 10. start ---------------------------------------------------------------------------------------
if ($NoStart) {
    Write-Sqr "installed; not started (-NoStart). Start with: .\sqreaderctl.ps1 start"
    return
}
Remove-Item $SqrStopFile -ErrorAction SilentlyContinue
$mark = Get-SqrLogSize          # judge only what this start writes
Start-ScheduledTask -TaskName $cfg.TaskName
Write-Sqr "started; waiting for it to attach to the game (up to 2 minutes)"
$deadline = (Get-Date).AddMinutes(2)
$seen = $false
$new = ""
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $new = Get-SqrLogSince $mark
    if ($new -match "serving on http") { $seen = $true; break }
    if ($new -match "\[degraded\]") { break }
}
$newLines = @($new -split "`r?`n" | Where-Object { $_ })
$newLines | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" }
if ($seen) {
    Write-Sqr "running. Viewer on this machine: http://127.0.0.1:$HttpPort/"
} else {
    Write-SqrWarn "not attached yet; see logs\sqreader.log (it keeps retrying on its own)"
}
Write-Sqr "manage it with .\sqreaderctl.ps1 status | stop | start | restart | diagnose"
