@echo off
title Andromeda AI v10.0.0
color 0A
echo.
echo  ============================================================
echo   Andromeda AI  v10.0.0  ^|  Godel Machine Edition
echo  ============================================================
echo.

:: Set working directory to this bat's folder FIRST
cd /d "%~dp0"
echo  [OK] Working directory: %CD%

:: STEP 1: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js not found.
    echo  Please install Node.js 18+ from https://nodejs.org
    echo  Then re-run this launcher.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% found

:: STEP 2: Check .env.local
if not exist ".env.local" (
    echo.
    echo  [WARN] .env.local not found.
    if exist ".env.local.example" (
        echo  Creating .env.local from example...
        copy ".env.local.example" ".env.local" >nul
        echo  [OK] .env.local created.
        echo  IMPORTANT: Edit .env.local and add your API key, then re-run.
        echo.
        notepad ".env.local"
        pause
        exit /b 0
    ) else (
        echo  [ERROR] .env.local.example not found. Please re-download Andromeda.
        pause
        exit /b 1
    )
)
echo  [OK] .env.local found

:: STEP 3: Install pnpm if missing
where pnpm >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Installing pnpm...
    call npm install -g pnpm
    if errorlevel 1 (
        echo  [ERROR] Failed to install pnpm. Try running as Administrator.
        pause
        exit /b 1
    )
    echo  [OK] pnpm installed.
)

:: STEP 4: Install dependencies
if not exist "node_modules\" (
    echo.
    echo  [INFO] First run -- installing dependencies (~2 minutes)...
    echo.
    call pnpm install --no-frozen-lockfile
    if errorlevel 1 (
        echo.
        echo  [ERROR] Dependency installation failed.
        echo  Delete node_modules\ and run this launcher again.
        echo.
        pause
        exit /b 1
    )
    echo  [OK] Dependencies installed.
    echo.
)

:: STEP 5: Attempt canvas native rebuild (silent, optional)
where node-gyp >nul 2>&1
if not errorlevel 1 (
    call pnpm rebuild canvas >nul 2>&1
)

:: STEP 6: Build if dist is missing
if not exist "dist\_core\index.js" (
    echo.
    echo  [INFO] Building Andromeda (~30 seconds)...
    echo.
    call pnpm run build
    if errorlevel 1 (
        echo.
        echo  [ERROR] Build failed. See errors above.
        echo.
        echo  Common fixes:
        echo    1. Delete node_modules\ and re-run this launcher
        echo    2. Make sure Node.js 18+ is installed
        echo    3. Check .env.local has a valid API key
        echo.
        pause
        exit /b 1
    )
    echo  [OK] Build complete.
    echo.
)

:: STEP 7: Clear port 3000 if occupied
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: STEP 8: Open browser after server warms up
start /min "" cmd /c "ping -n 6 127.0.0.1 >nul & start http://localhost:3000"

:: STEP 9: Start server (auto-restarts on crash)
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
echo  [INFO] Server exited (code %errorlevel%). Restarting in 3 seconds...
echo  [INFO] Press Ctrl+C NOW to exit completely.
echo.
ping -n 4 127.0.0.1 >nul
goto START_SERVER
