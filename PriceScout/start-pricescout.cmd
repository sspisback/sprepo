@echo off
setlocal
cd /d "%~dp0"
title PriceScout launcher
echo Starting PriceScout locally...
where node.exe >nul 2>nul || (echo ERROR: Node.js is required. Install Node.js and try again.& pause& exit /b 1)
where npm.cmd >nul 2>nul || (echo ERROR: npm.cmd was not found.& pause& exit /b 1)
if not exist "node_modules\vite\bin\vite.js" (
  echo Dependencies are missing. Installing from package-lock...
  call npm.cmd install
  if errorlevel 1 (echo ERROR: Dependency installation failed.& pause& exit /b 1)
)

rem Reuse the app only when both its frontend and API answer successfully.
curl.exe --silent --fail http://127.0.0.1:3000/ >nul 2>nul
if not errorlevel 1 (
  curl.exe --silent --fail http://127.0.0.1:3001/api/health >nul 2>nul
  if not errorlevel 1 (
    echo PriceScout is already running.
    if not "%PRICESCOUT_NO_OPEN%"=="1" start "" http://localhost:3000
    exit /b 0
  )
)

rem Do not launch into a port occupied by an unrelated process.
netstat -ano | findstr :3000 | findstr LISTENING >nul
if not errorlevel 1 (echo ERROR: Port 3000 is occupied, but PriceScout is not responding there.& echo Close the process using port 3000 and try again.& pause& exit /b 1)
netstat -ano | findstr :3001 | findstr LISTENING >nul
if not errorlevel 1 (echo ERROR: Port 3001 is occupied, but PriceScout is not responding there.& echo Close the process using port 3001 and try again.& pause& exit /b 1)

if exist "pricescout.log" del /q "pricescout.log"
start "PriceScout servers" /min "%~dp0run-pricescout.cmd"
echo Waiting for the backend and frontend to become ready...
for /L %%I in (1,1,30) do (
  curl.exe --silent --fail http://127.0.0.1:3001/api/health >nul 2>nul
  if not errorlevel 1 (
    curl.exe --silent --fail http://127.0.0.1:3000/ >nul 2>nul
    if not errorlevel 1 goto :ready
  )
  ping.exe -n 2 -w 1000 127.0.0.1 >nul
)
echo ERROR: PriceScout did not become ready within 30 seconds.
echo Check %~dp0pricescout.log for the startup error.
pause
exit /b 1

:ready
echo PriceScout is ready at http://localhost:3000
if not "%PRICESCOUT_NO_OPEN%"=="1" start "" http://localhost:3000
echo Keep the PriceScout servers window running. Close the browser at any time.
echo Run stop-pricescout.cmd to stop the backend and frontend.
endlocal
