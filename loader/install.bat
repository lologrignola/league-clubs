@echo off
setlocal
set "DEST=%ProgramFiles%\Pengu Loader\plugins"
if not exist "%DEST%" set "DEST=%LOCALAPPDATA%\Pengu Loader\plugins"
if not exist "%DEST%" (
  echo Could not find Pengu plugins folder.
  echo Run window.openPluginsFolder() in League DevTools and copy loader\league-clubs.js there.
  pause
  exit /b 1
)
copy /Y "%~dp0league-clubs.js" "%DEST%\league-clubs.js" >nul
echo Pengu Clubs installed to:
echo   %DEST%\league-clubs.js
echo.
echo Restart League or run window.reloadClient() in DevTools.
pause
