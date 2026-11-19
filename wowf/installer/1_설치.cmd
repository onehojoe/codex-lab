@echo off
setlocal
rem WowF install: runs WowF-Updater.ps1 from this folder, or the installed copy.
set "PS1=%~dp0WowF-Updater.ps1"
if not exist "%PS1%" set "PS1=%LOCALAPPDATA%\WowF\WowF-Updater.ps1"
if not exist "%PS1%" (
  echo WowF-Updater.ps1 not found. Keep this file in the same folder as WowF-Updater.ps1.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Install -Pause
