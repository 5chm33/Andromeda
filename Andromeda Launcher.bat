@echo off
:: Andromeda GUI Launcher v12.0.0
:: Launches the Electron splash window instead of a raw cmd prompt.
:: Falls back to the console launcher if Electron is not available.

cd /d "%~dp0"

:: Try Electron from node_modules first
set ELECTRON_BIN=%~dp0node_modules\.bin\electron.cmd
if exist "%ELECTRON_BIN%" (
    "%ELECTRON_BIN%" launcher\main.js
    exit /b
)

:: Try electron from PATH
where electron >nul 2>&1
if %errorlevel%==0 (
    electron launcher\main.js
    exit /b
)

:: Fallback: install electron then launch
echo [INFO] Electron not found. Installing...
call npm install -g electron --quiet
where electron >nul 2>&1
if %errorlevel%==0 (
    electron launcher\main.js
    exit /b
)

:: Last resort: fall back to console launcher
echo [WARN] Could not start GUI launcher. Falling back to console mode.
node start.cjs
pause
