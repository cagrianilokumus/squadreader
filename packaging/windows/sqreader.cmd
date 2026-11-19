@echo off
rem Run any sqreader command with the bundled Python, from this folder
rem (so it reads this install's sqreader.config.json), e.g.
rem     sqreader.cmd diagnose
rem     sqreader.cmd summary
pushd "%~dp0"
"%~dp0python\python.exe" -m sqreader.cli %*
set rc=%ERRORLEVEL%
popd
exit /b %rc%
