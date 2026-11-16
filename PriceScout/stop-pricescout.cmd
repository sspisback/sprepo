@echo off
setlocal
echo Stopping PriceScout listeners on ports 3000 and 3001...
for /f "tokens=5" %%I in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do if not "%%I"=="0" taskkill /PID %%I /T /F >nul 2>nul
for /f "tokens=5" %%I in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do if not "%%I"=="0" taskkill /PID %%I /T /F >nul 2>nul
echo PriceScout stop command finished.
endlocal
