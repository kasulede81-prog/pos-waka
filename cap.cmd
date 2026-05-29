@echo off
REM From project root:  cap open android  → full build + sync + Studio
cd /d "%~dp0"
if /I "%1"=="open" if /I "%2"=="android" (
  node "%~dp0scripts\android-open.mjs"
  exit /b %ERRORLEVEL%
)
call "%~dp0node_modules\.bin\cap.cmd" %*
