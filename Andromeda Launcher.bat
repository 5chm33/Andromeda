@echo off
:: Andromeda AI Launcher v12.1.0
:: Uses VBScript for a completely silent launch — no cmd window visible.
:: The Electron splash screen is the only thing that appears.

cd /d "%~dp0"

:: Launch silently via VBScript (hides all console windows)
if exist "%~dp0Andromeda Launcher.vbs" (
    cscript //nologo "%~dp0Andromeda Launcher.vbs"
    exit /b 0
)

:: VBScript not found — install Electron if needed, then launch directly
set ELECTRON_BIN=%~dp0node_modules\.bin\electron.cmd
if not exist "%ELECTRON_BIN%" (
    echo Installing Electron (first time only)...
    call npm install -g electron --quiet 2>nul
)

:: Try local electron
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

:: Last resort: console mode
echo [WARN] Could not start GUI launcher. Falling back to console mode.
node start.cjs
pause
