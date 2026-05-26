@echo off
title Andromeda AI v6.15
color 0A

echo.
echo  ============================================================
echo   Andromeda AI  v6.15
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

:: ── Step 5: Build if dist/index.js is missing ────────────────────────────────
:: This happens when downloading from GitHub (dist/ is in .gitignore).
:: The zip releases from the developer include dist/ pre-built.
if not exist "dist\index.js" (
    echo.
    echo  [INFO] dist\index.js not found - running build...
    echo  This only happens once. It will take 1-2 minutes.
    echo.
    where pnpm >nul 2>&1
    if errorlevel 1 (
        call npm install -g pnpm
    )
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
    echo.
    echo  [OK] Build complete.
    echo.
)

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
echo   Andromeda AI v6.15  ^|  http://localhost:3000
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
