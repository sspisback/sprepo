@echo off
cd /d "%~dp0"
call npm.cmd run mcp
if errorlevel 1 echo PriceScout MCP server failed to start. Check Node.js, dependencies, and the project configuration.
