@echo off
REM Wrapper for RS-4D lab launch. Does not enable production transport.
if "%~1"=="" (
  echo Usage: launch-waka-pos-lab.cmd "C:\path\WAKA-POS-Portable-1.0.12.exe" ["C:\WAKA\remote-support-lab\waka-lab.env"]
  exit /b 1
)
set "POS_EXE=%~1"
set "ENV_FILE=%~2"
if "%ENV_FILE%"=="" set "ENV_FILE=C:\WAKA\remote-support-lab\waka-lab.env"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-waka-pos-lab.ps1" -PosExe "%POS_EXE%" -EnvFile "%ENV_FILE%"
