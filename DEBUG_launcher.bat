@echo off
:: ============================================================
:: ANDROMEDA DEBUG LAUNCHER
:: This launcher writes EVERYTHING to debug_log.txt
:: Run this, then send us the debug_log.txt file
:: ============================================================
title Andromeda DEBUG Launcher

:: Never close on error - we want to see everything
setlocal enabledelayedexpansion

:: Set working directory to this bat's folder
cd /d "%~dp0"

:: Start logging
set LOGFILE=%~dp0debug_log.txt
echo ============================================================ > "%LOGFILE%"
echo  ANDROMEDA DEBUG LOG >> "%LOGFILE%"
echo  Date: %DATE% Time: %TIME% >> "%LOGFILE%"
echo ============================================================ >> "%LOGFILE%"
echo. >> "%LOGFILE%"

echo  [DEBUG] Starting Andromeda debug launcher...
echo  [DEBUG] Log file: %LOGFILE%
echo.

:: Log working directory
echo  STEP 0: Working directory >> "%LOGFILE%"
echo  CWD: %CD% >> "%LOGFILE%"
echo  BAT location: %~dp0 >> "%LOGFILE%"
echo  BAT full path: %~f0 >> "%LOGFILE%"
echo. >> "%LOGFILE%"
echo  [OK] Working dir: %CD%

:: Log all files in current directory
echo  FILES IN CURRENT DIRECTORY: >> "%LOGFILE%"
dir /b >> "%LOGFILE%" 2>&1
echo. >> "%LOGFILE%"

:: STEP 1: Check Node.js
echo  STEP 1: Node.js check >> "%LOGFILE%"
node --version >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo  FAIL: Node.js not found >> "%LOGFILE%"
    echo  [ERROR] Node.js not found. Install from https://nodejs.org
    echo  [ERROR] Node.js not found >> "%LOGFILE%"
    echo.
    echo  Check debug_log.txt for details.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>^&1') do (
    echo  Node.js version: %%v >> "%LOGFILE%"
    echo  [OK] Node.js %%v
)

:: STEP 2: Check npm
echo. >> "%LOGFILE%"
echo  STEP 2: npm check >> "%LOGFILE%"
npm --version >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo  FAIL: npm not found >> "%LOGFILE%"
) else (
    for /f "tokens=*" %%v in ('npm --version 2^>^&1') do echo  npm version: %%v >> "%LOGFILE%"
)

:: STEP 3: Check .env.local
echo. >> "%LOGFILE%"
echo  STEP 3: .env.local check >> "%LOGFILE%"
if exist ".env.local" (
    echo  PASS: .env.local exists >> "%LOGFILE%"
    echo  [OK] .env.local found
) else (
    echo  WARN: .env.local NOT found >> "%LOGFILE%"
    echo  [WARN] .env.local not found
    if exist ".env.local.example" (
        echo  Copying .env.local.example to .env.local >> "%LOGFILE%"
        copy ".env.local.example" ".env.local" >> "%LOGFILE%" 2>&1
        echo  [OK] Created .env.local from example - please edit it with your API key
    ) else (
        echo  FAIL: .env.local.example also not found >> "%LOGFILE%"
        echo  [ERROR] Neither .env.local nor .env.local.example found
    )
)

:: STEP 4: Check pnpm
echo. >> "%LOGFILE%"
echo  STEP 4: pnpm check >> "%LOGFILE%"
where pnpm >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo  pnpm not found, trying npm install -g pnpm >> "%LOGFILE%"
    echo  [INFO] pnpm not found, installing...
    npm install -g pnpm >> "%LOGFILE%" 2>&1
    if errorlevel 1 (
        echo  FAIL: pnpm install failed >> "%LOGFILE%"
        echo  [ERROR] Could not install pnpm
    ) else (
        echo  pnpm installed OK >> "%LOGFILE%"
        echo  [OK] pnpm installed
    )
) else (
    for /f "tokens=*" %%v in ('pnpm --version 2^>^&1') do echo  pnpm version: %%v >> "%LOGFILE%"
    echo  [OK] pnpm found
)

:: STEP 5: Check node_modules
echo. >> "%LOGFILE%"
echo  STEP 5: node_modules check >> "%LOGFILE%"
if exist "node_modules\" (
    echo  PASS: node_modules exists >> "%LOGFILE%"
    echo  [OK] node_modules found
) else (
    echo  node_modules NOT found - running pnpm install >> "%LOGFILE%"
    echo  [INFO] Installing dependencies (this takes ~2 minutes)...
    pnpm install --no-frozen-lockfile >> "%LOGFILE%" 2>&1
    if errorlevel 1 (
        echo  FAIL: pnpm install failed (exit code %errorlevel%) >> "%LOGFILE%"
        echo  [ERROR] pnpm install failed - check debug_log.txt
        pause
        exit /b 1
    ) else (
        echo  pnpm install succeeded >> "%LOGFILE%"
        echo  [OK] Dependencies installed
    )
)

:: STEP 6: Check dist
echo. >> "%LOGFILE%"
echo  STEP 6: dist check >> "%LOGFILE%"
if exist "dist\_core\index.js" (
    echo  PASS: dist\_core\index.js exists >> "%LOGFILE%"
    echo  [OK] dist found
) else (
    echo  dist NOT found - running pnpm run build >> "%LOGFILE%"
    echo  [INFO] Building (~30 seconds)...
    pnpm run build >> "%LOGFILE%" 2>&1
    if errorlevel 1 (
        echo  FAIL: build failed (exit code %errorlevel%) >> "%LOGFILE%"
        echo  [ERROR] Build failed - check debug_log.txt
        pause
        exit /b 1
    ) else (
        echo  build succeeded >> "%LOGFILE%"
        echo  [OK] Build complete
    )
)

:: STEP 7: Try to start server and capture output
echo. >> "%LOGFILE%"
echo  STEP 7: Starting server >> "%LOGFILE%"
echo  [INFO] Starting server - output will be in debug_log.txt
echo.
echo  ============================================================
echo   If the server crashes, check debug_log.txt for the error
echo  ============================================================
echo.

node "%~dp0start.cjs" >> "%LOGFILE%" 2>&1
set EXIT_CODE=%errorlevel%

echo. >> "%LOGFILE%"
echo  Server exited with code: %EXIT_CODE% >> "%LOGFILE%"
echo.
echo  [INFO] Server stopped with exit code: %EXIT_CODE%
echo  [INFO] Check debug_log.txt for the full error output.
echo.
echo  ============================================================
echo   DEBUG LOG SAVED TO: %LOGFILE%
echo   Please send this file to get help with the error.
echo  ============================================================
echo.
pause
