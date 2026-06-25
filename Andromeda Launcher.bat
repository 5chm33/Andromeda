@echo off
:: Andromeda AI Launcher v12.1.0
:: Double-click to launch. No cmd window will appear.
:: To force a clean rebuild: run with FORCE_REBUILD=1 set in environment,
:: or delete the dist\ folder and relaunch.

cd /d "%~dp0"

:: Launch silently via VBScript (hides all console windows)
if exist "%~dp0Andromeda Launcher.vbs" (
    cscript //nologo "%~dp0Andromeda Launcher.vbs"
    exit /b 0
)

:: VBScript not found — try local electron first
set ELECTRON_BIN=%~dp0node_modules\.bin\electron.cmd
if exist "%ELECTRON_BIN%" (
    start "" /b "%ELECTRON_BIN%" launcher\main.cjs
    exit /b 0
)

:: Try global electron
where electron >nul 2>&1
if %errorlevel%==0 (
    start "" /b electron launcher\main.cjs
    exit /b 0
)

:: Install Electron globally (first time only) then launch
echo Installing Electron (one-time setup, ~10 seconds)...
npm install -g electron --quiet 2>nul
where electron >nul 2>&1
if %errorlevel%==0 (
    start "" /b electron launcher\main.cjs
    exit /b 0
)

:: Last resort: console mode
echo [WARN] Could not start GUI launcher. Falling back to console mode.
node start.cjs
pause
