@echo off
title Andromeda AI v9.2.0
color 0A

echo.
echo  ============================================================
echo   Andromeda AI  v9.2.0
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
for /f "tokens=*" %%v in ('node --version') do echo  [OK] Node.js %%v found

:: ── Step 2: Set working directory to this bat's folder ───────────────────────
cd /d "%~dp0"
echo  [OK] Working directory: %CD%

:: ── Step 3: Check .env.local ─────────────────────────────────────────────────
if not exist ".env.local" (
    echo.
    echo  [WARN] .env.local not found.
    echo  Copy your .env.local file into: %CD%
    echo  Use .env.local.example as a template.
    echo.
    pause
    exit /b 1
)
echo  [OK] .env.local found

:: ── Step 4: Install dependencies (first run only) ────────────────────────────
if not exist "node_modules\" (
    echo.
    echo  [INFO] First run - installing dependencies...
    echo  This will take a minute. The server will start automatically when done.
    echo.
    where pnpm >nul 2>&1
    if errorlevel 1 (
        echo  [INFO] Installing pnpm...
        call npm install -g pnpm
    )
    call pnpm install
    echo.
    echo  [OK] Dependencies installed successfully.
    echo.
)

:: ── Step 5: Smart rebuild — only rebuild if source version changed ────────────
:: v9.2.0: Read the current version from package.json and compare to
:: dist\.version stamp. Only rebuild when they differ (or dist is missing).
:: This avoids the 30-60s rebuild penalty on every launch when nothing changed.
where pnpm >nul 2>&1
if errorlevel 1 (
    call npm install -g pnpm
)

:: Extract version from package.json using node
for /f "delims=" %%v in ('node -e "process.stdout.write(require('./package.json').version)"') do set SOURCE_VERSION=%%v

:: Check if dist exists and version stamp matches
set NEEDS_BUILD=1
if exist "dist\index.js" (
    if exist "dist\.version" (
        for /f "delims=" %%s in ('type "dist\.version"') do set DIST_VERSION=%%s
        if "!DIST_VERSION!"=="!SOURCE_VERSION!" (
            set NEEDS_BUILD=0
        )
    )
)

:: Enable delayed expansion for the variable comparison above
setlocal enabledelayedexpansion
set NEEDS_BUILD=1
if exist "dist\index.js" (
    if exist "dist\.version" (
        for /f "delims=" %%s in ('type "dist\.version"') do set DIST_VERSION=%%s
        if "!DIST_VERSION!"=="v!SOURCE_VERSION!" (
            set NEEDS_BUILD=0
            echo  [OK] dist\ is up to date ^(v!SOURCE_VERSION!^) — skipping rebuild.
        ) else (
            echo  [INFO] Version changed: dist=!DIST_VERSION! source=v!SOURCE_VERSION! — rebuilding...
            rmdir /s /q "dist\"
        )
    ) else (
        echo  [INFO] No version stamp found — rebuilding...
        rmdir /s /q "dist\"
    )
) else (
    echo  [INFO] No dist\ found — building for first time...
)

if "!NEEDS_BUILD!"=="1" (
    echo.
    echo  [INFO] Compiling fresh build from source v!SOURCE_VERSION! ^(takes ~30 seconds^)...
    call pnpm run build
    if errorlevel 1 (
        echo.
        echo  [ERROR] Build failed. Check the output above for errors.
        echo  Common fixes:
        echo    - Make sure Node.js 18+ is installed
        echo    - Delete node_modules\ and re-run this launcher
        echo.
        pause
        exit /b 1
    )
    :: Write version stamp so next launch skips rebuild
    echo v!SOURCE_VERSION!> "dist\.version"
    echo.
    echo  [OK] Build complete — running v!SOURCE_VERSION! source.
    echo.
)
endlocal

:: ── Step 6: Clear port 3000 ──────────────────────────────────────────────────
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: ── Step 7: Open browser after server starts ─────────────────────────────────
start /min "" cmd /c "ping -n 6 127.0.0.1 >nul & start http://localhost:3000"

:: ── Step 8: Start server (auto-restarts on crash) ────────────────────────────
:START_SERVER
echo.
echo  ============================================================
echo   Andromeda AI v9.2.0  ^|  http://localhost:3000
echo   Press Ctrl+C to stop the server.
echo  ============================================================
echo.
node dist\index.js
echo.
echo  [INFO] Server stopped (exit code %errorlevel%). Restarting in 3 seconds...
echo  [INFO] Press Ctrl+C NOW to exit completely.
echo.
ping -n 4 127.0.0.1 >nul
goto START_SERVER
