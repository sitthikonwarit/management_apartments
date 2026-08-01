@echo off
setlocal

where bun >nul 2>nul
if errorlevel 1 (
    echo [ERROR] "bun" was not found on this computer. Please install it first: https://bun.sh
    pause
    exit /b 1
)

set "ROOT=%~dp0"

echo Starting Backend on port 3001...
start "LineWeb - Backend" cmd /k "cd /d "%ROOT%backend" && bun run dev"

echo Starting Frontend on port 3000...
start "LineWeb - Frontend" cmd /k "cd /d "%ROOT%frontend" && bun run dev"

echo Waiting for servers to start...
timeout /t 3 /nobreak >nul

start "" "http://localhost:3000"

exit
