@echo off
setlocal
set "SRC=%~dp0.."
set "DEST=C:\Program Files\Pengu Loader\plugins\league-clubs-local"
if not exist "%DEST%" mkdir "%DEST%"
robocopy "%SRC%" "%DEST%" /MIR /XD .git node_modules loader /XF sync-local.bat install.bat league-clubs.js /NFL /NDL /NJH /NJS /nc /ns /np
if %ERRORLEVEL% GEQ 8 (
  echo Sync failed. Run as admin if Program Files is blocked.
  pause
  exit /b 1
)
echo Synced to:
echo   %DEST%
echo.
echo Disable CDN duplicate: rename or remove plugins\league-clubs.js
echo Then reloadClient() in League DevTools.
pause
