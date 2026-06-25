@echo off
:: Andromeda GUI Launcher v12.0.0
:: Launches the Electron splash window instead of a raw cmd prompt.
:: Falls back to the console launcher if Electron is not available.
::
:: NOTE: Uses launcher\main.cjs (CommonJS) because package.json has
::       "type":"module" which would break a plain .js Electron main file.

cd /d "%~dp0"

:: Try Electron from node_modules first (fastest path after pnpm install)
set ELECTRON_BIN=%~dp0node_modules\.bin\electron.cmd
if exist "%ELECTRON_BIN%" (
    "%ELECTRON_BIN%" launcher\main.cjs
    exit /b
)

:: Try electron from PATH (globally installed)
where electron >nul 2>&1
if %errorlevel%==0 (
    electron launcher\main.cjs
    exit /b
)

:: Electron not found — install it globally then launch
echo [INFO] Electron not found. Installing...
call npm install -g electron --quiet 2>nul
where electron >nul 2>&1
if %errorlevel%==0 (
    electron launcher\main.cjs
    exit /b
)

:: Last resort: fall back to console launcher
echo [WARN] Could not start GUI launcher. Falling back to console mode.
node start.cjs
pause
