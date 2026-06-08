@echo off
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "NODE_BIN=%SCRIPT_DIR%node\node.exe"

echo ============================================
echo   Portable LLM Agent - USB Runtime
echo ============================================
echo.

:: Check for portable Node binary, fall back to system Node
if not exist "%NODE_BIN%" (
    echo WARNING: Portable Node.js not found at %NODE_BIN%
    echo Falling back to system Node.js...
    where node >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Node.js not found. Install Node.js or place node.exe in:
        echo   %SCRIPT_DIR%node\node.exe
        pause
        exit /b 1
    )
    set "NODE_BIN=node"
)

:: Check for node_modules
if not exist "%SCRIPT_DIR%node_modules" (
    echo node_modules not found. Running npm install...
    cd /d "%SCRIPT_DIR%"
    "%NODE_BIN%" "%SCRIPT_DIR%node\npm" install 2>nul || npm install
    if !ERRORLEVEL! neq 0 (
        echo ERROR: npm install failed. Run it manually in the usb-root folder.
        pause
        exit /b 1
    )
)

echo [1/3] Scanning for phone LLM server on hotspot subnet...
"%NODE_BIN%" "%SCRIPT_DIR%find_phone.js"
if !ERRORLEVEL! neq 0 (
    echo.
    echo Phone not found. You can manually set the IP in bridge\config.json
    echo then re-run this script, or press any key to continue anyway.
    pause
)

echo.
echo [2/3] Starting bridge server (port 3000)...
start "USB-LLM-Bridge" /min "%NODE_BIN%" "%SCRIPT_DIR%bridge\bridge.js"

timeout /t 2 /nobreak >nul

echo [3/3] Starting PC runtime (port 3001)...
start "USB-LLM-Runtime" /min "%NODE_BIN%" "%SCRIPT_DIR%runtime\server.js"

timeout /t 2 /nobreak >nul

echo.
echo ============================================
echo   Running! Opening browser...
echo   Bridge:  http://localhost:3000
echo   Runtime: http://localhost:3001
echo ============================================
echo.
echo Close the Bridge and Runtime windows to stop.
echo Press any key to open the browser manually.
pause

start "" "http://localhost:3000"
