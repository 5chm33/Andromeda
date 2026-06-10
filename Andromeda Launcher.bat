@echo off
title Andromeda AI v10.0.0
color 0A
echo.
echo  ============================================================
echo   Andromeda AI  v10.0.0  ^|  Godel Machine Edition
echo  ============================================================
echo.

:: ── Step 1: Check Node.js ────────────────────────────────────────────────────
node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found.
    echo  Please install Node.js 18+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% found

:: ── Step 2: Set working directory to this bat's folder ───────────────────────
cd /d "%~dp0"
echo  [OK] Working directory: %CD%

:: ── Step 3: Check .env.local ─────────────────────────────────────────────────
if not exist ".env.local" (
    echo.
    echo  [WARN] .env.local not found.
    echo  Copy your .env.local file into: %CD%
    echo  Use .env.local.example as a template.
    echo  At minimum, set DEEPSEEK_API_KEY or OPENAI_API_KEY.
    echo.
    pause
    exit /b 1
)
echo  [OK] .env.local found

:: ── Step 4: Install pnpm if missing ──────────────────────────────────────────
where pnpm >nul 2>&1
if errorlevel 1 (
    echo  [INFO] pnpm not found -- installing globally...
    call npm install -g pnpm
    if errorlevel 1 (
        echo  [ERROR] Failed to install pnpm. Check your npm/Node.js installation.
        pause
        exit /b 1
    )
    echo  [OK] pnpm installed.
)

:: ── Step 5: Install dependencies (first run or missing node_modules) ─────────
if not exist "node_modules\" (
    echo.
    echo  [INFO] First run -- installing dependencies (this takes ~2 minutes)...
    echo.
    call pnpm install --no-frozen-lockfile
    if errorlevel 1 (
        echo.
        echo  [ERROR] Dependency installation failed.
        echo  Try: Delete node_modules\ and run this launcher again.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Dependencies installed.
    echo.
)

:: ── Step 6: Attempt canvas native rebuild (optional) ─────────────────────────
:: canvas requires C++ build tools. If unavailable, Andromeda still works fully
:: -- screenshots just won't have numbered bounding-box overlays.
where node-gyp >nul 2>&1
if not errorlevel 1 (
    echo  [INFO] Attempting canvas native rebuild for Windows...
    call pnpm rebuild canvas >nul 2>&1
    if not errorlevel 1 (
        echo  [OK] canvas rebuilt -- annotated screenshots enabled.
    ) else (
        echo  [OK] canvas rebuild skipped -- screenshots work without annotations.
    )
) else (
    echo  [OK] canvas annotations optional -- install VS Build Tools to enable.
)

:: ── Step 7: Smart rebuild -- only rebuild if source version changed ───────────
setlocal enabledelayedexpansion

for /f "delims=" %%v in ('node -e "process.stdout.write(require('./package.json').version)"') do set SOURCE_VERSION=%%v

set NEEDS_BUILD=1
if exist "dist\_core\index.js" (
    if exist "dist\.version" (
        for /f "delims=" %%s in ('type "dist\.version"') do set DIST_VERSION=%%s
        if "!DIST_VERSION!"=="v!SOURCE_VERSION!" (
            set NEEDS_BUILD=0
            echo  [OK] dist\ is up to date ^(v!SOURCE_VERSION!^) -- skipping rebuild.
        ) else (
            echo  [INFO] Version changed: dist=!DIST_VERSION! ^-^> source=v!SOURCE_VERSION! -- rebuilding...
            rmdir /s /q "dist\"
        )
    ) else (
        echo  [INFO] No version stamp in dist\ -- rebuilding to apply latest fixes...
        rmdir /s /q "dist\"
    )
) else (
    echo  [INFO] No dist\ found -- building for first time...
)

if "!NEEDS_BUILD!"=="1" (
    echo.
    echo  [INFO] Compiling v!SOURCE_VERSION! ^(~30 seconds^)...
    echo.
    call pnpm run build
    if errorlevel 1 (
        echo.
        echo  [ERROR] Build failed. See errors above.
        echo.
        echo  Common fixes:
        echo    1. Delete node_modules\ and re-run this launcher
        echo    2. Make sure Node.js 18+ is installed
        echo    3. Check that .env.local exists and has valid API keys
        echo.
        pause
        exit /b 1
    )
    echo v!SOURCE_VERSION!> "dist\.version"
    echo.
    echo  [OK] Build complete -- v!SOURCE_VERSION!
    echo.
)

endlocal

:: ── Step 8: Clear port 3000 if occupied ──────────────────────────────────────
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: ── Step 9: Open browser after server warms up ───────────────────────────────
start /min "" cmd /c "ping -n 6 127.0.0.1 >nul & start http://localhost:3000"

:: ── Step 10: Start server (auto-restarts on crash) ───────────────────────────
:START_SERVER
echo.
echo  ============================================================
echo   Andromeda AI v10.0.0  ^|  http://localhost:3000
echo   RSI Engine: ACTIVE  ^|  Proof Gate: ENABLED
echo   Press Ctrl+C to stop the server.
echo  ============================================================
echo.
node dist\_core\index.js
echo.
echo  [INFO] Server stopped ^(exit code %errorlevel%^). Restarting in 3 seconds...
echo  [INFO] Press Ctrl+C NOW to exit completely.
echo.
ping -n 4 127.0.0.1 >nul
goto START_SERVER
