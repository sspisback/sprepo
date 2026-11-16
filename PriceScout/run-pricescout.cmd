@echo off
cd /d "%~dp0"
call npm.cmd run dev >> "%~dp0pricescout.log" 2>&1
if errorlevel 1 echo PriceScout stopped with an error. See pricescout.log.
