<#
.SYNOPSIS
  Remove sqreader's scheduled tasks. Data stays unless -Purge.

.DESCRIPTION
  Stops the reader cleanly, then unregisters both tasks. The folder itself
  is left alone: recordings\, stats\ and logs\ are kept so nothing is lost
  by accident. With -Purge they are deleted too; the rest of the folder can
  then simply be removed by hand.
#>
param([switch]$Purge)

. (Join-Path $PSScriptRoot "common.ps1")
$cfg = Read-SqrSettings
if (-not $cfg.Interactive -and -not (Test-SqrAdmin)) {
    throw "run this from an elevated (Run as administrator) PowerShell"
}
Write-Sqr (Stop-SqrReader -Cfg $cfg)
foreach ($name in @($cfg.TaskName, $cfg.RetentionTask)) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Sqr "removed task $name"
    }
}
if ($Purge) {
    foreach ($d in @("recordings", "stats", "logs", "state")) {
        $p = Join-Path $SqrRoot $d
        if (Test-Path $p) { Remove-Item -Recurse -Force $p; Write-Sqr "deleted $d\" }
    }
    Remove-Item (Join-Path $SqrRoot ".env.agent") -ErrorAction SilentlyContinue
}
Remove-Item $SqrSettings -ErrorAction SilentlyContinue
Write-Sqr "uninstalled. The folder $SqrRoot can now be deleted."
