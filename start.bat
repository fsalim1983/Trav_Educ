@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "ELECTRON_EXE="
if exist "%~dp0node_modules\electron\dist\electron.exe" set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"
if not defined ELECTRON_EXE (
  where electron >nul 2>&1
  if not errorlevel 1 for /f "delims=" %%i in ('where electron 2^>nul') do if not defined ELECTRON_EXE set "ELECTRON_EXE=%%i"
)
if not defined ELECTRON_EXE (
  echo.
  echo [FET Desktop] Electron not found.
  echo Run once in this folder:  npm install
  echo Then double-click start.bat again.
  echo.
  pause
  exit /b 1
)
echo Starting FET Desktop...
echo Electron: "%ELECTRON_EXE%"
"%ELECTRON_EXE%" "%~dp0."
set "ERR=%errorlevel%"
if not "%ERR%"=="0" (
  echo.
  echo Launch failed. Code: %ERR%
  if exist "%~dp0crash.log" (
    echo --- crash.log ---
    type "%~dp0crash.log"
    echo ----------------
  )
  pause
)
endlocal
