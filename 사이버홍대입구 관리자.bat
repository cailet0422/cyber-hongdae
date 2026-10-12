@echo off
chcp 65001 >nul
cd /d "%~dp0app"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [!] 아직 설치가 안 되어 있습니다. "처음 설치.bat" 을 먼저 실행해 주세요.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
