@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "APP_DIR=C:\Users\Pal.Soumya\OutlookAddIn"
set "VOICE_TOOLS=C:\Users\Pal.Soumya\voice-tools"

set "WHISPER_CPP_PATH=%VOICE_TOOLS%\whisper.cpp\Release\whisper-cli.exe"
set "WHISPER_MODEL_PATH=%VOICE_TOOLS%\whisper.cpp\models\ggml-base.en.bin"
set "PIPER_PATH=%VOICE_TOOLS%\piper-venv\Scripts\piper.exe"
set "PIPER_MODEL_NAME=en_US-lessac-medium"
set "PIPER_DATA_DIR=%VOICE_TOOLS%\piper-voices"

echo Checking Brain Assistant voice files...
set "MISSING_FILES=0"

if not exist "%WHISPER_CPP_PATH%" (
    echo ERROR: Whisper executable not found: "%WHISPER_CPP_PATH%"
    set "MISSING_FILES=1"
)
if not exist "%WHISPER_MODEL_PATH%" (
    echo ERROR: Whisper model not found: "%WHISPER_MODEL_PATH%"
    set "MISSING_FILES=1"
)
if not exist "%PIPER_PATH%" (
    echo ERROR: Piper executable not found: "%PIPER_PATH%"
    set "MISSING_FILES=1"
)
if not exist "%PIPER_DATA_DIR%\%PIPER_MODEL_NAME%.onnx" (
    echo ERROR: Piper voice model not found: "%PIPER_DATA_DIR%\%PIPER_MODEL_NAME%.onnx"
    set "MISSING_FILES=1"
)
if not exist "%PIPER_DATA_DIR%\%PIPER_MODEL_NAME%.onnx.json" (
    echo ERROR: Piper voice model configuration not found: "%PIPER_DATA_DIR%\%PIPER_MODEL_NAME%.onnx.json"
    set "MISSING_FILES=1"
)

if "%MISSING_FILES%"=="1" goto :missing_files

if not exist "%APP_DIR%\package.json" (
    echo ERROR: Brain project package.json not found: "%APP_DIR%\package.json"
    goto :startup_error
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm.cmd was not found. Check that the existing Node.js/npm installation is available in PATH.
    goto :startup_error
)

pushd "%APP_DIR%"
node.exe "%~dp0restart-brain.cjs"
set "SERVER_EXIT_CODE=%ERRORLEVEL%"
popd

if not "%SERVER_EXIT_CODE%"=="0" (
    echo.
    echo Brain Assistant stopped with exit code %SERVER_EXIT_CODE%.
) else (
    echo.
    echo Brain Assistant has stopped.
)
echo Press any key to close this window.
pause >nul
exit /b %SERVER_EXIT_CODE%

:missing_files
echo.
echo Startup cancelled. Restore the missing files listed above, then run this launcher again.
goto :startup_error

:startup_error
echo.
echo Brain Assistant did not start.
pause
exit /b 1
