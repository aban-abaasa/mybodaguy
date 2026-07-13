@echo off
echo Stopping old Node processes...
taskkill /F /IM node.exe >nul 2>&1

echo Waiting for ports to free up...
timeout /t 2 >nul

echo Starting development server on port 5177...
cd /d "%~dp0"
npm run dev
