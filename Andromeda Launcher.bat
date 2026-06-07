@echo off
title Andromeda AI v8.5.0
color 0A

echo.
echo  ============================================================
echo   Andromeda AI  v8.5.0
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

:: ── Step 5: Delete old dist and rebuild fresh ────────────────────────────────
:: v8.5.0: Always wipe dist\ and rebuild from source on every launch.
:: This guarantees you are NEVER running stale compiled code from a previous
:: version — the root cause of the "nothing appearing" bug in v8.3.0/v8.4.0.
echo  [INFO] Removing old build (dist\)...
if exist "dist\" (
    rmdir /s /q "dist\"
    echo  [OK] Old dist\ deleted.
) else (
    echo  [OK] No old dist\ found.
)
echo.
echo  [INFO] Compiling fresh build from source (takes ~30 seconds)...
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
echo  [OK] Build complete — running v8.5.0 source.
echo.

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
echo   Andromeda AI v8.5.0  ^|  http://localhost:3000
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
